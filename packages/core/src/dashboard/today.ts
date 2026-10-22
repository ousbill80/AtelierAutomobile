// M12 — onglet « Aujourd'hui » : vue du jour de l'atelier (véhicules, caisse, VT à préparer,
// relances, dossiers assurance, impayés, encaissements 7 j). Fonctions pures ; le routeur
// `dashboard.today` charge les faits et applique permissions et filtre site.
import { daysOverdue, isOpenReceivable, isOverdue } from "../receivables/aging";
import { diffDays } from "../reminders/dates";
import { asOfDate, type ReceivableInvoiceLike } from "./receivables";
import { shiftDay } from "./period";

// ---------------------------------------------------------------------------
// Véhicules en atelier
// ---------------------------------------------------------------------------

export type WorkshopStage = "checkedIn" | "diagnosis" | "repair" | "ready";

export const WORKSHOP_STAGES: readonly WorkshopStage[] = [
  "checkedIn",
  "diagnosis",
  "repair",
  "ready",
];

/** Regroupe les statuts d'OR en 4 étapes lisibles ; `null` hors atelier (brouillon, livré…). */
export function workshopStage(status: string): WorkshopStage | null {
  switch (status) {
    case "CHECKED_IN":
      return "checkedIn";
    case "DIAGNOSING":
    case "AWAITING_APPROVAL":
      return "diagnosis";
    case "APPROVED":
    case "IN_PROGRESS":
    case "WAITING_PARTS":
    case "QUALITY_CHECK":
      return "repair";
    case "READY":
      return "ready";
    default:
      return null;
  }
}

export function countWorkshopStages(statuses: readonly string[]): Record<WorkshopStage, number> {
  const counts: Record<WorkshopStage, number> = { checkedIn: 0, diagnosis: 0, repair: 0, ready: 0 };
  for (const status of statuses) {
    const stage = workshopStage(status);
    if (stage) counts[stage] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Visites techniques à préparer
// ---------------------------------------------------------------------------

/** Horizon de la liste des VT à préparer (jours). */
export const INSPECTION_HORIZON_DAYS = 60;

export type InspectionBand = "j15" | "j30" | "j60";

export const INSPECTION_BANDS: readonly InspectionBand[] = ["j60", "j30", "j15"];

/** Jours restants avant l'échéance (date métier) ; négatif si dépassée. */
export function daysUntil(dueDate: Date, today: string): number {
  return diffDays(dueDate, asOfDate(today));
}

/** Tranche J-15 / J-30 / J-60 ; une échéance dépassée compte en J-15 (la plus urgente). */
export function inspectionBand(daysLeft: number): InspectionBand | null {
  if (daysLeft <= 15) return "j15";
  if (daysLeft <= 30) return "j30";
  if (daysLeft <= INSPECTION_HORIZON_DAYS) return "j60";
  return null;
}

export type InspectionFollowUp =
  "booked" | "toCall" | "read" | "sent" | "toApprove" | "planned" | "none";

export interface InspectionReminderLike {
  status: string;
  channel: string | null;
  outcome: string | null;
  messageStatus: string | null;
}

/**
 * État de la relance VT d'un véhicule, du plus avancé au moins avancé : RDV pris, à appeler
 * (relance sans canal joignable, onglet « À appeler » M10), message lu, envoyé, à valider,
 * planifié, aucune.
 */
export function inspectionFollowUp(
  reminders: readonly InspectionReminderLike[],
): InspectionFollowUp {
  if (reminders.some((r) => r.outcome === "APPOINTMENT_BOOKED")) return "booked";
  if (reminders.some((r) => r.status === "NEEDS_APPROVAL" && r.channel === null)) return "toCall";
  if (reminders.some((r) => r.messageStatus === "READ")) return "read";
  if (reminders.some((r) => r.status === "SENT")) return "sent";
  if (reminders.some((r) => r.status === "NEEDS_APPROVAL")) return "toApprove";
  if (reminders.some((r) => r.status === "PLANNED" || r.status === "QUEUED")) return "planned";
  return "none";
}

export function countInspectionBands(daysLeft: readonly number[]): Record<InspectionBand, number> {
  const counts: Record<InspectionBand, number> = { j60: 0, j30: 0, j15: 0 };
  for (const d of daysLeft) {
    const band = inspectionBand(d);
    if (band) counts[band] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Relances à venir
// ---------------------------------------------------------------------------

export interface UpcomingReminderLike {
  type: string;
  /** Jour local `yyyy-MM-dd` de l'envoi prévu. */
  day: string;
}

export interface UpcomingDay {
  day: string;
  total: number;
  byType: { type: string; count: number }[];
}

/** Groupe les envois prévus par jour local (ordre chronologique), puis par type (du plus fréquent). */
export function groupUpcomingReminders(reminders: readonly UpcomingReminderLike[]): UpcomingDay[] {
  const days = new Map<string, Map<string, number>>();
  for (const r of reminders) {
    const byType = days.get(r.day) ?? new Map<string, number>();
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    days.set(r.day, byType);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, byType]) => {
      const types = [...byType.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
      return { day, total: types.reduce((s, t) => s + t.count, 0), byType: types };
    });
}

/** Lundi de la semaine du jour local donné (`yyyy-MM-dd`). */
export function weekStartDay(today: string): string {
  const weekday = asOfDate(today).getUTCDay(); // 0 = dimanche
  return shiftDay(today, -((weekday + 6) % 7));
}

// ---------------------------------------------------------------------------
// Dossiers assurance
// ---------------------------------------------------------------------------

export type ClaimStage = "awaitingApproval" | "approved" | "invoiced" | "late";

export const CLAIM_STAGES: readonly ClaimStage[] = [
  "awaitingApproval",
  "approved",
  "invoiced",
  "late",
];

export interface ClaimStageInput {
  status: string;
  /** Montant du devis assurance retenu (en attente d'accord). */
  estimateAmount: number | null;
  approvedAmount: number | null;
  /** Facture assureur émise : solde et échéance. */
  insurerBalance: number | null;
  insurerDueDate: Date | null;
}

/**
 * Étape d'un sinistre vue de la trésorerie : en attente d'accord, accord reçu, facturé à
 * l'assureur, remboursement en retard (facture assureur échue et non soldée). `null` : dossier
 * clos, rejeté ou sans montant à recevoir.
 */
export function claimStage(
  claim: ClaimStageInput,
  today: string,
): { stage: ClaimStage; amount: number } | null {
  switch (claim.status) {
    case "OPENED":
    case "EXPERT_SCHEDULED":
    case "ESTIMATE_SENT":
      return { stage: "awaitingApproval", amount: claim.estimateAmount ?? 0 };
    case "APPROVED":
    case "REPAIRING":
      return { stage: "approved", amount: claim.approvedAmount ?? 0 };
    case "INVOICED":
    case "PARTIALLY_PAID": {
      const balance = claim.insurerBalance ?? 0;
      if (balance <= 0) return null;
      const late = daysOverdue(claim.insurerDueDate, asOfDate(today)) >= 1;
      return { stage: late ? "late" : "invoiced", amount: balance };
    }
    default:
      return null;
  }
}

export interface ClaimStagesSummary {
  total: number;
  stages: Record<ClaimStage, { count: number; amount: number }>;
}

export function summarizeClaimStages(
  claims: readonly ClaimStageInput[],
  today: string,
): ClaimStagesSummary {
  const stages = Object.fromEntries(
    CLAIM_STAGES.map((s) => [s, { count: 0, amount: 0 }]),
  ) as Record<ClaimStage, { count: number; amount: number }>;
  let total = 0;
  for (const claim of claims) {
    const res = claimStage(claim, today);
    if (!res) continue;
    stages[res.stage].count += 1;
    stages[res.stage].amount += res.amount;
    total += res.amount;
  }
  return { total, stages };
}

// ---------------------------------------------------------------------------
// Factures impayées
// ---------------------------------------------------------------------------

/** Seuil du compteur « échues depuis plus de N jours » de la carte Impayés. */
export const LONG_OVERDUE_DAYS = 15;

export interface UnpaidSummary {
  total: number;
  count: number;
  overdueCount: number;
  longOverdueCount: number;
  overdue: {
    id: string;
    number: string | null;
    customerName: string;
    balance: number;
    daysOverdue: number;
  }[];
  /** Factures en retard au-delà de la liste affichée. */
  more: { count: number; amount: number };
}

/**
 * Créances client (définition M09 : assurance et avoirs exclus), factures en retard triées du
 * plus ancien retard au plus récent, et compteur au-delà de `LONG_OVERDUE_DAYS`.
 */
export function summarizeUnpaid(
  invoices: readonly ReceivableInvoiceLike[],
  today: string,
  limit = 4,
): UnpaidSummary {
  const asOf = asOfDate(today);
  const open = invoices.filter((i) => i.type === "INVOICE" && isOpenReceivable(i));
  const overdue = open
    .filter((i) => isOverdue(i, asOf))
    .map((i) => ({
      id: i.id,
      number: i.number ?? null,
      customerName: i.customerName ?? "",
      balance: i.balance,
      daysOverdue: daysOverdue(i.dueDate, asOf),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);
  const rest = overdue.slice(limit);
  return {
    total: open.reduce((s, i) => s + i.balance, 0),
    count: open.length,
    overdueCount: overdue.length,
    longOverdueCount: overdue.filter((i) => i.daysOverdue > LONG_OVERDUE_DAYS).length,
    overdue: overdue.slice(0, limit),
    more: { count: rest.length, amount: rest.reduce((s, i) => s + i.balance, 0) },
  };
}

// ---------------------------------------------------------------------------
// Encaissements des derniers jours
// ---------------------------------------------------------------------------

/** Les `count` derniers jours locaux, du plus ancien à aujourd'hui inclus. */
export function lastDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDay(today, i - (count - 1)));
}
