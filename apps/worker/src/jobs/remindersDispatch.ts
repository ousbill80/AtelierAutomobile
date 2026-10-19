// §9.2 — job toutes les 5 min `reminders.dispatch` (verrou par organisation).
//
// Écart documenté (cf. message de commit) : RG-M10-24 demande un verrouillage
// `FOR UPDATE SKIP LOCKED` en base. `db.forTenant(ctx)` n'expose pas de requête SQL brute
// (seulement les délégués de modèle) ; on utilise à la place une mise à jour conditionnelle
// atomique (`updateMany({ where: { status: "PLANNED" } })`) comme garde-fou de concurrence,
// suffisant tant qu'un seul worker consomme la file des relances.
import { adminDb, db } from "@atelieros/db";
import {
  antiSpamAllows,
  clientNamespace,
  deferOutcome,
  detectCombo,
  formatFCFA,
  formatVehicleList,
  garageNamespace,
  isWithinSendWindow,
  nextSendWindowStart,
  pickChannel,
  renderTemplate,
  resolveGroupTemplateKey,
  stageEffectForStep,
  templateKeyCandidates,
  vehicleNamespace,
  type Channel,
} from "@atelieros/core";
import { reminderSendWindowSchema, reminderStepSchema } from "@atelieros/validators";
import { z } from "zod";
import { enqueueMessageSendJob } from "../queues/messages";
import { logger } from "../logger";
import { resolveChannelCandidates, resolveRecipient } from "./reminderChannel";

// Création du `Message` : réimplémentée ici plutôt que de réutiliser
// `apps/web/src/server/messaging/enqueue.ts` (`messagingEnqueue`), qui n'est pas un module
// partagé entre apps (01-architecture-technique.md : chaque app orchestre elle-même via
// `core`/`db`/`integrations`, aucun import `apps/web` depuis `apps/worker`). Le canal et le
// modèle sont déjà résolus par `dispatchGroup` avant cet appel.

type TenantDb = ReturnType<typeof db.forTenant>;

const STUCK_QUEUED_MINUTES = 30;
const NON_TRANSACTIONAL_TYPES = new Set([
  "INSPECTION",
  "SERVICE",
  "RECEIVABLE",
  "QUOTE_FOLLOWUP",
  "INSURANCE_EXPIRY",
  "SATISFACTION",
  "RECOMMENDED_WORK",
  "CUSTOM",
]);

type DueReminder = Awaited<ReturnType<typeof loadDueReminders>>[number];

async function loadDueReminders(tenantDb: TenantDb, now: Date) {
  return tenantDb.reminder.findMany({
    where: { status: "PLANNED", scheduledFor: { lte: now } },
    orderBy: [{ priority: "asc" }, { scheduledFor: "asc" }],
    take: 500,
    include: {
      customer: true,
      vehicle: true,
      invoice: true,
      quote: true,
      rule: true,
    },
  });
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface DispatchGroup {
  key: string;
  type: string;
  stepKey: string;
  date: string;
  reminders: DueReminder[];
  isCombo: boolean;
}

function buildGroups(
  reminders: DueReminder[],
  recipientKeyOf: Map<string, string>,
): DispatchGroup[] {
  const primary = new Map<string, DispatchGroup>();
  for (const r of reminders) {
    const recipientKey = recipientKeyOf.get(r.id);
    if (!recipientKey) continue;
    const date = dayKey(r.scheduledFor);
    const key = `${recipientKey}:${r.type}:${r.stepKey}:${date}`;
    const group = primary.get(key) ?? {
      key,
      type: r.type,
      stepKey: r.stepKey,
      date,
      reminders: [],
      isCombo: false,
    };
    group.reminders.push(r);
    primary.set(key, group);
  }

  // RG-M10-15 : VT + révision du même véhicule le même jour → combo (fusion de deux groupes).
  const groups = [...primary.values()];
  const consumed = new Set<string>();
  const merged: DispatchGroup[] = [];
  for (const group of groups) {
    if (consumed.has(group.key)) continue;
    if (group.type !== "INSPECTION" && group.type !== "SERVICE") {
      merged.push(group);
      continue;
    }
    const otherType = group.type === "INSPECTION" ? "SERVICE" : "INSPECTION";
    const recipientKey = group.key.split(":")[0]!;
    const partner = groups.find(
      (g) =>
        !consumed.has(g.key) &&
        g !== group &&
        g.type === otherType &&
        g.date === group.date &&
        g.key.startsWith(`${recipientKey}:`) &&
        detectCombo(
          [...group.reminders, ...g.reminders].map((r) => ({
            vehicleId: r.vehicleId,
            type: r.type,
          })),
        ),
    );
    if (partner) {
      consumed.add(group.key);
      consumed.add(partner.key);
      merged.push({
        key: `${group.key}+${partner.key}`,
        type: group.type,
        stepKey: group.stepKey,
        date: group.date,
        reminders: [...group.reminders, ...partner.reminders],
        isCombo: true,
      });
    } else {
      merged.push(group);
    }
  }
  return merged;
}

type RevalidateResult = { ok: true } | { ok: false; retryAt?: Date; reason: string };

async function revalidate(tenantDb: TenantDb, reminder: DueReminder): Promise<RevalidateResult> {
  const customer = reminder.customer;
  if (customer.deletedAt || customer.doNotRemind) {
    return { ok: false, reason: "Client non relançable (fiche supprimée ou ne pas relancer)." };
  }
  // Types transactionnels (APPOINTMENT/VEHICLE_READY) : consentement relances non requis.
  if (NON_TRANSACTIONAL_TYPES.has(reminder.type) && !customer.remindersConsent) {
    return { ok: false, reason: "Consentement aux relances retiré." };
  }

  if (reminder.type === "INSPECTION" && reminder.vehicle) {
    if (
      !reminder.vehicle.inspectionExpiryDate ||
      dayKey(reminder.vehicle.inspectionExpiryDate) !== dayKey(reminder.dueDate) ||
      reminder.vehicle.customerId !== reminder.customerId
    ) {
      return {
        ok: false,
        reason: "Échéance de visite technique modifiée depuis la planification.",
      };
    }
  }
  if (reminder.type === "SERVICE" && reminder.vehicle) {
    const due = reminder.vehicle.nextServiceDueDate;
    const deltaDays = due
      ? Math.abs((due.getTime() - reminder.dueDate.getTime()) / 86_400_000)
      : 999;
    if (!due || deltaDays > 3) {
      return { ok: false, reason: "Échéance de révision recalculée, nouvelle séquence." };
    }
  }
  if (reminder.type === "RECEIVABLE") {
    if (reminder.invoice) {
      if (
        !["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(reminder.invoice.status) ||
        reminder.invoice.balance <= 0
      ) {
        return { ok: false, reason: "Facture déjà réglée ou annulée." };
      }
    } else {
      const kase = await tenantDb.collectionCase.findFirst({
        where: { customerId: reminder.customerId, status: { in: ["OPEN", "ESCALATED"] } },
      });
      if (!kase) return { ok: false, reason: "Dossier de recouvrement clos." };
      // M09 RG-M09-09 / CLAUDE.md : revérifier « toujours impayée » juste avant l'envoi,
      // depuis les factures elles-mêmes (un paiement a pu arriver depuis la planification).
      const stillDue = await tenantDb.invoice.aggregate({
        where: {
          customerId: reminder.customerId,
          billTo: "CUSTOMER",
          status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
          balance: { gt: 0 },
          dueDate: { lt: reminder.scheduledFor },
        },
        _sum: { balance: true },
      });
      if ((stillDue._sum.balance ?? 0) <= 0) {
        return { ok: false, reason: "Facture déjà réglée." };
      }
    }
  }
  if (reminder.type === "APPOINTMENT" && reminder.appointmentId) {
    const appointment = await tenantDb.appointment.findFirst({
      where: { id: reminder.appointmentId },
    });
    if (
      !appointment ||
      !["BOOKED", "CONFIRMED"].includes(appointment.status) ||
      appointment.startsAt.getTime() !== reminder.dueDate.getTime()
    ) {
      return { ok: false, reason: "Rendez-vous annulé ou replanifié." };
    }
  }
  if (reminder.type === "QUOTE_FOLLOWUP" && reminder.quote) {
    if (!["SENT", "VIEWED"].includes(reminder.quote.status)) {
      return { ok: false, reason: "Devis accepté, refusé ou expiré." };
    }
  }
  if (reminder.type === "VEHICLE_READY" && reminder.vehicleId) {
    const order = await tenantDb.repairOrder.findFirst({
      where: { vehicleId: reminder.vehicleId, status: "READY" },
    });
    if (!order) return { ok: false, reason: "Ordre de réparation déjà livré ou annulé." };
  }

  return { ok: true };
}

type GarageInfo = ReturnType<typeof garageNamespace>;

async function loadGarageInfo(organizationId: string): Promise<GarageInfo> {
  const org = await adminDb.organization.findUnique({ where: { id: organizationId } });
  return garageNamespace(org ?? {});
}

async function buildContext(
  tenantDb: TenantDb,
  group: DispatchGroup,
  garage: GarageInfo,
): Promise<Record<string, unknown>> {
  const first = group.reminders[0]!;
  const base: Record<string, unknown> = {
    garage,
    client: clientNamespace(first.customer),
    lien: { rdv: "", devis: "", facture: "", paiement: "", avis: "" },
  };

  const vehicles = group.reminders.filter((r) => r.vehicleId && r.vehicle);
  if (vehicles.length > 1) {
    base.vehicules = {
      liste: formatVehicleList(vehicles.map((r) => r.vehicle!.plate)),
      nombre: String(vehicles.length),
    };
  }
  base.vehicule = vehicleNamespace(first.vehicle);

  if (group.type === "INSPECTION" && first.vehicle?.inspectionExpiryDate) {
    const days = Math.round(
      (first.vehicle.inspectionExpiryDate.getTime() - Date.now()) / 86_400_000,
    );
    base.vt = {
      dateExpiration: first.vehicle.inspectionExpiryDate.toISOString().slice(0, 10),
      joursRestants: String(days),
    };
  }
  if (group.type === "SERVICE" && first.vehicle?.nextServiceDueDate) {
    base.revision = {
      dateEcheance: first.vehicle.nextServiceDueDate.toISOString().slice(0, 10),
      kmEcheance:
        first.vehicle.nextServiceDueMileage != null
          ? `${first.vehicle.nextServiceDueMileage} km`
          : "",
    };
  }
  if (group.type === "RECEIVABLE") {
    if (first.invoice) {
      base.facture = {
        numero: first.invoice.number,
        echeance: first.invoice.dueDate?.toISOString().slice(0, 10) ?? "",
        solde: formatFCFA(first.invoice.balance),
      };
    } else {
      const kase = await tenantDb.collectionCase.findFirst({
        where: { customerId: first.customerId },
      });
      const invoices = await tenantDb.invoice.findMany({
        where: {
          customerId: first.customerId,
          status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
        },
      });
      const totalDue = invoices.reduce((sum, i) => sum + i.balance, 0);
      const maxDelay = Math.max(
        0,
        ...invoices.map((i) =>
          i.dueDate ? Math.round((Date.now() - i.dueDate.getTime()) / 86_400_000) : 0,
        ),
      );
      base.client = {
        ...(base.client as Record<string, unknown>),
        soldeEnRetard: formatFCFA(kase?.totalDue ?? totalDue),
        joursRetardMax: String(maxDelay),
      };
      base.factures = {
        resume: `${invoices.length} facture(s), ${formatFCFA(totalDue)}`,
        detail: invoices.map((i) => `${i.number} : ${formatFCFA(i.balance)}`).join(" ; "),
      };
    }
  }
  if (group.type === "QUOTE_FOLLOWUP" && first.quote) {
    base.devis = {
      numero: first.quote.number,
      montant: formatFCFA(first.quote.total),
      validite: first.quote.validUntil.toISOString().slice(0, 10),
    };
  }
  if (group.type === "APPOINTMENT" && first.appointmentId) {
    const appointment = await tenantDb.appointment.findFirst({
      where: { id: first.appointmentId },
    });
    if (appointment) {
      base.rdv = {
        date: appointment.startsAt.toISOString().slice(0, 10),
        heure: appointment.startsAt.toISOString().slice(11, 16),
      };
    }
  }
  if (group.type === "INSURANCE_EXPIRY" && first.vehicle?.insuranceExpiryDate) {
    base.assurance = {
      dateExpiration: first.vehicle.insuranceExpiryDate.toISOString().slice(0, 10),
    };
  }

  return base;
}

async function dispatchGroup(
  organizationId: string,
  tenantDb: TenantDb,
  group: DispatchGroup,
  garage: GarageInfo,
  now: Date,
  timeZone: string,
): Promise<void> {
  const valid: DueReminder[] = [];
  for (const reminder of group.reminders) {
    const check = await revalidate(tenantDb, reminder);
    if (check.ok) {
      valid.push(reminder);
    } else if (check.retryAt) {
      await tenantDb.reminder.update({
        where: { id: reminder.id },
        data: { scheduledFor: check.retryAt, skippedReason: check.reason },
      });
    } else {
      await tenantDb.reminder.update({
        where: { id: reminder.id },
        data: { status: "CANCELLED", skippedReason: check.reason },
      });
    }
  }
  if (valid.length === 0) return;

  const recipient = await resolveRecipient(tenantDb, valid[0]!.customer, valid[0]!.type);
  if (!recipient) {
    await tenantDb.reminder.updateMany({
      where: { id: { in: valid.map((r) => r.id) } },
      data: { status: "NEEDS_APPROVAL", channel: null },
    });
    return;
  }

  const rule = valid[0]!.rule;
  const steps = z.array(reminderStepSchema).parse(rule.steps);
  // M09 RG-M09-06 : la relance « promesse rompue » est hors séquence (pas de palier dans la règle).
  const step =
    steps.find((s) => s.key === valid[0]!.stepKey) ??
    (valid[0]!.stepKey === "PROMISE_BROKEN" && steps[0]
      ? { ...steps[0], key: "PROMISE_BROKEN", templateKey: "cr_promesse_rompue" }
      : undefined);
  if (!step) return;

  const stepTemplateKey = group.isCombo ? "vt_rev_combo" : step.templateKey;
  const vehicleIds = new Set(valid.map((r) => r.vehicleId).filter((v): v is string => !!v));
  const templateKey = group.isCombo
    ? "vt_rev_combo"
    : resolveGroupTemplateKey({
        type: group.type,
        stepTemplateKey,
        vehicleCount: vehicleIds.size,
        isCombo: false,
      });

  const { candidates, providerByChannel } = await resolveChannelCandidates(
    tenantDb,
    recipient,
    step.channels as Channel[],
  );
  const picked = pickChannel({ candidates });
  if (picked.channel === null) {
    await tenantDb.reminder.updateMany({
      where: { id: { in: valid.map((r) => r.id) } },
      data: { status: "NEEDS_APPROVAL", channel: null },
    });
    return;
  }

  const sendWindow = reminderSendWindowSchema.parse(rule.sendWindow);
  if (!isWithinSendWindow(now, timeZone, { from: sendWindow.from, to: sendWindow.to })) {
    const next = nextSendWindowStart(now, timeZone);
    await tenantDb.reminder.updateMany({
      where: { id: { in: valid.map((r) => r.id) } },
      data: { scheduledFor: next },
    });
    return;
  }

  const isTransactional = !NON_TRANSACTIONAL_TYPES.has(group.type);
  if (!isTransactional) {
    const dayStart = new Date(`${dayKey(now)}T00:00:00Z`);
    const weekStart = new Date(now.getTime() - 7 * 86_400_000);
    const [sentToday, sentThisWeek] = await Promise.all([
      tenantDb.reminder.count({
        where: {
          status: { in: ["SENT", "QUEUED"] },
          groupKey: { startsWith: `${recipient.recipientKey}:` },
          updatedAt: { gte: dayStart },
        },
      }),
      tenantDb.reminder.count({
        where: {
          status: { in: ["SENT", "QUEUED"] },
          groupKey: { startsWith: `${recipient.recipientKey}:` },
          updatedAt: { gte: weekStart },
        },
      }),
    ]);
    if (
      !antiSpamAllows({
        sentOrQueuedToday: sentToday,
        sentOrQueuedLast7Days: sentThisWeek,
        maxPerDay: 1,
        maxPerWeek: 3,
      })
    ) {
      const deferCount = Math.max(...valid.map((r) => r.deferCount)) + 1;
      const outcome = deferOutcome(deferCount);
      const next = nextSendWindowStart(now, timeZone);
      await tenantDb.reminder.updateMany({
        where: { id: { in: valid.map((r) => r.id) } },
        data:
          outcome === "SKIPPED"
            ? { status: "SKIPPED", skippedReason: "Plafond anti-spam (3 reports)." }
            : {
                status: "SNOOZED",
                snoozedUntil: next,
                deferCount,
                skippedReason: "Plafond anti-spam.",
              },
      });
      return;
    }
  }

  const context = await buildContext(tenantDb, group, garage);
  const isCompany = valid[0]!.customer.type === "COMPANY";
  const keyCandidates = templateKeyCandidates(templateKey, isCompany);
  let resolvedTemplateKey = templateKey;
  for (const candidate of keyCandidates) {
    const exists = await tenantDb.messageTemplate.findFirst({
      where: { key: candidate, channel: picked.channel, isActive: true },
    });
    if (exists) {
      resolvedTemplateKey = candidate;
      break;
    }
  }

  const groupKey = group.key;
  const edited = valid.find((r) => r.editedBody);
  const idempotencyKey = `rem:${groupKey}`;
  const channel = picked.channel;
  const address = picked.address;

  let messageId: string;
  try {
    let body: string;
    let subject: string | undefined;
    if (edited?.renderedBody) {
      body = edited.renderedBody;
      subject = edited.renderedSubject ?? undefined;
    } else {
      const template = await tenantDb.messageTemplate.findFirst({
        where: { key: resolvedTemplateKey, channel, isActive: true },
      });
      if (!template) {
        throw new Error(`Modèle « ${resolvedTemplateKey} » (${channel}) introuvable ou inactif.`);
      }
      const rendered = renderTemplate({ template: template.body, context, channel });
      body = rendered.body;
      subject = template.subject
        ? renderTemplate({ template: template.subject, context, channel: "EMAIL" }).body
        : undefined;
    }

    const existing = await tenantDb.message.findFirst({ where: { idempotencyKey, channel } });
    if (existing) {
      messageId = existing.id;
    } else {
      const created = await tenantDb.message.create({
        data: {
          organizationId,
          customerId: recipient.customerId,
          reminderId: valid[0]!.id,
          direction: "OUTBOUND",
          channel,
          to: address ?? "",
          subject,
          body,
          status: "QUEUED",
          provider: providerByChannel.get(channel) ?? "console",
          kind: "REMINDER",
          templateKey: edited ? undefined : resolvedTemplateKey,
          idempotencyKey,
        },
      });
      messageId = created.id;
    }
  } catch (error) {
    // Contrainte unique (organizationId, idempotencyKey, channel) : course avec un passage
    // concurrent (RG-M10-26) — on relit le message déjà créé plutôt que d'échouer.
    const isUniqueViolation =
      typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    if (isUniqueViolation) {
      const concurrent = await tenantDb.message.findFirst({ where: { idempotencyKey, channel } });
      if (concurrent) {
        messageId = concurrent.id;
      } else {
        return;
      }
    } else {
      logger.error(
        { groupKey, error: error instanceof Error ? error.message : error },
        "reminders.dispatch : échec du rendu/envoi, relance reportée",
      );
      await tenantDb.reminder.updateMany({
        where: { id: { in: valid.map((r) => r.id) } },
        data: {
          status: "NEEDS_APPROVAL",
          channel: null,
          skippedReason: "Erreur de rendu, à vérifier.",
        },
      });
      return;
    }
  }

  await tenantDb.reminder.updateMany({
    where: { id: { in: valid.map((r) => r.id) } },
    data: { status: "QUEUED", messageId, groupKey, channel },
  });
  await applyReceivableStageEffects(tenantDb, valid, new Date());
  await enqueueMessageSendJob(messageId);
}

/** RG-M09-04 : palier envoyé → `stage`, `lastContactAt`, crédit suspendu (J+30), escalade (J+45). */
async function applyReceivableStageEffects(
  tenantDb: TenantDb,
  reminders: { type: string; stepKey: string; customerId: string }[],
  now: Date,
): Promise<void> {
  for (const reminder of reminders) {
    if (reminder.type !== "RECEIVABLE") continue;
    const effect = stageEffectForStep(reminder.stepKey);
    const kase = await tenantDb.collectionCase.findFirst({
      where: { customerId: reminder.customerId, status: { in: ["OPEN", "ESCALATED"] } },
    });
    if (!kase) continue;
    await tenantDb.collectionCase.update({
      where: { id: kase.id },
      data: {
        lastContactAt: now,
        ...(effect && effect.stage > kase.stage ? { stage: effect.stage } : {}),
        ...(effect?.escalate && kase.status !== "ESCALATED"
          ? { status: "ESCALATED", escalatedAt: now }
          : {}),
      },
    });
    if (effect?.creditHold) {
      await tenantDb.customer.update({
        where: { id: reminder.customerId },
        data: { creditHold: true, creditHoldReason: "Relance ferme J+30 envoyée" },
      });
    }
  }
}

async function dispatchForOrganization(organizationId: string, timeZone: string): Promise<void> {
  const tenantDb = db.forTenant({ organizationId });
  const now = new Date();

  // RG-M10-26 : récupération après crash (QUEUED bloqué > 30 min sans Message).
  const stuckThreshold = new Date(now.getTime() - STUCK_QUEUED_MINUTES * 60_000);
  await tenantDb.reminder.updateMany({
    where: { status: "QUEUED", updatedAt: { lt: stuckThreshold }, messageId: null },
    data: { status: "PLANNED" },
  });

  const due = await loadDueReminders(tenantDb, now);
  if (due.length === 0) return;

  const recipientKeyOf = new Map<string, string>();
  for (const r of due) {
    const recipient = await resolveRecipient(tenantDb, r.customer, r.type);
    if (recipient) recipientKeyOf.set(r.id, recipient.recipientKey);
  }

  const groups = buildGroups(due, recipientKeyOf);
  const garage = await loadGarageInfo(organizationId);

  for (const group of groups) {
    try {
      await dispatchGroup(organizationId, tenantDb, group, garage, now, timeZone);
    } catch (error) {
      logger.error(
        {
          organizationId,
          groupKey: group.key,
          error: error instanceof Error ? error.message : error,
        },
        "reminders.dispatch : échec sur un groupe, passage au suivant",
      );
    }
  }
}

export async function processRemindersDispatchJob(): Promise<void> {
  const organizations = await adminDb.organization.findMany({
    select: { id: true, timezone: true },
  });
  for (const org of organizations) {
    try {
      await dispatchForOrganization(org.id, org.timezone);
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        "reminders.dispatch : échec sur une organisation, passage à la suivante",
      );
    }
  }
}
