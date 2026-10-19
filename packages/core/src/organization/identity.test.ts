import { describe, expect, it } from "vitest";
import {
  assertCanIssueInvoice,
  getMissingInvoiceFields,
  isValidNccFormat,
  isValidRccmFormat,
  type OrganizationIdentityForInvoicing,
} from "./identity";

const COMPLETE: OrganizationIdentityForInvoicing = {
  legalName: "Garage Excellence Auto SARL",
  ncc: "1912345A",
  rccm: "CI-ABJ-2019-B-12345",
  address: "Abidjan, Yopougon",
  phone: "+2250102030405",
  taxRegime: "RSI",
};

describe("isValidNccFormat — RG-M15-01 (7 chiffres + 1 lettre majuscule)", () => {
  it.each(["1912345A", "0000001Z"])("accepte « %s »", (ncc) => {
    expect(isValidNccFormat(ncc)).toBe(true);
  });

  it.each([
    "1912345a", // lettre minuscule
    "191234A", // 6 chiffres seulement
    "19123456A", // 8 chiffres
    "1912345AB", // 2 lettres
    "191234A5", // lettre pas en dernier
    "",
  ])("refuse « %s »", (ncc) => {
    expect(isValidNccFormat(ncc)).toBe(false);
  });
});

describe("isValidRccmFormat — RG-M15-01 (avertissement seulement, formats anciens tolérés ailleurs)", () => {
  it.each(["CI-ABJ-2019-B-12345", "CI-ABJ-2019-B-1"])("accepte « %s »", (rccm) => {
    expect(isValidRccmFormat(rccm)).toBe(true);
  });

  it.each([
    "ABJ-2019-B-12345", // sans le préfixe CI-
    "CI-AB-2019-B-12345", // 2 lettres de ville au lieu de 3
    "CI-ABJ-19-B-12345", // année sur 2 chiffres
    "CI-ABJ-2019-1-12345", // chiffre à la place de la lettre de type
    "",
  ])("refuse (ancien format ou invalide) « %s »", (rccm) => {
    expect(isValidRccmFormat(rccm)).toBe(false);
  });
});

describe("getMissingInvoiceFields — RG-M15-01", () => {
  it("renvoie un tableau vide quand tous les champs requis sont présents", () => {
    expect(getMissingInvoiceFields(COMPLETE)).toEqual([]);
  });

  it("liste les libellés français des champs manquants (null)", () => {
    const missing = getMissingInvoiceFields({ ...COMPLETE, ncc: null, phone: null });
    expect(missing).toEqual(["NCC", "Téléphone"]);
  });

  it("traite une chaîne vide comme manquante", () => {
    const missing = getMissingInvoiceFields({ ...COMPLETE, legalName: "" });
    expect(missing).toEqual(["Raison sociale"]);
  });

  it("liste tous les champs quand rien n'est renseigné", () => {
    const missing = getMissingInvoiceFields({
      legalName: null,
      ncc: null,
      rccm: null,
      address: null,
      phone: null,
      taxRegime: null,
    });
    expect(missing).toEqual([
      "Raison sociale",
      "NCC",
      "RCCM",
      "Adresse",
      "Téléphone",
      "Régime fiscal",
    ]);
  });
});

describe("assertCanIssueInvoice — RG-M15-01 (bloquant à l'émission)", () => {
  it("ne lève pas quand tous les champs requis sont présents", () => {
    expect(() => assertCanIssueInvoice(COMPLETE)).not.toThrow();
  });

  it("lève une DomainError listant les champs manquants dans le message et les details", () => {
    try {
      assertCanIssueInvoice({ ...COMPLETE, ncc: null, rccm: null });
      throw new Error("devrait avoir levé");
    } catch (error) {
      expect((error as Error).message).toMatch(/NCC, RCCM/);
      expect((error as Error).message).toMatch(/\/parametres\/garage/);
      expect((error as { details?: { missing?: string[] } }).details?.missing).toEqual([
        "NCC",
        "RCCM",
      ]);
    }
  });
});
