import { checkPasswordPolicy, type PasswordPolicyContext } from "@atelieros/core";
import { TRPCError } from "@trpc/server";

const VIOLATION_MESSAGES: Record<string, string> = {
  TOO_SHORT: "Le mot de passe doit contenir au moins 8 caractères.",
  MISSING_LETTER_OR_DIGIT: "Le mot de passe doit contenir au moins une lettre et un chiffre.",
  COMMON_PASSWORD: "Ce mot de passe est trop courant. Choisissez-en un autre.",
  CONTEXTUAL_MATCH:
    "Le mot de passe ne doit pas contenir « garage », le nom du garage ou votre numéro de téléphone.",
};

/** RG-M01-03 — lève une erreur French-friendly si le mot de passe ne respecte pas la politique. */
export function assertPasswordPolicy(password: string, context?: PasswordPolicyContext): void {
  const violation = checkPasswordPolicy(password, context);
  if (violation) {
    throw new TRPCError({ code: "BAD_REQUEST", message: VIOLATION_MESSAGES[violation] });
  }
}
