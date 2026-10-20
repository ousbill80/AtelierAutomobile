// RG-M16-08 — relances de l'assureur (`ClaimFollowUp`, pas des `Reminder` M10 — A7) et
// RG-M16-11 — encours par compagnie (balance âgée) et délai moyen de paiement.
import { addDays, diffDays } from "../reminders/dates";

export interface FollowUpConfig {
  /** Jours après l'envoi du devis (accord attendu). */
  approval: number[];
  /** Jours après l'échéance de la facture assurance. */
  payment: number[];
  /** Après le dernier palier de paiement : une relance tous les N jours. */
  repeatEvery: number;
  /** Expert non passé : jours après la date de visite prévue. */
  expert: number;
}

export const DEFAULT_FOLLOW_UP_CONFIG: FollowUpConfig = {
  approval: [7, 14, 21],
  payment: [0, 15, 30],
  repeatEvery: 30,
  expert: 2,
};

function positiveInts(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const list = value.filter((v): v is number => Number.isInteger(v) && v >= 0);
  return list.length > 0 ? [...new Set(list)].sort((a, b) => a - b) : fallback;
}

/** `InsuranceCompany.followUpConfig` (paliers paramétrables par compagnie). */
export function followUpConfigFrom(raw: unknown): FollowUpConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const repeat = o.repeatEvery;
  const expert = o.expert;
  return {
    approval: positiveInts(o.approval, DEFAULT_FOLLOW_UP_CONFIG.approval),
    payment: positiveInts(o.payment, DEFAULT_FOLLOW_UP_CONFIG.payment),
    repeatEvery:
      Number.isInteger(repeat) && (repeat as number) > 0
        ? (repeat as number)
        : DEFAULT_FOLLOW_UP_CONFIG.repeatEvery,
    expert:
      Number.isInteger(expert) && (expert as number) >= 0
        ? (expert as number)
        : DEFAULT_FOLLOW_UP_CONFIG.expert,
  };
}

/** Jours non ouvrés : une relance prévue un samedi ou un dimanche part le lundi. */
export function nextWorkingDay(day: Date): Date {
  const weekday = day.getUTCDay();
  if (weekday === 6) return addDays(day, 2);
  if (weekday === 0) return addDays(day, 1);
  return day;
}

export interface PlannedFollowUp {
  kind: "expert" | "approval" | "payment";
  stepKey: string;
  scheduledFor: Date;
  invoiceId: string | null;
  dedupeKey: string;
  /** Dernier palier « accord » dépassé : escalade au propriétaire (§4). */
  escalate: boolean;
}

export interface FollowUpClaim {
  id: string;
  status: string;
  expertVisitAt: Date | null;
  expertVisitedAt: Date | null;
  estimateSentAt: Date | null;
}

export interface FollowUpInvoice {
  id: string;
  billTo: string;
  status: string;
  balance: number;
  dueDate: Date | null;
}

function day(date: Date): Date {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Relances dues à `today` (date métier, minuit UTC), dédoublonnées par `dedupeKey`
 * (`{claimId}:{kind}:{ancre}:{palier}` — l'ancre redémarre les délais d'un devis révisé).
 * Arrêt automatique : plus de relance « accord » hors `ESTIMATE_SENT`, plus de relance
 * « paiement » sur une facture soldée.
 */
export function planFollowUps(input: {
  claim: FollowUpClaim;
  invoices: readonly FollowUpInvoice[];
  config: FollowUpConfig;
  today: Date;
}): PlannedFollowUp[] {
  const { claim, config, today } = input;
  const out: PlannedFollowUp[] = [];
  const due = (d: Date) => d.getTime() <= today.getTime();

  if (claim.status === "EXPERT_SCHEDULED" && claim.expertVisitAt && !claim.expertVisitedAt) {
    const anchor = day(claim.expertVisitAt);
    const at = nextWorkingDay(addDays(anchor, config.expert));
    if (due(at)) {
      const stepKey = `J+${config.expert}`;
      out.push({
        kind: "expert",
        stepKey,
        scheduledFor: at,
        invoiceId: null,
        dedupeKey: `${claim.id}:expert:${iso(anchor)}:${stepKey}`,
        escalate: false,
      });
    }
  }

  if (claim.status === "ESTIMATE_SENT" && claim.estimateSentAt) {
    const anchor = day(claim.estimateSentAt);
    const last = config.approval[config.approval.length - 1];
    for (const n of config.approval) {
      const at = nextWorkingDay(addDays(anchor, n));
      if (!due(at)) continue;
      const stepKey = `J+${n}`;
      out.push({
        kind: "approval",
        stepKey,
        scheduledFor: at,
        invoiceId: null,
        dedupeKey: `${claim.id}:approval:${iso(anchor)}:${stepKey}`,
        escalate: n === last,
      });
    }
  }

  for (const invoice of input.invoices) {
    if (invoice.billTo !== "INSURANCE" || !invoice.dueDate || invoice.balance <= 0) continue;
    if (["DRAFT", "VOID", "PAID", "WRITTEN_OFF"].includes(invoice.status)) continue;
    const anchor = day(invoice.dueDate);
    const elapsed = diffDays(today, anchor);
    if (elapsed < 0) continue;
    const steps = [...config.payment];
    const lastStep = steps[steps.length - 1] ?? 0;
    for (let n = lastStep + config.repeatEvery; n <= elapsed; n += config.repeatEvery)
      steps.push(n);
    for (const n of steps) {
      const at = nextWorkingDay(addDays(anchor, n));
      if (!due(at)) continue;
      const stepKey = `J+${n}`;
      out.push({
        kind: "payment",
        stepKey,
        scheduledFor: at,
        invoiceId: invoice.id,
        dedupeKey: `${claim.id}:payment:${invoice.id}:${stepKey}`,
        escalate: n > 120,
      });
    }
  }
  return out;
}

/** Une relance due est-elle toujours justifiée juste avant l'envoi (CLAUDE.md, relances) ? */
export function followUpStillDue(input: {
  kind: string;
  claimStatus: string;
  expertVisitedAt: Date | null;
  invoiceBalance: number | null;
}): boolean {
  if (input.kind === "expert")
    return input.claimStatus === "EXPERT_SCHEDULED" && !input.expertVisitedAt;
  if (input.kind === "approval") return input.claimStatus === "ESTIMATE_SENT";
  return (input.invoiceBalance ?? 0) > 0;
}

// ───────────── RG-M16-11 — encours et délai moyen ─────────────

export const INSURER_AGE_BUCKETS = ["b0_30", "b31_60", "b61_90", "b91_120", "b120p"] as const;
export type InsurerAgeBucket = (typeof INSURER_AGE_BUCKETS)[number];

export function insurerAgeBucket(daysSinceIssue: number): InsurerAgeBucket {
  if (daysSinceIssue <= 30) return "b0_30";
  if (daysSinceIssue <= 60) return "b31_60";
  if (daysSinceIssue <= 90) return "b61_90";
  if (daysSinceIssue <= 120) return "b91_120";
  return "b120p";
}

/** Balance âgée des factures assurance (ancienneté depuis l'émission). */
export function insurerAging(
  invoices: readonly { balance: number; issuedAt: Date | null }[],
  today: Date,
): { outstanding: number; aging: Record<InsurerAgeBucket, number>; oldestDays: number | null } {
  const aging = Object.fromEntries(INSURER_AGE_BUCKETS.map((b) => [b, 0])) as Record<
    InsurerAgeBucket,
    number
  >;
  let outstanding = 0;
  let oldestDays: number | null = null;
  for (const i of invoices) {
    if (i.balance <= 0 || !i.issuedAt) continue;
    const d = Math.max(0, diffDays(today, day(i.issuedAt)));
    aging[insurerAgeBucket(d)] += i.balance;
    outstanding += i.balance;
    oldestDays = oldestDays === null ? d : Math.max(oldestDays, d);
  }
  return { outstanding, aging, oldestDays };
}

/** Délai moyen (jours, arrondi) entre émission et paiement soldant. Ex. 74, 96, 118 → 96. */
export function avgDaysToPay(paid: readonly { issuedAt: Date; paidAt: Date }[]): number | null {
  if (paid.length === 0) return null;
  const total = paid.reduce((s, p) => s + diffDays(day(p.paidAt), day(p.issuedAt)), 0);
  return Math.round(total / paid.length);
}

// ───────────── Texte des relances (modèles M11 `claim_approval_followup`, `claim_payment_followup`) ─────────────

export interface FollowUpMessageInput {
  kind: string;
  garageName: string;
  claimNumber: string;
  insurerClaimNumber: string | null;
  plate: string | null;
  insuredName: string;
  invoiceNumber?: string | null;
  balance?: string | null;
  daysLate?: number | null;
}

/** Objet et corps en français, variables {{sinistre.numero}}, {{facture.solde}}… déjà résolues. */
export function claimFollowUpMessage(input: FollowUpMessageInput): {
  subject: string;
  body: string;
} {
  const ref = `${input.claimNumber}${input.insurerClaimNumber ? ` (votre réf. ${input.insurerClaimNumber})` : ""}`;
  const vehicle = input.plate ? `, véhicule ${input.plate}` : "";
  if (input.kind === "payment") {
    return {
      subject: `Facture ${input.invoiceNumber} — sinistre ${input.claimNumber} — règlement attendu`,
      body:
        `Bonjour,\n\nSauf erreur de notre part, la facture ${input.invoiceNumber} relative au sinistre ${ref} ` +
        `de ${input.insuredName}${vehicle} reste impayée : solde ${input.balance}` +
        `${input.daysLate ? `, échue depuis ${input.daysLate} jours` : ""}.\n\n` +
        `Merci de nous indiquer la date de règlement prévue.\n\nCordialement,\n${input.garageName}`,
    };
  }
  if (input.kind === "expert") {
    return {
      subject: `Sinistre ${input.claimNumber} — visite d'expertise`,
      body:
        `Bonjour,\n\nNous attendons toujours la visite de l'expert pour le sinistre ${ref} de ` +
        `${input.insuredName}${vehicle}. Pouvez-vous nous confirmer une date ?\n\nCordialement,\n${input.garageName}`,
    };
  }
  return {
    subject: `Sinistre ${input.claimNumber} — accord de prise en charge attendu`,
    body:
      `Bonjour,\n\nNous vous avons transmis le devis de réparation du sinistre ${ref} de ` +
      `${input.insuredName}${vehicle}. Le véhicule est immobilisé dans l'attente de votre accord.\n\n` +
      `Merci de nous faire parvenir votre accord (ou vos observations) dès que possible.\n\nCordialement,\n${input.garageName}`,
  };
}
