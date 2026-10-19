import { describe, expect, it } from "vitest";
import { computeDuplicateScore, type DuplicateSignals } from "./duplicates";

const NONE: DuplicateSignals = {
  samePhone: false,
  sameEmail: false,
  sameNcc: false,
  displayNameSimilarity: 0,
  sameCommune: false,
  sharedVehicle: false,
};

describe("computeDuplicateScore — RG-M02-07", () => {
  it("même téléphone → +60", () => {
    expect(computeDuplicateScore({ ...NONE, samePhone: true })).toMatchObject({
      score: 60,
      level: "SUGGESTION",
      reasons: ["même téléphone"],
    });
  });

  it("même email → +50", () => {
    expect(computeDuplicateScore({ ...NONE, sameEmail: true }).score).toBe(50);
  });

  it("même NCC → +70", () => {
    const result = computeDuplicateScore({ ...NONE, sameNcc: true });
    expect(result.score).toBe(70);
    expect(result.level).toBe("SUGGESTION");
  });

  it("similarité de nom ≥ 0,85 → +35", () => {
    expect(computeDuplicateScore({ ...NONE, displayNameSimilarity: 0.92 }).score).toBe(35);
  });

  it("similarité de nom entre 0,6 et 0,85 → +20", () => {
    expect(computeDuplicateScore({ ...NONE, displayNameSimilarity: 0.7 }).score).toBe(20);
  });

  it("similarité de nom < 0,6 → aucun point", () => {
    expect(computeDuplicateScore({ ...NONE, displayNameSimilarity: 0.59 }).score).toBe(0);
  });

  it("même commune → +5", () => {
    expect(computeDuplicateScore({ ...NONE, sameCommune: true }).score).toBe(5);
  });

  it("même véhicule → +40", () => {
    expect(computeDuplicateScore({ ...NONE, sharedVehicle: true }).score).toBe(40);
  });

  it("cumul : nom similaire à 92 % + même commune", () => {
    const result = computeDuplicateScore({
      ...NONE,
      displayNameSimilarity: 0.92,
      sameCommune: true,
    });
    expect(result.score).toBe(40);
    expect(result.reasons).toEqual(["nom similaire à 92 %", "même commune"]);
  });

  it("seuil 50 : score exactement 50 → SUGGESTION ; 49 → NONE", () => {
    expect(computeDuplicateScore({ ...NONE, sameEmail: true }).level).toBe("SUGGESTION"); // 50
    expect(
      computeDuplicateScore({ ...NONE, displayNameSimilarity: 0.7, sameCommune: false }).level,
    ).toBe("NONE"); // 20
  });

  it("seuil 80 : score exactement 80 (téléphone + nom similaire 70 %) → BLOCKING ; 75 → SUGGESTION", () => {
    expect(
      computeDuplicateScore({ ...NONE, samePhone: true, displayNameSimilarity: 0.7 }).level,
    ).toBe("BLOCKING"); // 60 + 20 = 80
    expect(computeDuplicateScore({ ...NONE, sameNcc: true, sameCommune: true }).level).toBe(
      "SUGGESTION",
    ); // 70 + 5 = 75
  });

  it("score ≥ 80 (téléphone + nom très similaire) → BLOCKING", () => {
    const result = computeDuplicateScore({ ...NONE, samePhone: true, displayNameSimilarity: 0.95 });
    expect(result.score).toBe(95);
    expect(result.level).toBe("BLOCKING");
  });

  it("score plafonné à 100", () => {
    const result = computeDuplicateScore({
      samePhone: true,
      sameEmail: true,
      sameNcc: true,
      displayNameSimilarity: 0.9,
      sameCommune: true,
      sharedVehicle: true,
    });
    expect(result.score).toBe(100);
  });
});
