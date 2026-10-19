// M04 §5 — machine à états de l'OR. Fonction pure : toutes les procédures (et le kanban)
// passent par `canTransition` avant de changer un statut.
import {
  STATUS_RANK,
  type ApprovalState,
  type LineStatus,
  type LineType,
  type RepairOrderStatus,
} from "./types";

export const REPAIR_ORDER_TRANSITIONS = [
  "check_in",
  "start_diagnosis",
  "approve",
  "request_approval",
  "decline_all",
  "start_work",
  "wait_parts",
  "resume",
  "complete_work",
  "qc_pass",
  "qc_reject",
  "deliver",
  "invoice_issued",
  "reopen",
  "cancel",
] as const;
export type RepairOrderTransition = (typeof REPAIR_ORDER_TRANSITIONS)[number];

/** Transitions déclenchées par un utilisateur via `repairOrder.transition` (§8). */
export const MANUAL_TRANSITIONS: readonly RepairOrderTransition[] = [
  "start_diagnosis",
  "approve",
  "request_approval",
  "start_work",
  "wait_parts",
  "resume",
  "complete_work",
  "qc_pass",
  "qc_reject",
  "reopen",
  "cancel",
];

export interface TransitionOrder {
  status: RepairOrderStatus;
  isComeback?: boolean;
  warrantyDecision?: string | null;
}

export interface TransitionLine {
  type: LineType;
  status: LineStatus;
  approval: ApprovalState;
}

export interface TransitionContext {
  /** Permissions de l'utilisateur ; ignorées si `system`. */
  permissions: ReadonlySet<string>;
  /** Transition automatique (événement, job) : pas de contrôle de permission. */
  system?: boolean;
  qcRequired?: boolean;
  reason?: string | null;
  /** Pointages ouverts sur l'OR (M06), avec le nom du premier mécanicien. */
  openTimeEntries?: number;
  openTimeEntryName?: string | null;
  /** Pièces sorties du stock et non retournées (M07). */
  issuedPartsNotReturned?: number;
  /** Lignes PART non disponibles en stock (M07 : onHand − reserved < quantité). */
  unavailablePartLines?: number;
  /** Facture émise couvrant l'OR (M08). */
  hasIssuedInvoice?: boolean;
  /** RG-M04-14 : QC forcé par MANAGER avec motif pour restituer depuis QUALITY_CHECK. */
  forceFromQualityCheck?: boolean;
  /** RG-M04-13 : check-list sans NOK. */
  qcPassed?: boolean;
}

export type TransitionResult =
  { ok: true; to: RepairOrderStatus } | { ok: false; code: TransitionRefusal; message: string };

export type TransitionRefusal =
  | "INVALID_FROM_STATUS"
  | "FORBIDDEN"
  | "NO_APPROVED_LINE"
  | "PENDING_LINES"
  | "NO_PENDING_LINE"
  | "NO_UNAVAILABLE_PART"
  | "LINES_NOT_DONE"
  | "OPEN_TIME_ENTRY"
  | "QC_NOK"
  | "REASON_REQUIRED"
  | "INVOICE_ISSUED"
  | "ISSUED_PARTS"
  | "WARRANTY_DECISION_REQUIRED";

interface TransitionSpec {
  from: readonly RepairOrderStatus[];
  /** Au moins une de ces permissions. */
  permissions: readonly string[];
}

const BEFORE_READY: RepairOrderStatus[] = [
  "DRAFT",
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
];

const SPECS: Record<RepairOrderTransition, TransitionSpec> = {
  check_in: { from: ["DRAFT"], permissions: ["repair_order:create"] },
  start_diagnosis: {
    from: ["CHECKED_IN"],
    permissions: ["repair_order:update", "repair_order:assign", "inspection:perform"],
  },
  approve: {
    from: ["CHECKED_IN", "DIAGNOSING", "AWAITING_APPROVAL"],
    permissions: ["repair_order:update"],
  },
  request_approval: {
    from: ["CHECKED_IN", "DIAGNOSING", "IN_PROGRESS"],
    permissions: ["repair_order:update"],
  },
  decline_all: { from: ["AWAITING_APPROVAL"], permissions: ["repair_order:update"] },
  start_work: {
    from: ["APPROVED"],
    permissions: ["repair_order:update", "repair_order:assign", "inspection:perform"],
  },
  wait_parts: {
    from: ["APPROVED", "IN_PROGRESS"],
    permissions: ["repair_order:assign", "repair_order:update", "stock:issue"],
  },
  resume: { from: ["WAITING_PARTS"], permissions: ["repair_order:assign", "repair_order:update"] },
  complete_work: {
    from: ["IN_PROGRESS"],
    permissions: ["repair_order:update", "repair_order:assign", "inspection:perform"],
  },
  qc_pass: { from: ["QUALITY_CHECK"], permissions: ["repair_order:qc"] },
  qc_reject: { from: ["QUALITY_CHECK"], permissions: ["repair_order:qc"] },
  deliver: { from: ["READY", "QUALITY_CHECK"], permissions: ["repair_order:deliver"] },
  invoice_issued: { from: ["DELIVERED"], permissions: ["invoice:issue"] },
  reopen: { from: ["DELIVERED"], permissions: ["repair_order:reopen"] },
  cancel: { from: BEFORE_READY, permissions: ["repair_order:cancel"] },
};

const STATUS_LABEL: Record<RepairOrderStatus, string> = {
  DRAFT: "Brouillon",
  CHECKED_IN: "Reçu",
  DIAGNOSING: "Diagnostic",
  AWAITING_APPROVAL: "En attente d'accord",
  APPROVED: "Approuvé",
  IN_PROGRESS: "En cours",
  WAITING_PARTS: "Attente pièces",
  QUALITY_CHECK: "Contrôle qualité",
  READY: "Prêt",
  DELIVERED: "Restitué",
  INVOICED: "Facturé",
  CANCELLED: "Annulé",
};

const TARGET: Record<Exclude<RepairOrderTransition, "complete_work">, RepairOrderStatus> = {
  check_in: "CHECKED_IN",
  start_diagnosis: "DIAGNOSING",
  approve: "APPROVED",
  request_approval: "AWAITING_APPROVAL",
  decline_all: "READY",
  start_work: "IN_PROGRESS",
  wait_parts: "WAITING_PARTS",
  resume: "IN_PROGRESS",
  qc_pass: "READY",
  qc_reject: "IN_PROGRESS",
  deliver: "DELIVERED",
  invoice_issued: "INVOICED",
  reopen: "READY",
  cancel: "CANCELLED",
};

function refuse(code: TransitionRefusal, message: string): TransitionResult {
  return { ok: false, code, message };
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

export function canTransition(
  order: TransitionOrder,
  lines: readonly TransitionLine[],
  transition: RepairOrderTransition,
  ctx: TransitionContext,
): TransitionResult {
  const spec = SPECS[transition];
  if (!spec.from.includes(order.status)) {
    return refuse(
      "INVALID_FROM_STATUS",
      `Action impossible : l'OR est « ${STATUS_LABEL[order.status]} ».`,
    );
  }
  if (!ctx.system && !spec.permissions.some((p) => ctx.permissions.has(p))) {
    return refuse("FORBIDDEN", "Vous n'avez pas l'autorisation de faire cette action.");
  }

  const live = lines.filter((l) => l.status !== "CANCELLED");
  const pending = live.filter((l) => l.approval === "PENDING");
  const workable = live.filter((l) => l.approval === "APPROVED" || l.approval === "NOT_REQUIRED");
  const reason = ctx.reason?.trim();

  switch (transition) {
    case "approve": {
      if (order.isComeback && !order.warrantyDecision) {
        return refuse(
          "WARRANTY_DECISION_REQUIRED",
          "Retour sur travaux : la décision de garantie est obligatoire avant d'approuver.",
        );
      }
      if (pending.length > 0) {
        return refuse(
          "PENDING_LINES",
          `${plural(pending.length, "ligne attend", "lignes attendent")} l'accord du client.`,
        );
      }
      if (workable.length === 0) {
        return refuse("NO_APPROVED_LINE", "Ajoutez au moins une ligne approuvée par le client.");
      }
      break;
    }
    case "request_approval":
      if (pending.length === 0) {
        return refuse("NO_PENDING_LINE", "Aucune ligne n'attend l'accord du client.");
      }
      break;
    case "decline_all":
      if (pending.length > 0) {
        return refuse(
          "PENDING_LINES",
          `${plural(pending.length, "ligne attend", "lignes attendent")} encore une décision.`,
        );
      }
      break;
    case "wait_parts":
      if ((ctx.unavailablePartLines ?? 0) === 0) {
        return refuse("NO_UNAVAILABLE_PART", "Aucune pièce de cet OR n'est en attente.");
      }
      break;
    case "complete_work": {
      if (pending.length > 0) {
        return refuse(
          "PENDING_LINES",
          `${plural(pending.length, "ligne attend", "lignes attendent")} l'accord du client.`,
        );
      }
      const notDone = workable.filter((l) => l.status !== "DONE");
      if (notDone.length > 0) {
        return refuse(
          "LINES_NOT_DONE",
          `${plural(notDone.length, "ligne n'est pas terminée", "lignes ne sont pas terminées")}.`,
        );
      }
      if ((ctx.openTimeEntries ?? 0) > 0) {
        return refuse(
          "OPEN_TIME_ENTRY",
          ctx.openTimeEntryName
            ? `Clôturez le pointage de ${ctx.openTimeEntryName} avant de terminer.`
            : "Clôturez les pointages en cours avant de terminer.",
        );
      }
      return { ok: true, to: ctx.qcRequired === false ? "READY" : "QUALITY_CHECK" };
    }
    case "qc_pass":
      if (ctx.qcPassed !== true) {
        return refuse(
          "QC_NOK",
          "Le contrôle qualité comporte un point non conforme ou non renseigné.",
        );
      }
      break;
    case "qc_reject":
      if (!reason) return refuse("REASON_REQUIRED", "Indiquez le motif du refus.");
      break;
    case "deliver":
      if (order.status === "QUALITY_CHECK") {
        if (!ctx.system && !ctx.permissions.has("repair_order:qc")) {
          return refuse(
            "FORBIDDEN",
            "Seul le chef d'atelier peut restituer sans contrôle qualité.",
          );
        }
        if (!ctx.forceFromQualityCheck || !reason) {
          return refuse(
            "REASON_REQUIRED",
            "Restitution avant contrôle qualité : indiquez le motif.",
          );
        }
      }
      break;
    case "reopen":
      if (ctx.hasIssuedInvoice) {
        return refuse(
          "INVOICE_ISSUED",
          "Une facture est émise : créez un OR de retour ou un avoir.",
        );
      }
      if (!reason) return refuse("REASON_REQUIRED", "Indiquez le motif de la réouverture.");
      break;
    case "cancel":
      if (!reason) return refuse("REASON_REQUIRED", "Indiquez le motif de l'annulation.");
      if ((ctx.openTimeEntries ?? 0) > 0) {
        return refuse(
          "OPEN_TIME_ENTRY",
          ctx.openTimeEntryName
            ? `Clôturez le pointage de ${ctx.openTimeEntryName} avant d'annuler.`
            : "Clôturez les pointages en cours avant d'annuler.",
        );
      }
      if ((ctx.issuedPartsNotReturned ?? 0) > 0) {
        return refuse(
          "ISSUED_PARTS",
          "Des pièces sont sorties du stock : retournez-les en stock ou facturez-les avant d'annuler.",
        );
      }
      break;
    default:
      break;
  }
  return { ok: true, to: TARGET[transition as Exclude<RepairOrderTransition, "complete_work">] };
}

/** Transitions manuelles autorisées pour l'utilisateur (barre d'actions de la fiche OR). */
export function availableTransitions(
  order: TransitionOrder,
  lines: readonly TransitionLine[],
  ctx: TransitionContext,
): { transition: RepairOrderTransition; ok: boolean; message?: string }[] {
  return MANUAL_TRANSITIONS.filter((t) => SPECS[t].from.includes(order.status))
    .filter((t) => ctx.system || SPECS[t].permissions.some((p) => ctx.permissions.has(p)))
    .map((t) => {
      // Les gardes « motif » et « QC » dépendent d'une saisie : on les évalue comme satisfaites.
      const result = canTransition(order, lines, t, { ...ctx, reason: "-", qcPassed: true });
      return result.ok
        ? { transition: t, ok: true }
        : { transition: t, ok: false, message: result.message };
    });
}

/** Statut < READY (annulable, susceptible d'être en retard). */
export function isBeforeReady(status: RepairOrderStatus): boolean {
  const rank = STATUS_RANK[status];
  return rank >= 0 && rank < STATUS_RANK.READY;
}
