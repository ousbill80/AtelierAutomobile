// M06 RG-M06-01/02/03 — kanban atelier : colonnes, retard, OR « à risque », déplacements.
// Les transitions restent celles de M04 (`canTransition`) : M06 ne fait que traduire un
// déplacement de carte en transition M04.
import {
  canTransition,
  type RepairOrderTransition,
  type TransitionContext,
} from "../repairOrders/stateMachine";
import {
  STATUS_RANK,
  type ApprovalState,
  type LineStatus,
  type LineType,
  type RepairOrderStatus,
} from "../repairOrders/types";

export const WORKSHOP_COLUMN_KEYS = [
  "to_diagnose",
  "awaiting_approval",
  "ready_to_start",
  "in_progress",
  "waiting_parts",
  "quality_check",
  "ready",
] as const;
export type WorkshopColumnKey = (typeof WORKSHOP_COLUMN_KEYS)[number];

/** RG-M06-01 : correspondance colonne → statuts M04 (DRAFT, DELIVERED, INVOICED, CANCELLED masqués). */
export const WORKSHOP_COLUMNS: Record<WorkshopColumnKey, readonly RepairOrderStatus[]> = {
  to_diagnose: ["CHECKED_IN", "DIAGNOSING"],
  awaiting_approval: ["AWAITING_APPROVAL"],
  ready_to_start: ["APPROVED"],
  in_progress: ["IN_PROGRESS"],
  waiting_parts: ["WAITING_PARTS"],
  quality_check: ["QUALITY_CHECK"],
  ready: ["READY"],
};

export const WORKSHOP_BOARD_STATUSES: readonly RepairOrderStatus[] = WORKSHOP_COLUMN_KEYS.flatMap(
  (k) => WORKSHOP_COLUMNS[k],
);

export function columnForStatus(status: RepairOrderStatus): WorkshopColumnKey | null {
  return WORKSHOP_COLUMN_KEYS.find((k) => WORKSHOP_COLUMNS[k].includes(status)) ?? null;
}

export interface WorkshopLine {
  type: LineType;
  status: LineStatus;
  approval: ApprovalState;
  quantity: number;
}

function isLive(line: Pick<WorkshopLine, "status" | "approval">): boolean {
  return line.status !== "CANCELLED" && line.approval !== "DECLINED";
}

/** RG-M06-02 : heures barème restantes = Σ quantité des lignes LABOR non terminées. */
export function remainingLaborHours(lines: readonly WorkshopLine[]): number {
  return lines
    .filter((l) => l.type === "LABOR" && isLive(l) && l.status !== "DONE")
    .reduce((sum, l) => sum + l.quantity, 0);
}

/** Avancement « 3/5 tâches » : lignes LABOR/SUBCONTRACT actives (US-M06-01). */
export function taskProgress(lines: readonly WorkshopLine[]): { done: number; total: number } {
  const tasks = lines.filter((l) => (l.type === "LABOR" || l.type === "SUBCONTRACT") && isLive(l));
  return { done: tasks.filter((l) => l.status === "DONE").length, total: tasks.length };
}

export interface Lateness {
  late: boolean;
  /** Minutes de retard (0 si à l'heure). */
  lateMinutes: number;
  /** RG-M06-02 : pas encore en retard mais `promisedAt − maintenant < heures restantes`. */
  atRisk: boolean;
}

export function workshopLateness(
  order: { status: RepairOrderStatus; promisedAt: Date | null },
  lines: readonly WorkshopLine[],
  now: Date,
): Lateness {
  const rank = STATUS_RANK[order.status];
  if (!order.promisedAt || rank < 0 || rank >= STATUS_RANK.READY) {
    return { late: false, lateMinutes: 0, atRisk: false };
  }
  const delta = order.promisedAt.getTime() - now.getTime();
  if (delta < 0) {
    return { late: true, lateMinutes: Math.floor(-delta / 60_000), atRisk: false };
  }
  const remainingMs = remainingLaborHours(lines) * 3_600_000;
  return { late: false, lateMinutes: 0, atRisk: delta < remainingMs };
}

/**
 * Transition M04 correspondant au dépôt d'une carte dans une colonne (US-M06-01). `null` :
 * aucune transition (même colonne ou déplacement non prévu par M04 → colonne grisée).
 * `qc_pass`/`qc_reject` passent par l'écran de contrôle qualité (RG-M06-11).
 */
export function transitionForMove(
  from: RepairOrderStatus,
  to: WorkshopColumnKey,
): RepairOrderTransition | null {
  if (columnForStatus(from) === to) return null;
  switch (to) {
    case "to_diagnose":
      return null;
    case "awaiting_approval":
      return ["CHECKED_IN", "DIAGNOSING", "IN_PROGRESS"].includes(from) ? "request_approval" : null;
    case "ready_to_start":
      return ["CHECKED_IN", "DIAGNOSING", "AWAITING_APPROVAL"].includes(from) ? "approve" : null;
    case "in_progress":
      if (from === "APPROVED") return "start_work";
      if (from === "WAITING_PARTS") return "resume";
      if (from === "QUALITY_CHECK") return "qc_reject";
      return null;
    case "waiting_parts":
      return from === "APPROVED" || from === "IN_PROGRESS" ? "wait_parts" : null;
    case "quality_check":
      return from === "IN_PROGRESS" ? "complete_work" : null;
    case "ready":
      return from === "QUALITY_CHECK" ? "qc_pass" : null;
  }
}

export type MoveCheck =
  | { ok: true; transition: RepairOrderTransition; viaQualityCheck: boolean }
  | { ok: false; code: string; message: string };

/** Vérifie un déplacement de carte avec la machine à états M04 (gardes comprises). */
export function checkBoardMove(
  order: { status: RepairOrderStatus; isComeback?: boolean; warrantyDecision?: string | null },
  lines: readonly (WorkshopLine & { approval: ApprovalState })[],
  to: WorkshopColumnKey,
  ctx: TransitionContext,
): MoveCheck {
  const transition = transitionForMove(order.status, to);
  if (!transition) {
    return {
      ok: false,
      code: "MOVE_NOT_ALLOWED",
      message: "Ce déplacement n'est pas autorisé pour cet OR.",
    };
  }
  if (transition === "qc_pass" || transition === "qc_reject") {
    const result = canTransition(order, lines, transition, { ...ctx, reason: "-", qcPassed: true });
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    return { ok: true, transition, viaQualityCheck: true };
  }
  const result = canTransition(order, lines, transition, ctx);
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return { ok: true, transition, viaQualityCheck: false };
}

/** Colonnes où la carte peut être déposée (les autres sont grisées pendant le glisser). */
export function allowedColumns(
  order: { status: RepairOrderStatus; isComeback?: boolean; warrantyDecision?: string | null },
  lines: readonly WorkshopLine[],
  ctx: TransitionContext,
): WorkshopColumnKey[] {
  return WORKSHOP_COLUMN_KEYS.filter((k) => {
    const transition = transitionForMove(order.status, k);
    if (!transition) return false;
    if (ctx.system) return true;
    // Gardes « motif » évaluées comme satisfaites : la saisie a lieu au dépôt.
    return canTransition(order, lines, transition, { ...ctx, reason: "-", qcPassed: true }).ok;
  });
}

/** RG-M06-03 : statuts où un OR occupe un pont. */
export const BAY_OCCUPYING_STATUSES: readonly RepairOrderStatus[] = [
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
];

export function occupiesBay(status: RepairOrderStatus): boolean {
  return BAY_OCCUPYING_STATUSES.includes(status);
}

/** RG-M06-03 : un OR passé READY libère son pont, sauf `atelier.keepBayUntilDelivery`. */
export function releasesBayOn(to: RepairOrderStatus, keepBayUntilDelivery: boolean): boolean {
  if (to === "READY") return !keepBayUntilDelivery;
  return to === "DELIVERED" || to === "INVOICED" || to === "CANCELLED";
}
