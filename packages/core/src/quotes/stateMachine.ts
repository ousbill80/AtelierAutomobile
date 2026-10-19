// M05 §5 — machine à états du devis.
import { DomainError } from "../errors";
import type { QuoteStatus } from "./types";

export const QUOTE_TRANSITIONS = [
  "send",
  "view",
  "decide",
  "expire",
  "edit",
  "convert",
  "delete",
  "reactivate",
] as const;
export type QuoteTransition = (typeof QUOTE_TRANSITIONS)[number];

const ALLOWED: Record<QuoteTransition, readonly QuoteStatus[]> = {
  send: ["DRAFT"],
  view: ["SENT"],
  decide: ["DRAFT", "SENT", "VIEWED"],
  expire: ["SENT", "VIEWED"],
  edit: ["SENT", "VIEWED", "EXPIRED"],
  reactivate: ["EXPIRED"],
  convert: ["ACCEPTED", "PARTIALLY_ACCEPTED"],
  delete: ["DRAFT"],
};

export function canQuoteTransition(status: QuoteStatus, transition: QuoteTransition): boolean {
  return ALLOWED[transition].includes(status);
}

export function assertQuoteTransition(status: QuoteStatus, transition: QuoteTransition): void {
  if (!canQuoteTransition(status, transition)) {
    throw new DomainError(
      "quotes.invalid_transition",
      `Action « ${transition} » impossible pour un devis au statut ${status}.`,
      { status, transition },
    );
  }
}

/** Transitions disponibles pour l'interface (hors `view`, réservée au portail). */
export function availableQuoteTransitions(status: QuoteStatus): QuoteTransition[] {
  return QUOTE_TRANSITIONS.filter((t) => t !== "view" && canQuoteTransition(status, t));
}
