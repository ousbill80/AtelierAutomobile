// RG-M07-09/11 — valorisation (Σ onHand × CMP, négatifs à 0 et listés à part), valorisation
// à date reconstruite depuis les mouvements, et pièces dormantes.
import { valueOf } from "./units";

export interface ValuationItem {
  productId: string;
  siteId: string;
  category: string | null;
  onHand: number;
  quantityScale: number;
  averageCost: number;
}

export interface ValuationGroup {
  key: string;
  value: number;
  /** Nombre de lignes (produit × site) avec un stock > 0. */
  items: number;
}

export interface ValuationResult {
  total: number;
  groups: ValuationGroup[];
  negatives: ValuationItem[];
}

export function computeValuation(
  items: ValuationItem[],
  groupBy: "category" | "site",
): ValuationResult {
  const groups = new Map<string, ValuationGroup>();
  const negatives: ValuationItem[] = [];
  let total = 0;
  for (const item of items) {
    if (item.onHand < 0) {
      negatives.push(item);
      continue;
    }
    if (item.onHand === 0) continue;
    const value = valueOf(item.onHand, item.quantityScale, item.averageCost);
    total += value;
    const key = groupBy === "site" ? item.siteId : (item.category ?? "");
    const g = groups.get(key) ?? { key, value: 0, items: 0 };
    g.value += value;
    g.items += 1;
    groups.set(key, g);
  }
  return {
    total,
    groups: [...groups.values()].sort((a, b) => b.value - a.value),
    negatives,
  };
}

export interface MovementForValuation {
  productId: string;
  siteId: string;
  quantity: number;
  costAfter: number | null;
  unitCost: number | null;
  createdAt: Date;
}

/**
 * Valorisation à une date passée : Σ quantity jusqu'à la date par (produit, site) × CMP à la
 * date (dernier `costAfter` connu du produit, à défaut le dernier `unitCost`).
 */
export function reconstructStockAt(
  movements: MovementForValuation[],
  at: Date,
): { quantities: Map<string, number>; costs: Map<string, number> } {
  const sorted = movements
    .filter((m) => m.createdAt.getTime() <= at.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const quantities = new Map<string, number>();
  const costs = new Map<string, number>();
  for (const m of sorted) {
    const key = `${m.productId}|${m.siteId}`;
    quantities.set(key, (quantities.get(key) ?? 0) + m.quantity);
    const cost = m.costAfter ?? m.unitCost;
    if (cost != null) costs.set(m.productId, cost);
  }
  return { quantities, costs };
}

export type DormantBucket = "dormant" | "over_365";

/**
 * RG-M07-11 : dernier mouvement de sortie il y a plus de N jours (défaut 180) et onHand > 0.
 * Tranches : N–365 j (« dormant »), > 365 j. Jamais sorti : date de référence = création.
 */
export function dormantBucket(
  input: { onHand: number; lastIssuedAt: Date | null; createdAt: Date },
  now: Date,
  days = 180,
): DormantBucket | null {
  if (input.onHand <= 0) return null;
  const ref = input.lastIssuedAt ?? input.createdAt;
  const age = Math.floor((now.getTime() - ref.getTime()) / 86_400_000);
  if (age <= days) return null;
  return age > 365 ? "over_365" : "dormant";
}

export function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}
