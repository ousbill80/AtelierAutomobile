import { DomainError } from "../errors";
import type { Role } from "./permissions";

// RG-M01-14 — PIN atelier à 4 chiffres : refus des suites triviales (0000, 1234, 1111…).
// Utilisable uniquement pour ces rôles, sur un appareil partagé d'atelier.
export const PIN_ELIGIBLE_ROLES: readonly Role[] = ["MANAGER", "MECHANIC", "STOREKEEPER"];

export const PIN_MAX_FAILED_ATTEMPTS = 5;

/** Vrai si le PIN à 4 chiffres est trivial : chiffres identiques ou suite consécutive. */
export function isTrivialPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin)) {
    throw new DomainError("pin.invalid_format", "Le code PIN doit comporter 4 chiffres.", {
      pin,
    });
  }

  const digits = pin.split("").map(Number);
  const allSame = digits.every((d) => d === digits[0]);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1]! + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1]! - 1);
  return allSame || ascending || descending;
}
