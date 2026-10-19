// RG-M05-04 / RG-M14-08 — groupes de lignes (MO + pièces d'un même travail), ordre d'affichage
// client : Urgent → À surveiller → Autres.
import { effectiveGroupKey } from "./decision";
import type { InspectionResult, QuoteLineLike } from "./types";

export interface QuoteGroup<T extends QuoteLineLike> {
  key: string;
  label: string;
  priority: InspectionResult | null;
  isOptional: boolean;
  requiresGroupKey: string | null;
  lines: T[];
  /** TTC du groupe (lignes facturables), fourni par l'appelant via `lineTotals`. */
  total: number;
  accepted: boolean | null;
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, WATCH: 1 };

export function priorityRank(priority: InspectionResult | null | undefined): number {
  return priority ? (PRIORITY_RANK[priority] ?? 2) : 2;
}

export function groupQuoteLines<T extends QuoteLineLike & { id: string; description: string }>(
  lines: readonly T[],
  lineTotals: readonly number[],
): QuoteGroup<T>[] {
  const groups = new Map<string, QuoteGroup<T>>();
  lines.forEach((line, index) => {
    const key = effectiveGroupKey(line);
    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(line);
      existing.total += lineTotals[index] ?? 0;
      if (priorityRank(line.priority) < priorityRank(existing.priority)) {
        existing.priority = line.priority ?? null;
      }
      existing.isOptional = existing.isOptional && line.isOptional;
      if (existing.accepted !== line.accepted) existing.accepted = line.accepted ?? null;
      return;
    }
    groups.set(key, {
      key,
      label: line.groupLabel ?? line.description,
      priority: line.priority ?? null,
      isOptional: line.isOptional,
      requiresGroupKey: line.requiresGroupKey ?? null,
      lines: [line],
      total: lineTotals[index] ?? 0,
      accepted: line.accepted ?? null,
    });
  });
  return [...groups.values()].sort((a, b) => {
    const p = priorityRank(a.priority) - priorityRank(b.priority);
    if (p !== 0) return p;
    return (a.lines[0]!.sortOrder ?? 0) - (b.lines[0]!.sortOrder ?? 0);
  });
}
