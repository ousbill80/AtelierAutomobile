// Onglet « Relances » (M12 §7) : envoyés / délivrés / lus, clients revenus après rappel,
// taux de retour VT / révision (RG-M12-24). Le montant récupéré (RG-M12-22) vient des
// `PaymentAttribution` M09 : voir `recoveredByReminders` (./receivables).
// Les faits viennent de M10/M11 (`Reminder` + statut du `Message` porteur).
import { inRange } from "./period";

export interface ReminderFactLike {
  type: string;
  status: string;
  sentAt: Date | null;
  /** Statut du message M11 porteur (`Reminder.message.status`). */
  messageStatus: string | null;
  outcome: string | null;
  outcomeAt: Date | null;
  attributedAmount: number | null;
  attributedRevenue: number | null;
  customerId: string;
  vehicleId: string | null;
  dueDate: Date;
}

export interface ReminderResults {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  sentByType: Record<string, number>;
  /** Clients distincts revenus (RDV pris ou visite) après une relance, sur la période. */
  returnedCustomers: number;
  /** CA généré par les retours VT / révision — affiché à part, jamais additionné. */
  generatedRevenue: number;
}

const RETURN_OUTCOMES = new Set(["APPOINTMENT_BOOKED", "VISITED"]);

export function computeReminderResults(
  facts: readonly ReminderFactLike[],
  from: Date,
  to: Date,
): ReminderResults {
  const results: ReminderResults = {
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    sentByType: {},
    returnedCustomers: 0,
    generatedRevenue: 0,
  };
  const returned = new Set<string>();
  for (const fact of facts) {
    if (fact.status === "SENT" && inRange(fact.sentAt, from, to)) {
      results.sent += 1;
      results.sentByType[fact.type] = (results.sentByType[fact.type] ?? 0) + 1;
      if (fact.messageStatus === "DELIVERED" || fact.messageStatus === "READ")
        results.delivered += 1;
      if (fact.messageStatus === "READ") results.read += 1;
    }
    if (fact.status === "FAILED" && inRange(fact.sentAt ?? fact.outcomeAt, from, to)) {
      results.failed += 1;
    }
    if (!fact.outcome || !inRange(fact.outcomeAt, from, to)) continue;
    if (RETURN_OUTCOMES.has(fact.outcome)) {
      returned.add(fact.customerId);
      results.generatedRevenue += fact.attributedRevenue ?? 0;
    }
  }
  results.returnedCustomers = returned.size;
  return results;
}

export interface WeeklySends {
  /** Lundi de la semaine (`yyyy-MM-dd`, UTC). */
  weekStart: string;
  byType: Record<string, number>;
  total: number;
}

function mondayOf(date: Date): string {
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset))
    .toISOString()
    .slice(0, 10);
}

/** Graphique « envois par semaine empilés par type » (M12 §7, onglet Relances). */
export function weeklySends(
  facts: readonly ReminderFactLike[],
  from: Date,
  to: Date,
): WeeklySends[] {
  const weeks = new Map<string, WeeklySends>();
  for (const fact of facts) {
    if (fact.status !== "SENT" || !fact.sentAt || !inRange(fact.sentAt, from, to)) continue;
    const key = mondayOf(fact.sentAt);
    const week = weeks.get(key) ?? { weekStart: key, byType: {}, total: 0 };
    week.byType[fact.type] = (week.byType[fact.type] ?? 0) + 1;
    week.total += 1;
    weeks.set(key, week);
  }
  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** RG-M12-24 : délai de grâce G après l'échéance (30 j VT, 60 j révision). */
export const RETURN_GRACE_DAYS = { INSPECTION: 30, SERVICE: 60 } as const;
export type ReturnRateType = keyof typeof RETURN_GRACE_DAYS;

export interface ReturnRate {
  cohort: number;
  returned: number;
  /** Échéances dont `dueDate + G` n'est pas passé et sans retour : « en cours », hors taux. */
  pending: number;
  /** Retours / (cohorte − en cours) ; null si dénominateur nul. */
  rate: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * RG-M12-24 — cohorte = couples distincts `(vehicleId, dueDate)` ayant au moins une relance
 * SENT du type, `dueDate` dans `[from, to)`. Retour si un RDV / OR est intervenu entre la
 * première relance envoyée et `dueDate + G`. En l'absence des modules RDV/OR (M03/M04), le
 * retour est lu sur le résultat consolidé par M10 (`outcome` APPOINTMENT_BOOKED | VISITED).
 */
export function computeReturnRate(
  facts: readonly ReminderFactLike[],
  type: ReturnRateType,
  from: Date,
  to: Date,
  now: Date,
): ReturnRate {
  const grace = RETURN_GRACE_DAYS[type] * MS_PER_DAY;
  const cohort = new Map<
    string,
    { dueDate: Date; firstSentAt: number; returnedAt: number | null }
  >();
  for (const fact of facts) {
    if (fact.type !== type || !fact.vehicleId || !inRange(fact.dueDate, from, to)) continue;
    const key = `${fact.vehicleId}:${fact.dueDate.toISOString().slice(0, 10)}`;
    const entry = cohort.get(key) ?? {
      dueDate: fact.dueDate,
      firstSentAt: Infinity,
      returnedAt: null,
    };
    if (fact.status === "SENT" && fact.sentAt) {
      entry.firstSentAt = Math.min(entry.firstSentAt, fact.sentAt.getTime());
    }
    if (fact.outcome && RETURN_OUTCOMES.has(fact.outcome) && fact.outcomeAt) {
      const at = fact.outcomeAt.getTime();
      entry.returnedAt = entry.returnedAt === null ? at : Math.min(entry.returnedAt, at);
    }
    cohort.set(key, entry);
  }
  let size = 0;
  let returned = 0;
  let pending = 0;
  for (const entry of cohort.values()) {
    if (entry.firstSentAt === Infinity) continue; // aucune relance envoyée : hors cohorte
    size += 1;
    const deadline = entry.dueDate.getTime() + grace;
    const isReturn =
      entry.returnedAt !== null &&
      entry.returnedAt >= entry.firstSentAt &&
      entry.returnedAt <= deadline;
    if (isReturn) returned += 1;
    else if (deadline > now.getTime()) pending += 1;
  }
  const denominator = size - pending;
  return { cohort: size, returned, pending, rate: denominator > 0 ? returned / denominator : null };
}
