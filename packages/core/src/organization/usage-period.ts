import { formatInTimeZone } from "date-fns-tz";

// M15 RG-M15-20 — période d'un compteur mensuel (`UsageCounter.period`) : mois civil dans le
// fuseau de l'organisation. La « remise à zéro du 1er » est implicite (nouvelle période).

export const USAGE_METRICS = ["auto_messages", "ai_credits", "storage_bytes"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export function usagePeriod(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM");
}
