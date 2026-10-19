import { describe, expect, it } from "vitest";
import { computeAvgKmPerDay, DEFAULT_AVG_KM_PER_DAY, estimateMileage } from "./mileage";

describe("computeAvgKmPerDay — RG-M02-10", () => {
  it("renvoie la valeur par défaut avec moins de 2 relevés", () => {
    const result = computeAvgKmPerDay(
      [{ mileage: 10000, readAt: new Date("2026-10-01") }],
      "PRIVATE",
      new Date("2026-10-18"),
    );
    expect(result).toEqual({ avgKmPerDay: DEFAULT_AVG_KM_PER_DAY.PRIVATE, source: "DEFAULT" });
  });

  it("renvoie la valeur par défaut si les relevés sont espacés de moins de 14 jours", () => {
    const result = computeAvgKmPerDay(
      [
        { mileage: 10000, readAt: new Date("2026-10-10") },
        { mileage: 10100, readAt: new Date("2026-10-18") },
      ],
      "TAXI",
      new Date("2026-10-18"),
    );
    expect(result).toEqual({ avgKmPerDay: DEFAULT_AVG_KM_PER_DAY.TAXI, source: "DEFAULT" });
  });

  it("calcule le taux exact pour 2 relevés (exemple RG-M02-13 : 5 700 km / 120 j = 47,5)", () => {
    const result = computeAvgKmPerDay(
      [
        { mileage: 42500, readAt: new Date("2026-06-20") },
        { mileage: 48200, readAt: new Date("2026-10-18") },
      ],
      "PRIVATE",
      new Date("2026-10-18"),
    );
    expect(result.source).toBe("REGRESSION");
    expect(result.avgKmPerDay).toBeCloseTo(47.5, 1);
  });

  it("pondère ×2 les relevés des 6 derniers mois, tirant la pente vers le segment récent", () => {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const today = new Date("2026-10-18");
    // A : 300 j avant aujourd'hui (hors fenêtre récente, poids 1) ; B : 100 j avant (poids 2) ;
    // C : aujourd'hui (poids 2). Segment récent B→C quasi plat (1 km/j) contre 50 km/j sur A→B.
    const result = computeAvgKmPerDay(
      [
        { mileage: 0, readAt: new Date(today.getTime() - 300 * MS_PER_DAY) },
        { mileage: 10000, readAt: new Date(today.getTime() - 100 * MS_PER_DAY) },
        { mileage: 10100, readAt: today },
      ],
      "PRIVATE",
      today,
    );
    expect(result.source).toBe("REGRESSION");
    // pente pondérée (B,C en poids 2) : 33,67 km/j, contre 36,0 km/j à poids égal — tirée vers le bas.
    expect(result.avgKmPerDay).toBeCloseTo(33.67, 1);
  });

  it("borne le résultat à [0 ; 800]", () => {
    const result = computeAvgKmPerDay(
      [
        { mileage: 0, readAt: new Date("2026-10-01") },
        { mileage: 50000, readAt: new Date("2026-10-15") },
      ],
      "TAXI",
      new Date("2026-10-15"),
    );
    expect(result.avgKmPerDay).toBe(800);
  });

  it("écarte les relevés marqués aberrants", () => {
    const result = computeAvgKmPerDay(
      [
        { mileage: 10000, readAt: new Date("2026-09-01") },
        { mileage: 999999, readAt: new Date("2026-09-15"), isOutlier: true },
        { mileage: 10700, readAt: new Date("2026-10-15") },
      ],
      "PRIVATE",
      new Date("2026-10-15"),
    );
    expect(result.source).toBe("REGRESSION");
    expect(result.avgKmPerDay).toBeCloseTo(700 / 44, 1);
  });

  it("utilise km / âge pour un relevé unique si le véhicule a ≥ 180 j", () => {
    const result = computeAvgKmPerDay(
      [{ mileage: 36500, readAt: new Date("2026-10-18") }],
      "PRIVATE",
      new Date("2026-10-18"),
      new Date("2025-10-19"), // 364 jours
    );
    expect(result.source).toBe("SINGLE_READING");
    expect(result.avgKmPerDay).toBeCloseTo(100, 0);
  });

  it.each(["PRIVATE", "TAXI", "TRANSPORT", "UTILITY", "RENTAL"] as const)(
    "valeur par défaut pour usage %s sans aucun relevé",
    (usage) => {
      const result = computeAvgKmPerDay([], usage, new Date("2026-10-18"));
      expect(result).toEqual({ avgKmPerDay: DEFAULT_AVG_KM_PER_DAY[usage], source: "DEFAULT" });
    },
  );
});

describe("estimateMileage — RG-M02-11", () => {
  it("ajoute le kilométrage moyen écoulé depuis le dernier relevé", () => {
    const estimated = estimateMileage(48200, 47.5, new Date("2026-10-18"), new Date("2026-11-07"));
    expect(estimated).toBe(48200 + Math.round(47.5 * 20));
  });

  it("intègre l'offset du compteur remplacé (RG-M02-09)", () => {
    const estimated = estimateMileage(
      1000,
      10,
      new Date("2026-10-18"),
      new Date("2026-10-18"),
      50000,
    );
    expect(estimated).toBe(51000);
  });
});
