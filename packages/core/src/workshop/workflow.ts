// M06 §5 — machines à états secondaires : tâche (ligne) côté atelier, demande de pièce,
// sous-traitance, contrôle qualité (RG-M06-11/12).
import { DomainError } from "../errors";
import type { ApprovalState, LineStatus, RepairOrderStatus } from "../repairOrders/types";

/** Statuts d'OR où un mécanicien peut pointer (US-M06-05). */
export const WORKABLE_ORDER_STATUSES: readonly RepairOrderStatus[] = [
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
];

export function assertTaskStartable(
  line: { status: LineStatus; approval: ApprovalState },
  orderStatus: RepairOrderStatus,
): void {
  if (line.approval === "PENDING" || line.approval === "DECLINED") {
    throw new DomainError(
      "task.awaiting_approval",
      "En attente d'accord client : cette tâche ne peut pas être démarrée.",
    );
  }
  if (line.status === "DONE") {
    throw new DomainError("task.done", "Cette tâche est déjà terminée.");
  }
  if (!WORKABLE_ORDER_STATUSES.includes(orderStatus)) {
    throw new DomainError(
      "task.order_not_workable",
      "L'OR doit être approuvé avant de commencer les travaux.",
    );
  }
}

// ───────────── Demandes de pièces (§5 PartRequest.status) ─────────────

export type PartRequestStatusValue =
  "REQUESTED" | "PREPARING" | "ORDERED" | "DELIVERED" | "REJECTED" | "CANCELLED";

const PART_REQUEST_TRANSITIONS: Record<PartRequestStatusValue, readonly PartRequestStatusValue[]> =
  {
    REQUESTED: ["PREPARING", "ORDERED", "REJECTED", "CANCELLED"],
    PREPARING: ["DELIVERED", "REJECTED"],
    ORDERED: ["DELIVERED"],
    DELIVERED: [],
    REJECTED: [],
    CANCELLED: [],
  };

export function assertPartRequestTransition(
  from: PartRequestStatusValue,
  to: PartRequestStatusValue,
  opts: { reason?: string | null; byRequester: boolean },
): void {
  if (!PART_REQUEST_TRANSITIONS[from].includes(to)) {
    throw new DomainError(
      "part_request.invalid_transition",
      "Ce changement de statut n'est pas possible pour cette demande.",
      { from, to },
    );
  }
  if (to === "REJECTED" && !opts.reason?.trim()) {
    throw new DomainError("part_request.reason_required", "Indiquez le motif du refus.");
  }
  if (to === "CANCELLED" && !opts.byRequester) {
    throw new DomainError(
      "part_request.cancel_requester_only",
      "Seul le demandeur peut annuler sa demande.",
    );
  }
}

// ───────────── Sous-traitance (RG-M06-12) ─────────────

export type SubcontractStatusValue = "TO_SEND" | "SENT" | "RETURNED" | "CANCELLED";
export const SUBCONTRACT_STATUSES: readonly SubcontractStatusValue[] = [
  "TO_SEND",
  "SENT",
  "RETURNED",
  "CANCELLED",
];

const SUBCONTRACT_TRANSITIONS: Record<SubcontractStatusValue, readonly SubcontractStatusValue[]> = {
  TO_SEND: ["SENT", "CANCELLED"],
  SENT: ["RETURNED", "CANCELLED"],
  RETURNED: [],
  CANCELLED: [],
};

export function assertSubcontractTransition(
  from: SubcontractStatusValue | null,
  to: SubcontractStatusValue,
): void {
  const current = from ?? "TO_SEND";
  if (!SUBCONTRACT_TRANSITIONS[current].includes(to)) {
    throw new DomainError(
      "subcontract.invalid_transition",
      "Ce changement de statut de sous-traitance n'est pas possible.",
      { from: current, to },
    );
  }
}

/** RG-M06-12 : « Sous-traitance vendue à perte » si prix de vente total < coût convenu. */
export function isSubcontractLoss(line: {
  unitPrice: number;
  quantity: number;
  costPrice: number | null;
}): boolean {
  if (line.costPrice === null) return false;
  return Math.round(line.unitPrice * line.quantity) < line.costPrice;
}

/** Retour prévu dépassé (ligne en rouge) tant que la pièce n'est pas revenue. */
export function isSubcontractOverdue(
  line: { subcontractStatus: string | null; subcontractExpectedAt: Date | null },
  now: Date,
): boolean {
  if (!line.subcontractExpectedAt) return false;
  if (line.subcontractStatus === "RETURNED" || line.subcontractStatus === "CANCELLED") return false;
  return line.subcontractExpectedAt.getTime() < now.getTime();
}

// ───────────── Contrôle qualité (RG-M06-11) ─────────────

/**
 * Le contrôleur ne peut pas être l'unique mécanicien ayant pointé sur l'OR, sauf permission
 * `workshop:qc_self`.
 */
export function assertQcCheckerAllowed(
  checkerMembershipId: string,
  workedMembershipIds: readonly string[],
  canQcSelf: boolean,
): void {
  if (canQcSelf) return;
  const workers = new Set(workedMembershipIds);
  if (workers.size === 1 && workers.has(checkerMembershipId)) {
    throw new DomainError(
      "qc.self_check",
      "Vous êtes le seul mécanicien à avoir travaillé sur cet OR : un autre contrôleur doit valider.",
    );
  }
}

/** Lignes concernées par une reprise : celles de l'OR effectivement terminées. */
export function reworkableLineIds(
  lines: readonly { id: string; status: LineStatus }[],
  requested: readonly string[],
): string[] {
  const done = new Set(lines.filter((l) => l.status === "DONE").map((l) => l.id));
  return [...new Set(requested)].filter((id) => done.has(id));
}
