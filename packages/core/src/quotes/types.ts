// M05 — types partagés du domaine « devis », indépendants de Prisma.
import type { InspectionResult, LineType, Payer } from "../repairOrders/types";

export const QUOTE_STATUSES = [
  "DRAFT",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "CONVERTED",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_ORIGINS = [
  "REPAIR_ORDER",
  "INSPECTION",
  "STANDALONE",
  "APPOINTMENT",
  "INSURANCE",
] as const;
export type QuoteOrigin = (typeof QUOTE_ORIGINS)[number];

/** RG-M05-10 : canal par lequel la décision a été obtenue. */
export const DECISION_CHANNELS = ["portal", "whatsapp", "in_person", "phone", "insurer"] as const;
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];

/** Statuts terminaux (§5) : plus aucune transition possible. */
export const TERMINAL_QUOTE_STATUSES: readonly QuoteStatus[] = ["DECLINED", "CONVERTED"];

/** Statuts « en attente d'une décision client » (SENT/VIEWED). */
export const PENDING_QUOTE_STATUSES: readonly QuoteStatus[] = ["SENT", "VIEWED"];

/** Statuts « décidés » au sens de RG-M05-16. */
export const DECIDED_QUOTE_STATUSES: readonly QuoteStatus[] = [
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "DECLINED",
  "CONVERTED",
];

export type { InspectionResult, LineType, Payer };

/** Ligne de devis telle que vue par les calculs du core. */
export interface QuoteLineLike {
  id?: string;
  type: LineType;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  payer: Payer;
  isOptional: boolean;
  priority?: InspectionResult | null;
  accepted?: boolean | null;
  groupKey?: string | null;
  groupLabel?: string | null;
  requiresGroupKey?: string | null;
  isCustomerSupplied?: boolean;
  costPrice?: number | null;
  sortOrder?: number;
}

export const DECLINE_REASONS = ["TOO_EXPENSIVE", "LATER", "ELSEWHERE", "OTHER"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export const DISCOUNT_REASONS = [
  "LOYAL_CUSTOMER",
  "FLEET",
  "COMMERCIAL_GESTURE",
  "COMPETITION",
  "OTHER",
] as const;
export type DiscountReason = (typeof DISCOUNT_REASONS)[number];
