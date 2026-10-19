import { DomainError } from "../errors";

export type CustomerType = "INDIVIDUAL" | "COMPANY";

export interface ComputeDisplayNameInput {
  type: CustomerType;
  lastName?: string | null;
  firstName?: string | null;
  companyName?: string | null;
}

/** Capitalise un segment (première lettre majuscule, reste en minuscules). */
function capitalizeSegment(segment: string): string {
  if (segment.length === 0) {
    return segment;
  }
  return segment[0]!.toUpperCase() + segment.slice(1).toLowerCase();
}

/**
 * Majuscule initiale à chaque mot, en conservant les particules composées
 * (apostrophe, tiret) comme séparateurs de capitalisation : « n'guessan » → « N'Guessan »,
 * « kouadio-konan » → « Kouadio-Konan ».
 */
function titleCaseWord(word: string): string {
  return word
    .split(/([-'])/)
    .map((part) => (part === "-" || part === "'" ? part : capitalizeSegment(part)))
    .join("");
}

function titleCase(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).map(titleCaseWord).join(" ");
}

/**
 * RG-M02-01 — nom affiché du client. `INDIVIDUAL` exige `lastName` (usage ivoirien :
 * nom puis prénoms). `COMPANY` exige `companyName`, utilisé tel quel (pas de recasse).
 */
export function computeDisplayName(input: ComputeDisplayNameInput): string {
  if (input.type === "COMPANY") {
    const companyName = input.companyName?.trim();
    if (!companyName) {
      throw new DomainError(
        "customer.display_name.missing_company_name",
        "Le nom de l'entreprise est obligatoire pour un client Entreprise.",
      );
    }
    return companyName;
  }

  const lastName = input.lastName?.trim();
  if (!lastName) {
    throw new DomainError(
      "customer.display_name.missing_last_name",
      "Le nom de famille est obligatoire pour un client Particulier.",
    );
  }
  const firstName = input.firstName?.trim();
  const full = firstName ? `${lastName} ${firstName}` : lastName;
  return titleCase(full);
}
