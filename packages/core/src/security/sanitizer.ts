// 01-architecture-technique.md §8 & Étape 7.1 — masquage et purge des journaux (sécurité et vie privée)
// Garantit qu'aucun mot de passe, clé d'API, code OTP, jeton ou donnée personnelle non masquée ne fuite dans les logs.

const SENSITIVE_KEY_PATTERN =
  /pass|secret|token|key|auth|cookie|session|signature|otp|pin|credential/i;

const PHONE_REGEX = /\+\d{1,3}(?:[\s.-]?\d){8,12}|(?<!\d)0\d(?:[\s.-]?\d{2}){4}(?!\d)/g;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export const MASKED_STRING = "********";
export const REDACTED_VALUE = "[MASQUÉ]";

/**
 * Détecte si un nom de champ / clé est sensible (mot de passe, secret, jeton, etc.).
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Nettoie une chaîne de texte libre de toute information personnelle ou sensible évidente.
 */
export function scrubLogMessage(message: string): string {
  return message.replace(EMAIL_REGEX, "[EMAIL]").replace(PHONE_REGEX, "[TÉLÉPHONE]");
}

/**
 * Masque récursivement les clés sensibles dans un objet ou dictionnaire avant journalisation.
 */
export function sanitizeLogData<T>(data: T, depth = 0): T {
  if (depth > 6 || data === null || data === undefined) return data;

  if (typeof data === "string") {
    return scrubLogMessage(data) as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item, depth + 1)) as unknown as T;
  }

  if (typeof data === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (isSensitiveKey(key)) {
        copy[key] = MASKED_STRING;
      } else {
        copy[key] = sanitizeLogData(value, depth + 1);
      }
    }
    return copy as T;
  }

  return data;
}
