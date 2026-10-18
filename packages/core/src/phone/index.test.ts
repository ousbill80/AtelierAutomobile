import { describe, expect, it } from "vitest";
import { convertLegacyNumber, isValidPhoneCI, normalizePhoneCI } from "./index";

describe("normalizePhoneCI — formats tolérés", () => {
  it.each([
    "0712345678",
    "07 12 34 56 78",
    "+225 07 12 34 56 78",
    "225 07 12 34 56 78",
    "00 225 07 12 34 56 78",
    "07.12.34.56.78",
    "07-12-34-56-78",
  ])("normalise %s en +2250712345678", (input) => {
    expect(normalizePhoneCI(input)).toEqual({
      raw: input,
      status: "OK",
      e164: "+2250712345678",
    });
  });
});

describe("normalizePhoneCI — A13 anciens numéros à 8 chiffres", () => {
  it("signale « à vérifier » quand le préfixe n'est pas dans la table ARTCI", () => {
    expect(normalizePhoneCI("20123456")).toEqual({
      raw: "20123456",
      status: "NEEDS_REVIEW",
      e164: null,
    });
  });

  it("convertLegacyNumber résout via une table injectée, sans deviner", () => {
    expect(convertLegacyNumber("20123456", { "20": "27" })).toBe("2720123456");
    expect(convertLegacyNumber("20123456", {})).toBeUndefined();
  });
});

describe("normalizePhoneCI — formats invalides", () => {
  it.each(["123", "071234567", "07123456789", "abcdefghij"])("rejette %s", (input) => {
    expect(() => normalizePhoneCI(input)).toThrow(/invalide/);
  });
});

describe("isValidPhoneCI", () => {
  it("valide un E.164 bien formé et rejette le reste", () => {
    expect(isValidPhoneCI("+2250712345678")).toBe(true);
    expect(isValidPhoneCI("0712345678")).toBe(false);
    expect(isValidPhoneCI("+22507123456")).toBe(false);
  });
});
