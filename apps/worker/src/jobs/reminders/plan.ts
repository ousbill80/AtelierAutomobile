import { formatInTimeZone } from "date-fns-tz";
import {
  approvalExpiry,
  dedupeKey as buildDedupeKey,
  initialReminderStatus,
  isDispatchPaused,
  isEligible,
  isWithinCandidateWindow,
  nextSendSlot,
  pickStep,
  priorityOf,
  resolveReminderChannels,
  reminderSequenceKey as buildSequenceKey,
  targetDate,
  type ReminderChannel,
  type ReminderType,
} from "@atelieros/core";
import type {
  CustomerContext,
  NewReminderInput,
  OrganizationContext,
  ReminderCandidate,
  RuleContext,
  StepHistoryRow,
} from "./types";

/** Types de relance couverts par cette tranche (INSPECTION/SERVICE/RECEIVABLE, cf. rapport). */
export const PLANNED_REMINDER_TYPES: readonly ReminderType[] = [
  "INSPECTION",
  "SERVICE",
  "RECEIVABLE",
];

export interface CandidateWithCustomer {
  candidate: ReminderCandidate;
  customer: CustomerContext;
}

/** Dépendances d'accès aux données du job `reminders.plan`, injectées pour rester testable sans DB réelle. */
export interface RemindersPlanRepository {
  /** Règles actives de l'organisation, tous types confondus (le job filtre lui-même la tranche couverte). */
  listActiveRules(organizationId: string): Promise<RuleContext[]>;
  listCandidates(
    organizationId: string,
    type: ReminderType,
    now: Date,
  ): Promise<CandidateWithCustomer[]>;
  listSequenceHistory(organizationId: string, sequenceKey: string): Promise<StepHistoryRow[]>;
  isSuppressed(
    organizationId: string,
    target: {
      sequenceKey: string;
      customerId: string;
      vehicleId?: string | null;
      type: ReminderType;
    },
    now: Date,
  ): Promise<boolean>;
  reminderExists(organizationId: string, dedupeKey: string): Promise<boolean>;
  createReminder(input: NewReminderInput): Promise<void>;
  /** RG-M10-19 — bascule `SKIPPED` les validations expirées (`NEEDS_APPROVAL` + `approvalExpiresAt <= now`). */
  expireOverdueApprovals(organizationId: string, now: Date): Promise<number>;
  /** Remet en `PLANNED` les relances `SNOOZED` dont l'échéance de report est atteinte. */
  reactivateSnoozed(organizationId: string, now: Date): Promise<number>;
  /**
   * RG-M10-29 — ancienneté (en heures) de la dernière synchronisation réussie des créances, pour
   * une organisation en `REMINDERS_ONLY`. `null` = aucune donnée de fraîcheur disponible (ne bloque
   * rien, seulement pertinent en `REMINDERS_ONLY`).
   */
  receivableDataAgeHours(organizationId: string, now: Date): Promise<number | null>;
}

export interface PlanResult {
  created: number;
  skippedNoChannel: number;
  flaggedDataQuality: number;
  expiredApprovals: number;
  reactivatedSnoozed: number;
}

/**
 * Date locale (minuit UTC du jour civil de l'organisation), comme le pseudo-code du PRD
 * (`toZonedDate(now, org.timezone)`) : `pickStep`/`isWithinCandidateWindow` comparent des jours
 * civils, pas des instants — sans cette troncature, `pickStep` marquerait presque toujours
 * `catchUp: true` (l'horloge réelle n'est quasiment jamais exactement à minuit UTC).
 */
function localToday(now: Date, timeZone: string): Date {
  const dayKey = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  return new Date(`${dayKey}T00:00:00.000Z`);
}

const EMPTY_RESULT: PlanResult = {
  created: 0,
  skippedNoChannel: 0,
  flaggedDataQuality: 0,
  expiredApprovals: 0,
  reactivatedSnoozed: 0,
};

/**
 * RG-M10-01 à RG-M10-19 — planifie les relances `INSPECTION`/`SERVICE`/`RECEIVABLE` dues pour une
 * organisation. Fonctions pures de `@atelieros/core` pour tout le calcul métier ; ce module ne fait
 * qu'orchestrer (charger via `repo`, décider, persister), conformément à CLAUDE.md.
 */
export async function planOrganizationReminders(
  repo: RemindersPlanRepository,
  org: OrganizationContext,
  now: Date,
): Promise<PlanResult> {
  // RG-M10-18 — interrupteur général : aucune nouvelle relance tant que `PAUSED` est actif.
  if (isDispatchPaused(org.settings.approvalMode)) return EMPTY_RESULT;

  const expiredApprovals = await repo.expireOverdueApprovals(org.id, now);
  const reactivatedSnoozed = await repo.reactivateSnoozed(org.id, now);

  const result: PlanResult = {
    ...EMPTY_RESULT,
    expiredApprovals,
    reactivatedSnoozed,
  };

  const today = localToday(now, org.timezone);

  const rules = (await repo.listActiveRules(org.id)).filter((rule) =>
    PLANNED_REMINDER_TYPES.includes(rule.type),
  );

  for (const rule of rules) {
    const candidates = await repo.listCandidates(org.id, rule.type, today);

    let receivableDataAgeHours: number | null = null;
    if (rule.type === "RECEIVABLE" && org.operatingMode === "REMINDERS_ONLY") {
      receivableDataAgeHours = await repo.receivableDataAgeHours(org.id, now);
    }
    // RG-M10-29 — au-delà de 7 jours sans synchronisation, on n'en crée plus du tout.
    if (receivableDataAgeHours !== null && receivableDataAgeHours > 24 * 7) {
      continue;
    }
    const forceNeedsApproval =
      receivableDataAgeHours !== null && receivableDataAgeHours > org.settings.maxDataAgeHours;

    for (const { candidate, customer } of candidates) {
      if (!isWithinCandidateWindow(rule.type, candidate.anchor, today)) continue;

      if (candidate.isInspectionDateSuspect || (candidate.plateOccurrences ?? 1) > 1) {
        result.flaggedDataQuality += 1;
        continue;
      }

      const isOptedOut = customer.optedOutChannels.length > 0;
      const eligible = isEligible(
        rule.type,
        {
          customerType: customer.type,
          deletedAt: customer.deletedAt,
          doNotRemind: customer.doNotRemind,
          remindersConsent: customer.remindersConsent,
          isOptedOut,
          tags: customer.tags,
          siteId: candidate.siteId ?? null,
          vehicleYear: candidate.vehicleYear ?? null,
          amount: candidate.amount ?? null,
        },
        rule.conditions,
      );
      if (!eligible) continue;

      const seqKey = buildSequenceKey(
        rule.type,
        candidate.entityId,
        candidate.anchor,
        org.timezone,
      );

      const suppressed = await repo.isSuppressed(
        org.id,
        {
          sequenceKey: seqKey,
          customerId: customer.id,
          vehicleId: candidate.vehicleId,
          type: rule.type,
        },
        now,
      );
      if (suppressed) continue;

      const history = await repo.listSequenceHistory(org.id, seqKey);
      const pick = pickStep(rule.steps, { default: candidate.anchor }, today, history, {
        minGapDays: rule.minGapDays ?? org.settings.minGapDays,
        catchUpDays: rule.catchUpDays ?? org.settings.catchUpDays,
      });
      if (!pick) continue;

      const dedupe = buildDedupeKey(seqKey, pick.step.key);
      if (await repo.reminderExists(org.id, dedupe)) continue;

      const phoneE164 = customer.whatsappPhone ?? customer.phone ?? customer.phone2 ?? null;
      const channels: ReminderChannel[] = resolveReminderChannels({
        preferredChannel: customer.preferredChannel,
        stepChannels: pick.step.channels,
        hasWhatsapp: customer.hasWhatsapp,
        phoneE164: customer.phoneInvalidAt ? null : phoneE164,
        email: customer.email,
        optedOutChannels: customer.optedOutChannels,
      });
      const hasChannel = channels.length > 0;

      const status = initialReminderStatus({
        autoSend: pick.step.autoSend,
        approvalMode: org.settings.approvalMode,
        isCatchUp: pick.catchUp,
        hasChannel,
      });
      const finalStatus = forceNeedsApproval ? "NEEDS_APPROVAL" : status;

      const scheduledFor = nextSendSlot({
        targetDate: targetDate({ default: candidate.anchor }, pick.step),
        offsetSign: pick.step.offsetDays < 0 ? "before" : "on_or_after",
        sendAt: pick.step.sendAt,
        sendWindow: rule.sendWindow,
        holidays: org.settings.holidays,
        timeZone: org.timezone,
        now,
        siteId: candidate.siteId,
      });

      await repo.createReminder({
        organizationId: org.id,
        ruleId: rule.id,
        type: rule.type,
        stepKey: pick.step.key,
        customerId: customer.id,
        vehicleId: candidate.vehicleId ?? null,
        invoiceId: candidate.invoiceId ?? null,
        dueDate: candidate.anchor,
        scheduledFor,
        status: finalStatus,
        channel: hasChannel ? (channels[0] as ReminderChannel) : null,
        dedupeKey: dedupe,
        sequenceKey: seqKey,
        priority: priorityOf(rule.type, pick.step.key),
        isCatchUp: pick.catchUp,
        approvalExpiresAt: approvalExpiry(rule.steps, { default: candidate.anchor }, pick.step),
      });

      result.created += 1;
      if (!hasChannel) result.skippedNoChannel += 1;
    }
  }

  return result;
}
