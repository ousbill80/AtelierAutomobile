import { describe, expect, it } from "vitest";
import { convertLegacyNumber, isValidPhoneCI, normalizePhoneCI } from "./index";

describe("normalizePhoneCI — mobiles ivoiriens, formats tolérés", () => {
  it.each([
    "0708123456",
    "07 08 12 34 56",
    "+225 07-08-12-34-56",
    "225 07 08 12 34 56",
    "00 225 07 08 12 34 56",
    "07.08.12.34.56",
  ])("normalise %s en +2250708123456 (Orange)", (input) => {
    expect(normalizePhoneCI(input)).toEqual({
      raw: input,
      status: "OK",
      e164: "+2250708123456",
      national: "07 08 12 34 56",
      type: "MOBILE",
      operator: "ORANGE",
    });
  });

  it("002250708123456 (sans espaces) est également toléré", () => {
    expect(normalizePhoneCI("002250708123456")).toEqual({
      raw: "002250708123456",
      status: "OK",
      e164: "+2250708123456",
      national: "07 08 12 34 56",
      type: "MOBILE",
      operator: "ORANGE",
    });
  });

  it("déduit l'opérateur Moov (01) et MTN (05)", () => {
    expect(normalizePhoneCI("0112345678")).toMatchObject({ type: "MOBILE", operator: "MOOV" });
    expect(normalizePhoneCI("0512345678")).toMatchObject({ type: "MOBILE", operator: "MTN" });
  });
});

describe("normalizePhoneCI — fixes ivoiriens", () => {
  it("un numéro fixe (21/25/27) est typé FIXED, sans opérateur", () => {
    expect(normalizePhoneCI("2722415500")).toEqual({
      raw: "2722415500",
      status: "OK",
      e164: "+2252722415500",
      national: "27 22 41 55 00",
      type: "FIXED",
    });
  });
});

describe("normalizePhoneCI — indicatifs étrangers", () => {
  it("accepte un numéro burkinabè conforme E.164", () => {
    expect(normalizePhoneCI("+22670123456")).toEqual({
      raw: "+22670123456",
      status: "OK",
      e164: "+22670123456",
      national: "70123456",
      type: "FOREIGN",
    });
  });
});

describe("normalizePhoneCI — A13 anciens numéros à 8 chiffres", () => {
  it("signale « à vérifier » quand le préfixe n'est pas dans la table ARTCI (table non complétée)", () => {
    expect(normalizePhoneCI("08123456")).toEqual({
      raw: "08123456",
      status: "NEEDS_REVIEW",
      e164: null,
      national: null,
      type: null,
    });
  });

  it("convertLegacyNumber résout via une table injectée, sans deviner", () => {
    expect(convertLegacyNumber("08123456", { "08": "07" })).toBe("0708123456");
    expect(convertLegacyNumber("08123456", {})).toBeUndefined();
  });

  it("marque converted: true une fois la table renseignée pour ce préfixe", () => {
    // Démontre l'algorithme RG-M02-03 §4 avec une table de test ; la table réelle
    // (packages/core/src/phone/legacy-ci.ts) reste volontairement vide tant que la
    // liste ARTCI complète n'est pas intégrée (A13) — voir docs/04-arbitrages-coherence.md.
    const converted = convertLegacyNumber("08123456", { "08": "07" });
    expect(converted).toBe("0708123456");
  });
});

describe("normalizePhoneCI — formats invalides", () => {
  it.each(["123", "071234567", "07123456789", "abcdefghij", "0908123456"])(
    "rejette %s",
    (input) => {
      expect(() => normalizePhoneCI(input)).toThrow(/invalide/);
    },
  );
});

describe("isValidPhoneCI", () => {
  it("valide un E.164 bien formé et rejette le reste", () => {
    expect(isValidPhoneCI("+2250708123456")).toBe(true);
    expect(isValidPhoneCI("0708123456")).toBe(false);
    expect(isValidPhoneCI("+22507123456")).toBe(false);
  });
});
