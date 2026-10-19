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

export type PhoneLineType = "MOBILE" | "FIXED" | "FOREIGN";

const CI_FIXED_PREFIXES = ["21", "25", "27"];

/**
 * RG-M02-03 — classe un numéro E.164 pour les règles de canal (un numéro FIXED ne reçoit
 * jamais de WhatsApp ni de SMS). Les numéros hors +225 sont `FOREIGN` (diaspora).
 */
export function phoneLineType(e164: string): PhoneLineType {
  if (!e164.startsWith(`+${COUNTRY_CODE}`)) {
    return "FOREIGN";
  }
  const nationalNumber = e164.slice(`+${COUNTRY_CODE}`.length);
  const prefix = nationalNumber.slice(0, 2);
  if (CI_FIXED_PREFIXES.includes(prefix)) {
    return "FIXED";
  }
  return "MOBILE";
}
