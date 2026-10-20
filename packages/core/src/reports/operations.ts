// RG-M12-12 (OR), RG-M12-13 (devis), RG-M12-14 (occupation), RG-M12-20 (encaissements).
import type { HolidayLike } from "../calendar";
import type { OpeningHours } from "../organization/opening-hours";
import { openIntervalsForDay } from "../planning/openingHours";
import { ratio } from "./revenue";

/** RG-M12-12 : « en cours » = statut ∉ {DRAFT, DELIVERED, INVOICED, CANCELLED}. */
export const RO_NOT_IN_PROGRESS = ["DRAFT", "DELIVERED", "INVOICED", "CANCELLED"] as const;
export const RO_IN_PROGRESS_STATUSES = [
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
  "READY",
] as const;

/** RG-M12-13 : statuts « décidés » (univers du taux d'acceptation). */
export const QUOTE_ACCEPTED_STATUSES = ["ACCEPTED", "PARTIALLY_ACCEPTED", "CONVERTED"] as const;
export const QUOTE_DECIDED_STATUSES = [...QUOTE_ACCEPTED_STATUSES, "DECLINED", "EXPIRED"] as const;

export interface QuoteDecisionAggregate {
  status: string;
  count: number;
  /** Σ `Quote.total` (TTC). */
  total: number;
  /** Σ TTC des lignes acceptées (`Quote.acceptedTotal`, dénormalisé par M05). */
  acceptedTotal: number;
}

export interface QuoteAcceptance {
  decided: number;
  accepted: number;
  /** En nombre ; null si aucun devis décidé. */
  countRate: number | null;
  /** En valeur : Σ TTC accepté / Σ TTC des devis de l'univers. */
  valueRate: number | null;
}

/** RG-M12-13 — dernière version de chaque devis, décidée dans la période. */
export function quoteAcceptance(rows: readonly QuoteDecisionAggregate[]): QuoteAcceptance {
  let decided = 0;
  let accepted = 0;
  let total = 0;
  let acceptedTotal = 0;
  for (const row of rows) {
    if (!(QUOTE_DECIDED_STATUSES as readonly string[]).includes(row.status)) continue;
    decided += row.count;
    total += row.total;
    if ((QUOTE_ACCEPTED_STATUSES as readonly string[]).includes(row.status)) {
      accepted += row.count;
      acceptedTotal += row.acceptedTotal;
    }
  }
  return {
    decided,
    accepted,
    countRate: ratio(accepted, decided),
    valueRate: ratio(acceptedTotal, total),
  };
}

export interface CapacityInput {
  /** Jours locaux de la période `[from, to)`. */
  days: readonly string[];
  timeZone: string;
  openingHours: OpeningHours | null | undefined;
  holidays?: readonly HolidayLike[];
  siteId: string;
  /** Ponts actifs hors station de lavage (`Bay.isActive`, `type ≠ WASH`). */
  activeBays: number;
}

/**
 * RG-M12-14 — capacité en minutes = ponts actifs × heures d'ouverture du site sur la période,
 * jours fériés exclus. Site sans horaires → null (« — » + « Renseigner les horaires »).
 */
export function capacityMinutes(input: CapacityInput): number | null {
  const hours = input.openingHours ?? {};
  if (Object.values(hours).every((ranges) => !ranges || ranges.length === 0)) return null;
  let perBay = 0;
  for (const day of input.days) {
    for (const [from, to] of openIntervalsForDay(day, {
      timeZone: input.timeZone,
      openingHours: hours,
      holidays: input.holidays,
      siteId: input.siteId,
    })) {
      perBay += to - from;
    }
  }
  return perBay * Math.max(0, input.activeBays);
}

export interface Occupancy {
  /** Valeurs brutes (export) ; l'affichage plafonne à 100 % (`capped`). */
  real: number | null;
  planned: number | null;
  capped: { real: number | null; planned: number | null };
}

export function occupancy(
  workedMinutes: number,
  plannedMinutes: number,
  capacity: number | null,
): Occupancy {
  const real = capacity ? workedMinutes / capacity : null;
  const planned = capacity ? plannedMinutes / capacity : null;
  const cap = (v: number | null) => (v === null ? null : Math.min(1, v));
  return { real, planned, capped: { real: cap(real), planned: cap(planned) } };
}

/** RG-M12-20 : imports de reprise de solde exclus des encaissements. */
export const OPENING_PAYMENT_REFERENCES = ["OPENING", "IMPORT-SOLDE"] as const;

export interface CollectedAggregate {
  method: string;
  amount: number;
}

export interface CollectedSummary {
  total: number;
  byMethod: Record<string, number>;
}

/**
 * RG-M12-20 — Σ paiements confirmés (non annulés, `receivedAt` dans la période) par mode, moins
 * les remboursements (`Refund`) datés de la période, en négatif sur leur mode.
 */
export function collectedByMethod(
  payments: readonly CollectedAggregate[],
  refunds: readonly CollectedAggregate[] = [],
): CollectedSummary {
  const byMethod: Record<string, number> = {};
  let total = 0;
  for (const p of payments) {
    byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    total += p.amount;
  }
  for (const r of refunds) {
    byMethod[r.method] = (byMethod[r.method] ?? 0) - Math.abs(r.amount);
    total -= Math.abs(r.amount);
  }
  return { total, byMethod };
}
