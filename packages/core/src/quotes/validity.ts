// RG-M05-08 — validité d'un devis et expiration.
import { addDays } from "../reminders/dates";
import type { QuoteSettings } from "./settings";

export interface ValidityInput {
  /** Date métier de création (jour, UTC minuit). */
  createdOn: Date;
  settings: Pick<QuoteSettings, "validityDays" | "validityDaysCompany">;
  customerType: "INDIVIDUAL" | "COMPANY";
  isInsurance?: boolean;
}

/** 15 jours par défaut ; 30 pour une entreprise ou un sinistre. */
export function computeValidUntil(input: ValidityInput): Date {
  const days =
    input.customerType === "COMPANY" || input.isInsurance
      ? Math.max(input.settings.validityDays, input.settings.validityDaysCompany)
      : input.settings.validityDays;
  return addDays(input.createdOn, days);
}

/** Expiré si `validUntil` < aujourd'hui (prix garantis jusqu'à `validUntil` inclus). */
export function isQuoteExpired(validUntil: Date, today: Date): boolean {
  return validUntil.getTime() < today.getTime();
}

/** RG-M05-09 : le lien public reste lisible 30 jours après la fin de validité. */
export function portalLinkExpiry(validUntil: Date): Date {
  return addDays(validUntil, 30);
}
