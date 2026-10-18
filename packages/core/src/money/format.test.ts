import { describe, expect, it } from "vitest";
import { formatFCFA, parseFCFA } from "./format";

describe("formatFCFA", () => {
  it("groupe les milliers par un espace et ajoute le suffixe FCFA", () => {
    expect(formatFCFA(185000)).toBe("185 000 FCFA");
    expect(formatFCFA(1250000)).toBe("1 250 000 FCFA");
    expect(formatFCFA(0)).toBe("0 FCFA");
    expect(formatFCFA(999)).toBe("999 FCFA");
  });

  it("garde le signe pour un montant négatif (avoir)", () => {
    expect(formatFCFA(-5000)).toBe("-5 000 FCFA");
  });

  it("refuse un montant non entier", () => {
    expect(() => formatFCFA(185000.5)).toThrow("Un montant FCFA doit être un entier.");
  });
});

describe("parseFCFA", () => {
  it.each([
    ["185 000", 185000],
    ["185.000", 185000],
    ["185000 F", 185000],
    ["185000 FCFA", 185000],
    ["185000", 185000],
    [" 185 000 ", 185000],
    ["185,000", 185000],
  ])("parse %s → %i", (input, expected) => {
    expect(parseFCFA(input)).toBe(expected);
  });

  it("préserve le signe négatif (avoir)", () => {
    expect(parseFCFA("-5 000 FCFA")).toBe(-5000);
  });

  it("refuse une saisie sans chiffre", () => {
    expect(() => parseFCFA("FCFA")).toThrow(/Montant invalide/);
    expect(() => parseFCFA("")).toThrow(/Montant invalide/);
  });
});
