import {
  antiSpamAllows,
  applyAntiSpamCap,
  isDispatchPaused,
  recipientKey,
  renderTemplate,
  resolveReminderChannels,
  revalidateBeforeSend,
  TRANSACTIONAL_REMINDER_TYPES,
  type ReminderChannel,
  type RevalidateClientInput,
} from "@atelieros/core";
import type { MessagingProvider } from "@atelieros/integrations";
import type {
  DispatchResult,
  DueReminder,
  OrganizationContext,
  RemindersDispatchRepository,
} from "./types";

/**
 * Résout le fournisseur de messagerie actif de l'organisation pour un canal donné (injecté pour
 * rester testable sans Redis/BullMQ/Prisma réels ; l'implémentation réelle délègue à
 * `resolveMessagingProvider` de `@atelieros/integrations`, cf. `apps/worker/src/messagingConfigStore.ts`).
 */
export interface ReminderMessageSender {
  resolveProvider(
    organizationId: string,
    channel: ReminderChannel,
  ): Promise<{ provider: MessagingProvider; providerName: string }>;
}

const EMPTY_RESULT: DispatchResult = {
  sent: 0,
  failed: 0,
  cancelled: 0,
  rescheduled: 0,
  deferred: 0,
  movedToCallList: 0,
  blockedByEdit: 0,
  recoveredStuck: 0,
};

/**
 * RG-M10-20 à RG-M10-26 — envoie les relances `PLANNED` dues d'une organisation. Fonctions pures
 * de `@atelieros/core` pour toute la décision métier (revérification, anti-spam, résolution de
 * canal, rendu) ; ce module ne fait qu'orchestrer (charger via `repo`, décider, envoyer via
 * `sender`, persister), conformément à CLAUDE.md.
 *
 * Simplification assumée (cf. rapport de livraison) : les relances sont traitées individuellement
 * (pas de regroupement multi-véhicule `vt_multi`/`combo`, RG-M10-15) et l'envoi via
 * `packages/integrations` est synchrone (pas d'état `QUEUED` intermédiaire en attente d'un
 * webhook M11 : le statut final `SENT`/`FAILED` est connu immédiatement après `provider.send()`).
 */
export async function dispatchOrganizationReminders(
  repo: RemindersDispatchRepository,
  sender: ReminderMessageSender,
  org: OrganizationContext,
  now: Date,
): Promise<DispatchResult> {
  if (isDispatchPaused(org.settings.approvalMode)) return EMPTY_RESULT;

  const recoveredStuck = await repo.recoverStuckQueued(org.id, now);
  const due = await repo.listDueReminders(org.id, now);

  const result: DispatchResult = { ...EMPTY_RESULT, recoveredStuck };

  for (const reminder of due) {
    await processOne(repo, sender, org, now, reminder, result);
  }

  return result;
}

async function processOne(
  repo: RemindersDispatchRepository,
  sender: ReminderMessageSender,
  org: OrganizationContext,
  now: Date,
  reminder: DueReminder,
  result: DispatchResult,
): Promise<void> {
  const isTransactional = TRANSACTIONAL_REMINDER_TYPES.has(reminder.type);
  const hasActiveSuppression = await repo.isSuppressed(
    org.id,
    {
      sequenceKey: reminder.sequenceKey,
      customerId: reminder.customerId,
      vehicleId: reminder.vehicleId,
      type: reminder.type,
    },
    now,
  );

  const clientCheck: RevalidateClientInput = {
    deletedAt: reminder.customer.deletedAt,
    remindersConsent: reminder.customer.remindersConsent,
    doNotRemind: reminder.customer.doNotRemind,
    isOptedOut: reminder.customer.optedOutChannels.length > 0,
    hasActiveSuppression,
    isTransactional,
  };

  // RG-M10-24 — revérification juste avant l'envoi (client + motif spécifique au type).
  const outcome = revalidateBeforeSend(clientCheck, reminder.typeCheck);
  if (!outcome.ok) {
    if (outcome.outcome === "CANCELLED") {
      await repo.cancelReminder(reminder.id, outcome.reason);
      result.cancelled += 1;
    } else {
      await repo.rescheduleReminder(reminder.id, outcome.retryAt, outcome.reason);
      result.rescheduled += 1;
    }
    return;
  }

  // RG-M10-25 — texte édité manuellement : bloque l'envoi si une donnée matérielle a changé depuis.
  if (reminder.isEdited && reminder.editedContextVariables) {
    const changedKey = Object.keys(reminder.editedContextVariables).find(
      (key) =>
        key in reminder.freshVariables &&
        reminder.editedContextVariables?.[key] !== reminder.freshVariables[key],
    );
    if (changedKey) {
      await repo.backToApproval(
        reminder.id,
        `Une donnée (« ${changedKey} ») a changé depuis votre modification du message.`,
      );
      result.blockedByEdit += 1;
      return;
    }
  }

  const phoneE164 = reminder.customer.phoneInvalidAt
    ? null
    : (reminder.customer.whatsappPhone ??
      reminder.customer.phone ??
      reminder.customer.phone2 ??
      null);

  // RG-M10-11/12 — résolution fraîche des canaux (pas celle figée à la planification).
  const channels = resolveReminderChannels({
    preferredChannel: reminder.customer.preferredChannel,
    stepChannels: reminder.stepChannels,
    hasWhatsapp: reminder.customer.hasWhatsapp,
    phoneE164,
    email: reminder.customer.email,
    optedOutChannels: reminder.customer.optedOutChannels,
  });
  if (channels.length === 0) {
    await repo.moveToCallList(reminder.id); // RG-M10-31
    result.movedToCallList += 1;
    return;
  }

  const rKey = recipientKey({ phoneE164, email: reminder.customer.email });
  if (rKey) {
    const history = await repo.antiSpamHistory(org.id, rKey, now);
    const allowed = antiSpamAllows(rKey, reminder.priority, history, now, {
      maxPerDay: org.settings.maxPerDay,
      maxPerWeek: org.settings.maxPerWeek,
    });
    if (!allowed) {
      const decision = applyAntiSpamCap(reminder.deferCount); // RG-M10-16
      await repo.deferReminder(reminder.id, decision);
      result.deferred += 1;
      return;
    }
  }

  const channel = channels[0] as ReminderChannel;
  const to = channel === "EMAIL" ? reminder.customer.email : phoneE164;
  if (!to) {
    await repo.moveToCallList(reminder.id);
    result.movedToCallList += 1;
    return;
  }

  const template = reminder.templates[channel];
  if (!template) {
    await repo.markFailed(reminder.id, `Aucun modèle de message actif pour le canal ${channel}.`);
    result.failed += 1;
    return;
  }

  // RG-M10-25 — toujours re-rendu avec les données fraîches, sauf texte édité par un humain.
  const body =
    reminder.isEdited && reminder.renderedBody
      ? reminder.renderedBody
      : renderTemplate(template.body, reminder.freshVariables);
  const subject = template.subject
    ? renderTemplate(template.subject, reminder.freshVariables)
    : null;

  try {
    const { provider, providerName } = await sender.resolveProvider(org.id, channel);
    const sendResult = await provider.send({
      to,
      channel,
      body,
      templateKey: reminder.templateKey,
    });
    await repo.markSent({
      id: reminder.id,
      channel,
      to,
      renderedBody: body,
      renderedSubject: subject,
      provider: providerName,
      providerMessageId: sendResult.providerMessageId,
      cost: sendResult.cost,
    });
    result.sent += 1;
  } catch (err) {
    await repo.markFailed(
      reminder.id,
      err instanceof Error ? err.message : "Erreur d'envoi inconnue.",
    );
    result.failed += 1;
  }
}
