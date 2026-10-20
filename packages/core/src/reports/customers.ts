// RG-M12-25 (clients actifs / nouveaux / perdus) et RG-M12-26 (top pièces).
import { shiftMonths } from "./dates";

export type CustomerActivityStatus = "active" | "lost" | "inactive";

export interface CustomerActivity {
  customerId: string;
  /** Première activité de l'historique (facture valide `issuedAt` ou OR non annulé `createdAt`). */
  firstAt: Date;
  /** Dernière activité avant la fin de période. */
  lastAt: Date;
}

/**
 * RG-M12-25 — Actif : activité dans les 12 mois précédant la fin de période. Perdu : dernière
 * activité entre 24 et 12 mois avant la fin. Nouveau : première activité dans la période.
 */
export function classifyCustomer(
  activity: Pick<CustomerActivity, "lastAt">,
  periodEnd: Date,
): CustomerActivityStatus {
  const minus12 = shiftMonths(periodEnd, -12).getTime();
  const minus24 = shiftMonths(periodEnd, -24).getTime();
  const last = activity.lastAt.getTime();
  if (last >= minus12) return "active";
  if (last >= minus24) return "lost";
  return "inactive";
}

export function isNewCustomer(
  activity: Pick<CustomerActivity, "firstAt">,
  from: Date,
  to: Date,
): boolean {
  const t = activity.firstAt.getTime();
  return t >= from.getTime() && t < to.getTime();
}

export interface CustomerCounts {
  active: number;
  new: number;
  lost: number;
}

export function customerCounts(
  activities: readonly CustomerActivity[],
  from: Date,
  to: Date,
): CustomerCounts {
  const counts: CustomerCounts = { active: 0, new: 0, lost: 0 };
  for (const a of activities) {
    if (a.lastAt.getTime() >= to.getTime()) continue; // activité postérieure : hors calcul
    const status = classifyCustomer(a, to);
    if (status === "active") counts.active += 1;
    if (status === "lost") counts.lost += 1;
    if (isNewCustomer(a, from, to)) counts.new += 1;
  }
  return counts;
}

/** Clé de regroupement d'une pièce sans `productId` : désignation normalisée. */
export function normalizeDescription(description: string): string {
  return description.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface PartAggregate {
  key: string;
  productId: string | null;
  label: string;
  quantity: number;
  ht: number;
  cost: number;
  repairOrders: number;
}

export interface TopPart extends PartAggregate {
  margin: number;
}

/** RG-M12-26 : tri par CA HT puis quantité ; `limit` = 10 au tableau de bord, illimité en rapport. */
export function rankTopParts(rows: readonly PartAggregate[], limit?: number): TopPart[] {
  const ranked = rows
    .map((r) => ({ ...r, margin: r.ht - r.cost }))
    .sort((a, b) => b.ht - a.ht || b.quantity - a.quantity || a.label.localeCompare(b.label));
  return limit === undefined ? ranked : ranked.slice(0, limit);
}
