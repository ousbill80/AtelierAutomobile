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

/** `Quote.decisionChannel` (M05 §6). */
export const DECISION_CHANNELS = ["portal", "whatsapp", "in_person", "phone", "insurer"] as const;
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];

export type DiscountApprovalStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

/** Statuts décidés (RG-M05-16). */
export const DECIDED_QUOTE_STATUSES: readonly QuoteStatus[] = [
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "DECLINED",
  "CONVERTED",
];

/** Statuts « en attente du client ». */
export const AWAITING_QUOTE_STATUSES: readonly QuoteStatus[] = ["SENT", "VIEWED"];

/** Motifs de refus proposés au client (US-M05-05). */
export const DECLINE_REASONS = ["too_expensive", "later", "elsewhere", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/** Motifs de remise (RG-M05-07). */
export const DISCOUNT_REASONS = ["loyal", "fleet", "goodwill", "competition", "other"] as const;

export interface QuoteLineLike {
  id: string;
  type: LineType;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  payer: Payer;
  isCustomerSupplied?: boolean;
  isOptional?: boolean;
  priority?: InspectionResult | null;
  accepted?: boolean | null;
  groupKey?: string | null;
  groupLabel?: string | null;
  requiresGroupKey?: string | null;
  sortOrder?: number;
}
