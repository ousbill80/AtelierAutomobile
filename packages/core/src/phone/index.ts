import { DomainError } from "../errors";
import { LEGACY_CI_PREFIX_MAP } from "./legacy-ci";

export type PhoneStatus = "OK" | "NEEDS_REVIEW";

export interface NormalizedPhone {
  raw: string;
  status: PhoneStatus;
  /** +225 + 10 chiffres, ou null si le numéro est à vérifier (A13). */
  e164: string | null;
}

const COUNTRY_CODE = "225";

function onlyDigits(input: string): string {
  return input.replace(/\D/g, "");
}

function stripCountryCode(digits: string): string {
  if (digits.startsWith(`00${COUNTRY_CODE}`)) {
    return digits.slice(5);
  }
  if (digits.startsWith(COUNTRY_CODE) && digits.length === 13) {
    return digits.slice(3);
  }
  return digits;
}

/** A13 — convertit un ancien numéro à 8 chiffres via la table ARTCI (injectable pour les tests). */
export function convertLegacyNumber(
  oldNumber: string,
  table: Record<string, string> = LEGACY_CI_PREFIX_MAP,
): string | undefined {
  const newPrefix = table[oldNumber.slice(0, 2)];
  return newPrefix ? `${newPrefix}${oldNumber}` : undefined;
}

/**
 * Normalise un numéro ivoirien vers E.164 (+225 + 10 chiffres). Tolère les
 * espaces, points, tirets et préfixes internationaux (+225, 00225, 225).
 * Un ancien numéro à 8 chiffres non résolu par la table ARTCI (A13) est
 * renvoyé avec `status: "NEEDS_REVIEW"` et `e164: null` plutôt que deviné.
 */
export function normalizePhoneCI(input: string): NormalizedPhone {
  const digits = stripCountryCode(onlyDigits(input));

  if (digits.length === 10) {
    return { raw: input, status: "OK", e164: `+${COUNTRY_CODE}${digits}` };
  }

  if (digits.length === 8) {
    const converted = convertLegacyNumber(digits);
    if (converted) {
      return { raw: input, status: "OK", e164: `+${COUNTRY_CODE}${converted}` };
    }
    return { raw: input, status: "NEEDS_REVIEW", e164: null };
  }

  throw new DomainError("phone.invalid_format", `Numéro de téléphone invalide : « ${input} ».`, {
    input,
  });
}

export function isValidPhoneCI(e164: string): boolean {
  return new RegExp(`^\\+${COUNTRY_CODE}\\d{10}$`).test(e164);
}

export type PhoneLineType = "MOBILE" | "FIXED";

/** Préfixes ivoiriens de lignes fixes (après +225) : 21, 25, 27 (RG-M10-11, M10 §4.3). */
const FIXED_LINE_PREFIXES = ["21", "25", "27"];

/**
 * RG-M10-11 — classifie un numéro E.164 ivoirien en `FIXED` (ne reçoit ni SMS ni WhatsApp) ou
 * `MOBILE`. Un numéro mal formé (hors `+225` + 10 chiffres) est traité comme `MOBILE` par défaut
 * (prudence : on ne veut pas exclure un canal à tort sur une erreur de format).
 */
export function classifyPhoneCI(e164: string): PhoneLineType {
  const match = new RegExp(`^\\+${COUNTRY_CODE}(\\d{2})`).exec(e164);
  const prefix = match?.[1];
  return prefix && FIXED_LINE_PREFIXES.includes(prefix) ? "FIXED" : "MOBILE";
}
