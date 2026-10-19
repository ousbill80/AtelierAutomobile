// M04 — types partagés du domaine « ordres de réparation », indépendants de Prisma.

export const REPAIR_ORDER_STATUSES = [
  "DRAFT",
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
  "READY",
  "DELIVERED",
  "INVOICED",
  "CANCELLED",
] as const;
export type RepairOrderStatus = (typeof REPAIR_ORDER_STATUSES)[number];

/** Statuts « actifs » (RG-M04-02) : l'OR occupe le véhicule. */
export const ACTIVE_REPAIR_ORDER_STATUSES: readonly RepairOrderStatus[] = [
  "DRAFT",
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
  "READY",
];

/** Colonnes du kanban (US-M04-08) : statuts actifs hors brouillon. */
export const BOARD_STATUSES: readonly RepairOrderStatus[] = ACTIVE_REPAIR_ORDER_STATUSES.filter(
  (s) => s !== "DRAFT",
);

/** Rang d'avancement, pour « statut < READY » (annulation, retard). */
export const STATUS_RANK: Record<RepairOrderStatus, number> = {
  DRAFT: 0,
  CHECKED_IN: 1,
  DIAGNOSING: 2,
  AWAITING_APPROVAL: 3,
  APPROVED: 4,
  IN_PROGRESS: 5,
  WAITING_PARTS: 5,
  QUALITY_CHECK: 6,
  READY: 7,
  DELIVERED: 8,
  INVOICED: 9,
  CANCELLED: -1,
};

export function isActiveStatus(status: RepairOrderStatus): boolean {
  return ACTIVE_REPAIR_ORDER_STATUSES.includes(status);
}

/** `DELIVERED` et `INVOICED` rendent les lignes non modifiables (§5). */
export function isLockedStatus(status: RepairOrderStatus): boolean {
  return status === "DELIVERED" || status === "INVOICED" || status === "CANCELLED";
}

export type LineType = "LABOR" | "PART" | "SUBCONTRACT" | "FEE" | "CONSUMABLE";
export type LineStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED";
export type ApprovalState = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "DECLINED";
export type Payer = "CUSTOMER" | "INSURANCE" | "WARRANTY" | "INTERNAL";
export type ApprovalSource = "CHECK_IN" | "PRE_AUTHORIZED" | "QUOTE" | "PHONE" | "IN_PERSON";
export type InspectionResult = "OK" | "WATCH" | "URGENT" | "NOT_CHECKED";
