import { normalizePhoneCI } from "@atelieros/core";

export interface ResolvedIdentifier {
  kind: "EMAIL" | "PHONE";
  value: string;
}

/** Un identifiant de connexion est soit un email, soit un numéro ivoirien normalisé E.164. */
export function resolveIdentifier(identifier: string): ResolvedIdentifier {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) {
    return { kind: "EMAIL", value: trimmed.toLowerCase() };
  }
  const normalized = normalizePhoneCI(trimmed);
  if (normalized.status !== "OK" || !normalized.e164) {
    throw new Error("Numéro de téléphone invalide.");
  }
  return { kind: "PHONE", value: normalized.e164 };
}
