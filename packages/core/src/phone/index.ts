import { DomainError } from "../errors";
import { LEGACY_CI_PREFIX_MAP } from "./legacy-ci";

export type PhoneStatus = "OK" | "NEEDS_REVIEW";
export type PhoneType = "MOBILE" | "FIXED" | "FOREIGN";
export type PhoneOperator = "ORANGE" | "MTN" | "MOOV";

export interface NormalizedPhone {
  raw: string;
  status: PhoneStatus;
  /** +225 + 10 chiffres, ou +<indicatif étranger> ; null si le numéro est à vérifier (A13). */
  e164: string | null;
  /** Numéro national formaté en groupes de 2 chiffres (ex. "07 08 12 34 56"), null si à vérifier. */
  national: string | null;
  /** MOBILE/FIXED pour la Côte d'Ivoire, FOREIGN pour un autre indicatif. */
  type: PhoneType | null;
  /** Opérateur déduit du préfixe mobile ivoirien (01 Moov, 05 MTN, 07 Orange). */
  operator?: PhoneOperator;
  /** true si le numéro provient d'une conversion automatique d'un ancien numéro à 8 chiffres. */
  converted?: boolean;
}

const COUNTRY_CODE = "225";

/** Préfixes nationaux ivoiriens valides (plan de numérotation 2021). */
const MOBILE_PREFIXES: Record<string, PhoneOperator> = {
  "01": "MOOV",
  "05": "MTN",
  "07": "ORANGE",
};
const FIXED_PREFIXES = new Set(["21", "25", "27"]);

function onlyDigits(input: string): string {
  return input.replace(/\D/g, "");
}

function formatNational(digits10: string): string {
  return digits10.match(/.{1,2}/g)?.join(" ") ?? digits10;
}

/**
 * Sépare un éventuel indicatif international des chiffres significatifs.
 * Retourne `{ countryCode, nationalDigits }` ; `countryCode` vaut `""` quand
 * aucun indicatif n'a été détecté (numéro saisi en local, sans `+`/`00`).
 */
function splitCountryCode(
  rawInput: string,
  digits: string,
): { countryCode: string; nationalDigits: string } {
  const hadPlus = rawInput.trim().startsWith("+");

  if (digits.startsWith(`00${COUNTRY_CODE}`)) {
    return { countryCode: COUNTRY_CODE, nationalDigits: digits.slice(5) };
  }
  if (hadPlus && digits.startsWith(COUNTRY_CODE)) {
    return { countryCode: COUNTRY_CODE, nationalDigits: digits.slice(3) };
  }
  if (!hadPlus && digits.startsWith(COUNTRY_CODE) && digits.length === 13) {
    return { countryCode: COUNTRY_CODE, nationalDigits: digits.slice(3) };
  }

  if (hadPlus) {
    // Indicatif international étranger : on tente les longueurs usuelles (1 à 3 chiffres)
    // en laissant au moins 6 chiffres de numéro national significatif.
    for (const len of [3, 2, 1]) {
      if (digits.length - len >= 6 && digits.slice(0, len) !== COUNTRY_CODE) {
        return { countryCode: digits.slice(0, len), nationalDigits: digits.slice(len) };
      }
    }
  }

  return { countryCode: "", nationalDigits: digits };
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
 * espaces, points, tirets, parenthèses et préfixes internationaux (+225, 00225, 225).
 * Un ancien numéro à 8 chiffres non résolu par la table ARTCI (A13) est
 * renvoyé avec `status: "NEEDS_REVIEW"` et `e164: null` plutôt que deviné.
 * Les indicatifs étrangers conformes E.164 (diaspora, clients burkinabè…) sont acceptés tels quels.
 */
export function normalizePhoneCI(input: string): NormalizedPhone {
  const digits = onlyDigits(input);
  const { countryCode, nationalDigits } = splitCountryCode(input, digits);

  // Numéro ivoirien (indicatif 225 détecté ou absent, saisi en local sur 10 chiffres).
  if (countryCode === COUNTRY_CODE || countryCode === "") {
    if (nationalDigits.length === 10) {
      const prefix = nationalDigits.slice(0, 2);
      const operator = MOBILE_PREFIXES[prefix];
      if (operator) {
        return {
          raw: input,
          status: "OK",
          e164: `+${COUNTRY_CODE}${nationalDigits}`,
          national: formatNational(nationalDigits),
          type: "MOBILE",
          operator,
        };
      }
      if (FIXED_PREFIXES.has(prefix)) {
        return {
          raw: input,
          status: "OK",
          e164: `+${COUNTRY_CODE}${nationalDigits}`,
          national: formatNational(nationalDigits),
          type: "FIXED",
        };
      }
      throw new DomainError(
        "phone.invalid_format",
        `Numéro de téléphone invalide : « ${input} ».`,
        { input },
      );
    }

    if (nationalDigits.length === 8) {
      const converted = convertLegacyNumber(nationalDigits);
      if (converted) {
        return {
          raw: input,
          status: "OK",
          e164: `+${COUNTRY_CODE}${converted}`,
          national: formatNational(converted),
          type: MOBILE_PREFIXES[converted.slice(0, 2)] ? "MOBILE" : "FIXED",
          operator: MOBILE_PREFIXES[converted.slice(0, 2)],
          converted: true,
        };
      }
      return {
        raw: input,
        status: "NEEDS_REVIEW",
        e164: null,
        national: null,
        type: null,
      };
    }

    throw new DomainError("phone.invalid_format", `Numéro de téléphone invalide : « ${input} ».`, {
      input,
    });
  }

  // Indicatif international étranger (diaspora, clients de la sous-région).
  if (nationalDigits.length < 6 || nationalDigits.length > 12) {
    throw new DomainError("phone.invalid_format", `Numéro de téléphone invalide : « ${input} ».`, {
      input,
    });
  }
  return {
    raw: input,
    status: "OK",
    e164: `+${countryCode}${nationalDigits}`,
    national: nationalDigits,
    type: "FOREIGN",
  };
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
