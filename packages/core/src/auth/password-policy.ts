import { COMMON_PASSWORDS } from "./data/common-passwords";

const COMMON_PASSWORD_SET: ReadonlySet<string> = new Set(COMMON_PASSWORDS);
const PASSWORD_MIN_LENGTH = 8;

export type PasswordPolicyViolation =
  "TOO_SHORT" | "MISSING_LETTER_OR_DIGIT" | "COMMON_PASSWORD" | "CONTEXTUAL_MATCH";

export interface PasswordPolicyContext {
  garageName?: string | null;
  phone?: string | null;
}

function alphanumericOnly(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * RG-M01-03 — 8 caractères minimum, au moins une lettre et un chiffre, refusé s'il figure
 * dans la liste des 10 000 mots de passe les plus courants, ou s'il contient « garage »,
 * le nom du garage ou le numéro de téléphone du compte.
 */
export function checkPasswordPolicy(
  password: string,
  context: PasswordPolicyContext = {},
): PasswordPolicyViolation | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "TOO_SHORT";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "MISSING_LETTER_OR_DIGIT";

  const lower = password.toLowerCase();
  if (COMMON_PASSWORD_SET.has(lower)) return "COMMON_PASSWORD";

  const compactPassword = alphanumericOnly(password);
  if (compactPassword.includes("garage")) return "CONTEXTUAL_MATCH";

  if (context.garageName) {
    const significantWords = context.garageName
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4);
    if (significantWords.some((word) => compactPassword.includes(word))) {
      return "CONTEXTUAL_MATCH";
    }
  }

  if (context.phone) {
    const phoneDigits = digitsOnly(context.phone);
    const passwordDigits = digitsOnly(password);
    const significantDigits = phoneDigits.slice(-8);
    if (significantDigits.length >= 6 && passwordDigits.includes(significantDigits)) {
      return "CONTEXTUAL_MATCH";
    }
  }

  return null;
}

export function isPasswordPolicyCompliant(
  password: string,
  context?: PasswordPolicyContext,
): boolean {
  return checkPasswordPolicy(password, context) === null;
}
