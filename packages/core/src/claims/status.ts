// M16 §5 — machine à états des dossiers sinistre, statut de règlement dérivé des factures,
// contrôles de pièces jointes (RG-M16-09) et badges de blocage (US-M16-09).
import { DomainError } from "../errors";

export const CLAIM_STATUSES = [
  "OPENED",
  "EXPERT_SCHEDULED",
  "ESTIMATE_SENT",
  "APPROVED",
  "REPAIRING",
  "INVOICED",
  "PARTIALLY_PAID",
  "PAID",
  "REJECTED",
  "CANCELLED",
] as const;
export type ClaimStatusLike = (typeof CLAIM_STATUSES)[number];

export type ClaimAction =
  | "schedule_expert"
  | "send_estimate"
  | "approve"
  | "start_repair"
  | "invoice"
  | "reject"
  | "cancel";

const STATUS_LABEL: Record<ClaimStatusLike, string> = {
  OPENED: "Ouvert",
  EXPERT_SCHEDULED: "Expert planifié",
  ESTIMATE_SENT: "Devis envoyé",
  APPROVED: "Accord reçu",
  REPAIRING: "En réparation",
  INVOICED: "Facturé",
  PARTIALLY_PAID: "Partiellement réglé",
  PAID: "Réglé",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
};

const TRANSITIONS: Record<ClaimAction, { from: readonly ClaimStatusLike[]; to: ClaimStatusLike }> =
  {
    schedule_expert: { from: ["OPENED", "EXPERT_SCHEDULED"], to: "EXPERT_SCHEDULED" },
    // Supplément découvert en cours de réparation : le dossier repasse ESTIMATE_SENT (§11).
    send_estimate: {
      from: ["OPENED", "EXPERT_SCHEDULED", "ESTIMATE_SENT", "APPROVED", "REPAIRING"],
      to: "ESTIMATE_SENT",
    },
    approve: { from: ["ESTIMATE_SENT"], to: "APPROVED" },
    start_repair: { from: ["APPROVED"], to: "REPAIRING" },
    invoice: { from: ["APPROVED", "REPAIRING"], to: "INVOICED" },
    reject: { from: ["OPENED", "EXPERT_SCHEDULED", "ESTIMATE_SENT"], to: "REJECTED" },
    cancel: {
      from: ["OPENED", "EXPERT_SCHEDULED", "ESTIMATE_SENT", "APPROVED", "REPAIRING", "REJECTED"],
      to: "CANCELLED",
    },
  };

export function claimStatusLabel(status: ClaimStatusLike): string {
  return STATUS_LABEL[status];
}

/** Renvoie le statut cible, ou lève une erreur française si l'action est impossible. */
export function claimTransition(status: ClaimStatusLike, action: ClaimAction): ClaimStatusLike {
  const spec = TRANSITIONS[action];
  if (!spec.from.includes(status)) {
    throw new DomainError(
      "claims.invalid_transition",
      `Action impossible : le dossier est « ${STATUS_LABEL[status]} ».`,
      { status, action },
    );
  }
  return spec.to;
}

export interface ClaimInvoiceLike {
  billTo: string;
  type: string;
  status: string;
  total: number;
  balance: number;
  amountPaid: number;
  creditedAmount?: number;
}

/**
 * RG-M16-07 — dossier `PAID` quand factures assurance **et** client sont soldées ou avoirées ;
 * `PARTIALLY_PAID` si l'une seulement ou en partie ; sinon `INVOICED`. `null` si aucune facture
 * émise (le statut du dossier ne dépend pas encore des factures).
 */
export function claimPaymentStatus(
  invoices: readonly ClaimInvoiceLike[],
): "INVOICED" | "PARTIALLY_PAID" | "PAID" | null {
  const issued = invoices.filter(
    (i) => i.type !== "CREDIT_NOTE" && i.status !== "DRAFT" && i.status !== "VOID",
  );
  if (issued.length === 0) return null;
  const hasInsurer = issued.some((i) => i.billTo === "INSURANCE");
  const allSettled = issued.every((i) => i.balance === 0);
  if (allSettled && hasInsurer) return "PAID";
  const anyMovement = issued.some(
    (i) => i.amountPaid > 0 || (i.creditedAmount ?? 0) > 0 || (i.balance === 0 && i.total > 0),
  );
  return anyMovement || allSettled ? "PARTIALLY_PAID" : "INVOICED";
}

/** RG-M16-09 — kinds de pièces jointes reconnus pour un dossier. */
export const CLAIM_ATTACHMENT_KINDS = [
  "claim_report",
  "photo_damage",
  "photo_repair",
  "expert_report",
  "approval_letter",
  "registration",
  "insurance_certificate",
  "driver_license",
  "police_report",
  "invoice_supplier",
  "other",
] as const;
export type ClaimAttachmentKind = (typeof CLAIM_ATTACHMENT_KINDS)[number];

export const DEFAULT_REQUIRED_DOCUMENTS: readonly ClaimAttachmentKind[] = [
  "claim_report",
  "photo_damage",
  "registration",
  "insurance_certificate",
];

export function missingDocuments(
  required: readonly string[] | null | undefined,
  present: readonly string[],
): string[] {
  const list = required && required.length > 0 ? required : DEFAULT_REQUIRED_DOCUMENTS;
  const have = new Set(present);
  return list.filter((k) => !have.has(k));
}

/** RG-M16-09 — facturation : PV d'expertise ou lettre d'accord obligatoire ; n° assureur aussi. */
export function assertInvoiceable(input: {
  claimNumber: string | null;
  attachmentKinds: readonly string[];
}): void {
  if (!input.claimNumber?.trim()) {
    throw new DomainError(
      "claims.claim_number_required",
      "Renseignez le n° de sinistre de l'assureur avant de facturer.",
    );
  }
  if (!input.attachmentKinds.some((k) => k === "expert_report" || k === "approval_letter")) {
    throw new DomainError(
      "claims.approval_document_required",
      "Joignez le PV d'expertise ou la lettre d'accord avant de facturer.",
    );
  }
}

const DAY = 86_400_000;

function days(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY);
}

export type ClaimBlocker =
  | { code: "expert_overdue"; days: number }
  | { code: "approval_waiting"; days: number }
  | { code: "ready_deductible_unpaid"; amount: number }
  | { code: "insurer_invoice_overdue"; days: number };

/** US-M16-09 — badges « Expert non passé depuis 5 j », « Accord attendu depuis 12 j »… */
export function claimBlockers(input: {
  status: ClaimStatusLike;
  expertVisitAt: Date | null;
  expertVisitedAt: Date | null;
  estimateSentAt: Date | null;
  repairOrderReady: boolean;
  customerBalance: number;
  insurerInvoiceDueDate: Date | null;
  insurerBalance: number;
  today: Date;
}): ClaimBlocker[] {
  const out: ClaimBlocker[] = [];
  if (
    input.status === "EXPERT_SCHEDULED" &&
    input.expertVisitAt &&
    !input.expertVisitedAt &&
    days(input.expertVisitAt, input.today) >= 2
  ) {
    out.push({ code: "expert_overdue", days: days(input.expertVisitAt, input.today) });
  }
  if (input.status === "ESTIMATE_SENT" && input.estimateSentAt) {
    const d = days(input.estimateSentAt, input.today);
    if (d >= 7) out.push({ code: "approval_waiting", days: d });
  }
  if (input.repairOrderReady && input.customerBalance > 0) {
    out.push({ code: "ready_deductible_unpaid", amount: input.customerBalance });
  }
  if (input.insurerInvoiceDueDate && input.insurerBalance > 0) {
    const d = days(input.insurerInvoiceDueDate, input.today);
    if (d > 0) out.push({ code: "insurer_invoice_overdue", days: d });
  }
  return out;
}

/** US-M16-01 — police expirée à la date de l'accident (avertissement non bloquant). */
export function policyExpiredAtAccident(
  insuranceExpiryDate: Date | null,
  accidentDate: Date | null,
): boolean {
  return Boolean(
    insuranceExpiryDate && accidentDate && insuranceExpiryDate.getTime() < accidentDate.getTime(),
  );
}
