import { DomainError } from "../errors";

// RG-M15-01 — identité légale et fiscale du garage.

/** NCC : 7 chiffres suivis d'une lettre majuscule (ex. 1912345A). Validation stricte (bloquante). */
export const NCC_REGEX = /^\d{7}[A-Z]$/;

/** RCCM ivoirien courant : CI-ABJ-2019-B-12345. Avertissement seulement (anciens formats existent). */
export const RCCM_REGEX = /^CI-[A-Z]{3}-\d{4}-[A-Z]-\d{1,6}$/;

export function isValidNccFormat(ncc: string): boolean {
  return NCC_REGEX.test(ncc);
}

export function isValidRccmFormat(rccm: string): boolean {
  return RCCM_REGEX.test(rccm);
}

/** Champs requis par RG-M15-01 pour pouvoir émettre une facture (bloquant, cf. M08). */
export interface OrganizationIdentityForInvoicing {
  legalName: string | null;
  ncc: string | null;
  rccm: string | null;
  address: string | null;
  phone: string | null;
  taxRegime: string | null;
}

const INVOICE_FIELD_LABELS: Record<keyof OrganizationIdentityForInvoicing, string> = {
  legalName: "Raison sociale",
  ncc: "NCC",
  rccm: "RCCM",
  address: "Adresse",
  phone: "Téléphone",
  taxRegime: "Régime fiscal",
};

/** RG-M15-01 — liste des champs manquants (libellés FR) empêchant l'émission d'une facture. */
export function getMissingInvoiceFields(org: OrganizationIdentityForInvoicing): string[] {
  const missing: string[] = [];
  for (const key of Object.keys(INVOICE_FIELD_LABELS) as Array<
    keyof OrganizationIdentityForInvoicing
  >) {
    const value = org[key];
    if (value === null || value === undefined || value === "") {
      missing.push(INVOICE_FIELD_LABELS[key]);
    }
  }
  return missing;
}

/** RG-M15-01 — lève si l'identité du garage ne permet pas d'émettre une facture. */
export function assertCanIssueInvoice(org: OrganizationIdentityForInvoicing): void {
  const missing = getMissingInvoiceFields(org);
  if (missing.length > 0) {
    throw new DomainError(
      "organization.incomplete_identity",
      `Impossible d'émettre une facture : complétez d'abord ${missing.join(", ")} dans /parametres/garage.`,
      { missing },
    );
  }
}
