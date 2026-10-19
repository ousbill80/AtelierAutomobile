// RG-M05-04 / RG-M14-08 — groupes de lignes affichés au client : par priorité
// (Urgent → À surveiller → Autres), libellé, explication, photos, total TTC du groupe.
import type { InspectionResult } from "../repairOrders/types";
import { groupKeyOf } from "./decision";
import type { QuoteLineAmounts } from "./totals";
import type { QuoteLineLike } from "./types";

export interface QuoteGroupLine extends QuoteLineLike {
  customerExplanation?: string | null;
  photoAttachmentIds?: readonly string[];
}

export interface QuoteGroup<L extends QuoteGroupLine = QuoteGroupLine> {
  key: string;
  label: string;
  priority: InspectionResult | null;
  /** Le groupe entier est optionnel (toutes ses lignes le sont). */
  isOptional: boolean;
  requiresGroupKey: string | null;
  explanation: string | null;
  photoIds: string[];
  lines: L[];
  /** TTC des lignes facturables du groupe. */
  total: number;
  /** Décision commune du groupe (null si non décidé ou mixte). */
  accepted: boolean | null;
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, WATCH: 1 };

function rank(priority: InspectionResult | null | undefined): number {
  return priority ? (PRIORITY_RANK[priority] ?? 2) : 2;
}

export function groupQuoteLines<L extends QuoteGroupLine>(
  lines: readonly L[],
  amounts: readonly Pick<QuoteLineAmounts, "id" | "total" | "billable">[] = [],
): QuoteGroup<L>[] {
  const totalById = new Map(amounts.map((a) => [a.id, a.billable ? a.total : 0]));
  const order: string[] = [];
  const map = new Map<string, L[]>();
  const sorted = [...lines].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const line of sorted) {
    const key = groupKeyOf(line);
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)!.push(line);
  }
  const groups = order.map((key, index) => {
    const ls = map.get(key)!;
    const priority = ls.reduce<InspectionResult | null>(
      (best, l) => (rank(l.priority) < rank(best) ? (l.priority ?? null) : best),
      null,
    );
    const decisions = new Set(ls.map((l) => l.accepted ?? null));
    return {
      index,
      group: {
        key,
        label: ls[0]!.groupLabel ?? ls[0]!.description,
        priority,
        isOptional: ls.every((l) => Boolean(l.isOptional)),
        requiresGroupKey: ls.find((l) => l.requiresGroupKey)?.requiresGroupKey ?? null,
        explanation: ls.find((l) => l.customerExplanation)?.customerExplanation ?? null,
        photoIds: [...new Set(ls.flatMap((l) => [...(l.photoAttachmentIds ?? [])]))],
        lines: ls,
        total: ls.reduce((s, l) => s + (totalById.get(l.id) ?? 0), 0),
        accepted: decisions.size === 1 ? [...decisions][0]! : null,
      } satisfies QuoteGroup<L>,
    };
  });
  return groups
    .sort((a, b) => rank(a.group.priority) - rank(b.group.priority) || a.index - b.index)
    .map((g) => g.group);
}
