import { DomainError } from "../errors";

/** Affiche un montant entier FCFA : formatFCFA(185000) → "185 000 FCFA". */
export function formatFCFA(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new DomainError("money.not_integer", "Un montant FCFA doit être un entier.", { amount });
  }
  const sign = amount < 0 ? "-" : "";
  const grouped = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} FCFA`;
}

/**
 * Lit un montant saisi librement ("185 000", "185.000", "185000 F", "185000 FCFA")
 * en entier FCFA. Les séparateurs (espace, point, virgule) sont des groupements
 * de milliers, jamais des décimales : le FCFA n'a pas de sous-unité.
 */
export function parseFCFA(input: string): number {
  const trimmed = input.trim();
  const negative = trimmed.startsWith("-");
  const digitsOnly = trimmed.replace(/[^0-9]/g, "");
  if (digitsOnly === "") {
    throw new DomainError("money.invalid_format", `Montant invalide : « ${input} ».`, { input });
  }
  const value = Number.parseInt(digitsOnly, 10);
  return negative ? -value : value;
}
