import { describe, expect, it } from "vitest";
import { duplicateScore, duplicateSeverity } from "./duplicates";

describe("duplicateScore — RG-M02-07", () => {
  it("chaque signal apporte ses points", () => {
    expect(duplicateScore({ samePhone: true })).toEqual({ score: 60, reasons: ["même téléphone"] });
    expect(duplicateScore({ sameEmail: true })).toEqual({ score: 50, reasons: ["même email"] });
    expect(duplicateScore({ sameNcc: true })).toEqual({ score: 70, reasons: ["même NCC"] });
    expect(duplicateScore({ sameCommune: true })).toEqual({ score: 5, reasons: ["même commune"] });
    expect(duplicateScore({ sharedVehicle: true })).toEqual({
      score: 40,
      reasons: ["même véhicule"],
    });
  });

  it("similarité de nom : +35 si ≥ 0,85, +20 si entre 0,6 et 0,85", () => {
    expect(duplicateScore({ nameSimilarity: 0.92 }).score).toBe(35);
    expect(duplicateScore({ nameSimilarity: 0.7 }).score).toBe(20);
    expect(duplicateScore({ nameSimilarity: 0.5 }).score).toBe(0);
  });

  it("cumule les signaux et plafonne à 100", () => {
    const result = duplicateScore({
      samePhone: true,
      sameEmail: true,
      sameNcc: true,
      nameSimilarity: 0.95,
      sameCommune: true,
      sharedVehicle: true,
    });
    expect(result.score).toBe(100);
    expect(result.reasons).toHaveLength(6);
  });

  it("seuils 50/80 (RG-M02-07)", () => {
    expect(duplicateSeverity(79)).toBe("SUGGEST");
    expect(duplicateSeverity(80)).toBe("BLOCK");
    expect(duplicateSeverity(49)).toBe("NONE");
    expect(duplicateSeverity(50)).toBe("SUGGEST");
  });
});
