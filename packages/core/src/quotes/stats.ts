// RG-M05-16 — taux d'acceptation des devis (utilisé par M05 « Statistiques » et M12).
import type { InspectionResult } from "../repairOrders/types";
import { DECIDED_QUOTE_STATUSES, type QuoteStatus } from "./types";

export interface QuoteStatsInput {
  number: string;
  version: number;
  status: QuoteStatus;
  sentAt: Date | null;
  decidedAt: Date | null;
  total: number;
  acceptedTotal: number;
  advisorId: string | null;
  declineReason?: string | null;
  /** Au moins une relance QUOTE_FOLLOWUP envoyée avant la décision. */
  hadFollowup?: boolean;
  lines?: { priority: InspectionResult | null; accepted: boolean | null }[];
}

export interface QuoteStats {
  sent: number;
  closed: number;
  acceptedCount: number;
  /** % (2 décimales) ; null si aucun devis clos. */
  rateCount: number | null;
  proposedAmount: number;
  acceptedAmount: number;
  rateValue: number | null;
  medianDecisionHours: number | null;
  byAdvisor: {
    advisorId: string | null;
    sent: number;
    closed: number;
    accepted: number;
    rateCount: number | null;
  }[];
  byPriority: { priority: "URGENT" | "WATCH" | "OTHER"; proposed: number; accepted: number }[];
  declineReasons: { reason: string; count: number }[];
  recoveredByFollowups: number;
}

const ACCEPTED_LIKE: readonly QuoteStatus[] = ["ACCEPTED", "PARTIALLY_ACCEPTED", "CONVERTED"];

function pct(num: number, den: number): number | null {
  return den > 0 ? Math.round((num * 10_000) / den) / 100 : null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Garde la dernière version de chaque numéro. */
export function latestVersions<T extends { number: string; version: number }>(
  quotes: readonly T[],
): T[] {
  const best = new Map<string, T>();
  for (const q of quotes) {
    const current = best.get(q.number);
    if (!current || q.version > current.version) best.set(q.number, q);
  }
  return [...best.values()];
}

export function quoteStats(all: readonly QuoteStatsInput[]): QuoteStats {
  const quotes = latestVersions(all).filter((q) => q.sentAt);
  const closedList = quotes.filter(
    (q) => DECIDED_QUOTE_STATUSES.includes(q.status) || q.status === "EXPIRED",
  );
  const acceptedList = closedList.filter((q) => ACCEPTED_LIKE.includes(q.status));
  const proposedAmount = closedList.reduce((s, q) => s + q.total, 0);
  const acceptedAmount = closedList.reduce((s, q) => s + q.acceptedTotal, 0);
  const hours = closedList
    .filter((q) => q.decidedAt && q.sentAt && DECIDED_QUOTE_STATUSES.includes(q.status))
    .map((q) => (q.decidedAt!.getTime() - q.sentAt!.getTime()) / 3_600_000);

  const advisors = new Map<string | null, QuoteStatsInput[]>();
  for (const q of quotes) {
    if (!advisors.has(q.advisorId)) advisors.set(q.advisorId, []);
    advisors.get(q.advisorId)!.push(q);
  }
  const byAdvisor = [...advisors.entries()].map(([advisorId, list]) => {
    const closed = list.filter(
      (q) => DECIDED_QUOTE_STATUSES.includes(q.status) || q.status === "EXPIRED",
    );
    const accepted = closed.filter((q) => ACCEPTED_LIKE.includes(q.status)).length;
    return {
      advisorId,
      sent: list.length,
      closed: closed.length,
      accepted,
      rateCount: pct(accepted, closed.length),
    };
  });

  const prio = {
    URGENT: { proposed: 0, accepted: 0 },
    WATCH: { proposed: 0, accepted: 0 },
    OTHER: { proposed: 0, accepted: 0 },
  };
  for (const q of closedList) {
    for (const l of q.lines ?? []) {
      const key = l.priority === "URGENT" || l.priority === "WATCH" ? l.priority : "OTHER";
      prio[key].proposed += 1;
      if (l.accepted) prio[key].accepted += 1;
    }
  }
  const reasons = new Map<string, number>();
  for (const q of closedList) {
    if (q.declineReason) reasons.set(q.declineReason, (reasons.get(q.declineReason) ?? 0) + 1);
  }
  return {
    sent: quotes.length,
    closed: closedList.length,
    acceptedCount: acceptedList.length,
    rateCount: pct(acceptedList.length, closedList.length),
    proposedAmount,
    acceptedAmount,
    rateValue: pct(acceptedAmount, proposedAmount),
    medianDecisionHours: median(hours),
    byAdvisor,
    byPriority: (["URGENT", "WATCH", "OTHER"] as const).map((priority) => ({
      priority,
      ...prio[priority],
    })),
    declineReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    recoveredByFollowups: acceptedList
      .filter((q) => q.hadFollowup)
      .reduce((s, q) => s + q.acceptedTotal, 0),
  };
}
