// RG-M05-16 — taux d'acceptation (nombre et valeur), délai médian de décision, motifs.
import { DECIDED_QUOTE_STATUSES, type QuoteStatus } from "./types";

export interface QuoteStatsInput {
  number: string;
  version: number;
  status: QuoteStatus;
  sentAt: Date | null;
  decidedAt: Date | null;
  total: number;
  acceptedTotal: number;
  declineReason?: string | null;
  advisorId?: string | null;
  advisorName?: string | null;
  /** Au moins une relance QUOTE_FOLLOWUP envoyée avant la décision. */
  followedUp?: boolean;
}

export interface QuoteStatsBreakdown {
  key: string;
  label: string;
  sent: number;
  accepted: number;
  rateCount: number;
}

export interface QuoteStats {
  sent: number;
  closed: number;
  acceptedCount: number;
  rateCount: number;
  proposedAmount: number;
  acceptedAmount: number;
  rateValue: number;
  medianDecisionHours: number | null;
  byAdvisor: QuoteStatsBreakdown[];
  declineReasons: { reason: string; count: number }[];
  recoveredByFollowups: number;
}

const ACCEPTED_STATUSES: readonly QuoteStatus[] = ["ACCEPTED", "PARTIALLY_ACCEPTED", "CONVERTED"];

/** Dernière version de chaque numéro ; les devis jamais envoyés sont exclus. */
export function latestVersions<T extends { number: string; version: number }>(
  quotes: readonly T[],
): T[] {
  const byNumber = new Map<string, T>();
  for (const q of quotes) {
    const current = byNumber.get(q.number);
    if (!current || q.version > current.version) byNumber.set(q.number, q);
  }
  return [...byNumber.values()];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function rate(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num * 100) / den);
}

export function quoteStats(input: readonly QuoteStatsInput[]): QuoteStats {
  const latest = latestVersions(input).filter((q) => q.sentAt !== null);
  const closed = latest.filter(
    (q) => DECIDED_QUOTE_STATUSES.includes(q.status) || q.status === "EXPIRED",
  );
  const accepted = closed.filter((q) => ACCEPTED_STATUSES.includes(q.status));
  const proposedAmount = closed.reduce((s, q) => s + q.total, 0);
  const acceptedAmount = closed.reduce((s, q) => s + q.acceptedTotal, 0);
  const decisionHours = closed
    .filter((q) => q.decidedAt && q.sentAt)
    .map((q) => (q.decidedAt!.getTime() - q.sentAt!.getTime()) / 3_600_000);

  const advisors = new Map<string, QuoteStatsBreakdown>();
  for (const q of latest) {
    const key = q.advisorId ?? "—";
    const entry = advisors.get(key) ?? {
      key,
      label: q.advisorName ?? "Non attribué",
      sent: 0,
      accepted: 0,
      rateCount: 0,
    };
    entry.sent += 1;
    if (ACCEPTED_STATUSES.includes(q.status)) entry.accepted += 1;
    advisors.set(key, entry);
  }
  for (const entry of advisors.values()) {
    const closedForAdvisor = closed.filter((q) => (q.advisorId ?? "—") === entry.key).length;
    entry.rateCount = rate(entry.accepted, closedForAdvisor);
  }

  const reasons = new Map<string, number>();
  for (const q of closed) {
    if (q.declineReason) reasons.set(q.declineReason, (reasons.get(q.declineReason) ?? 0) + 1);
  }

  return {
    sent: latest.length,
    closed: closed.length,
    acceptedCount: accepted.length,
    rateCount: rate(accepted.length, closed.length),
    proposedAmount,
    acceptedAmount,
    rateValue: rate(acceptedAmount, proposedAmount),
    medianDecisionHours: median(decisionHours),
    byAdvisor: [...advisors.values()].sort((a, b) => b.sent - a.sent),
    declineReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    recoveredByFollowups: accepted
      .filter((q) => q.followedUp)
      .reduce((s, q) => s + q.acceptedTotal, 0),
  };
}
