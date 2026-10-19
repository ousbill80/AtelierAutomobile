import { describe, expect, it } from "vitest";
import {
  computeAvgKmPerDay,
  computeEstimatedMileage,
  DEFAULT_AVG_KM_PER_DAY,
  type VehicleUsage,
} from "./mileage";

const day = (n: number, from = new Date("2026-01-01T00:00:00.000Z")) =>
  new Date(from.getTime() + n * 24 * 60 * 60 * 1000);

describe("computeAvgKmPerDay — RG-M02-10", () => {
  it("moins de 2 relevés → valeur par défaut selon l'usage", () => {
    const now = day(400);
    expect(
      computeAvgKmPerDay({
        readings: [{ mileage: 10000, readAt: day(390) }],
        usage: "PRIVATE",
        now,
      }),
    ).toEqual({ avgKmPerDay: DEFAULT_AVG_KM_PER_DAY.PRIVATE, source: "DEFAULT" });

    expect(computeAvgKmPerDay({ readings: [], usage: "TAXI", now })).toEqual({
      avgKmPerDay: DEFAULT_AVG_KM_PER_DAY.TAXI,
      source: "DEFAULT",
    });
  });

  it("2 relevés espacés de moins de 14 jours → pas de régression, valeur par défaut", () => {
    const now = day(20);
    const readings = [
      { mileage: 10000, readAt: day(10) },
      { mileage: 10500, readAt: day(15) },
    ];
    expect(computeAvgKmPerDay({ readings, usage: "UTILITY", now })).toEqual({
      avgKmPerDay: DEFAULT_AVG_KM_PER_DAY.UTILITY,
      source: "DEFAULT",
    });
  });

  it("exemple RG-M02-13 : 42 500 km (20/06/2026) puis 48 200 km (18/10/2026) → 47,5 km/j", () => {
    const now = new Date("2026-10-18T00:00:00.000Z");
    const readings = [
      { mileage: 42500, readAt: new Date("2026-06-20T00:00:00.000Z") },
      { mileage: 48200, readAt: now },
    ];
    const result = computeAvgKmPerDay({ readings, usage: "PRIVATE", now });
    expect(result.source).toBe("REGRESSION");
    expect(result.avgKmPerDay).toBeCloseTo(47.5, 5);
  });

  it("pondération ×2 des relevés des 6 derniers mois", () => {
    const now = day(380);
    const readings = [
      { mileage: 0, readAt: day(0) }, // > 6 mois : poids 1
      { mileage: 20000, readAt: day(200) }, // ≤ 6 mois : poids 2
      { mileage: 58000, readAt: day(380) }, // ≤ 6 mois : poids 2
    ];
    const result = computeAvgKmPerDay({ readings, usage: "PRIVATE", now });
    expect(result.source).toBe("REGRESSION");
    // Pente pondérée attendue (calcul manuel du système d'équations normales) : ≈ 159,39 km/j,
    // plus proche de la pente récente (211,1 km/j) que de la pente ancienne (100 km/j).
    expect(result.avgKmPerDay).toBeCloseTo(159.39, 1);
  });

  it("résultat borné à [0 ; 800] km/j", () => {
    const now = day(20);
    const extreme = [
      { mileage: 0, readAt: day(0) },
      { mileage: 50000, readAt: day(20) },
    ];
    expect(computeAvgKmPerDay({ readings: extreme, usage: "TRANSPORT", now }).avgKmPerDay).toBe(
      800,
    );

    const reversed = [
      { mileage: 50000, readAt: day(0) },
      { mileage: 0, readAt: day(20) },
    ];
    expect(computeAvgKmPerDay({ readings: reversed, usage: "TRANSPORT", now }).avgKmPerDay).toBe(0);
  });

  it.each<[VehicleUsage, number]>([
    ["PRIVATE", 35],
    ["TAXI", 220],
    ["TRANSPORT", 250],
    ["UTILITY", 90],
    ["RENTAL", 120],
  ])("valeur par défaut pour %s : %d km/j", (usage, expected) => {
    expect(computeAvgKmPerDay({ readings: [], usage, now: day(0) }).avgKmPerDay).toBe(expected);
  });

  it("un seul relevé + mise en circulation connue (≥ 180 j) → km / jours écoulés", () => {
    const now = day(400);
    const result = computeAvgKmPerDay({
      readings: [{ mileage: 36500, readAt: now }],
      usage: "PRIVATE",
      now,
      firstRegistrationDate: day(0),
    });
    expect(result).toEqual({ avgKmPerDay: 36500 / 400, source: "SINGLE_READING" });
  });

  it("un seul relevé mais véhicule trop récent (< 180 j) → valeur par défaut", () => {
    const now = day(100);
    const result = computeAvgKmPerDay({
      readings: [{ mileage: 5000, readAt: now }],
      usage: "PRIVATE",
      now,
      firstRegistrationDate: day(0),
    });
    expect(result).toEqual({ avgKmPerDay: DEFAULT_AVG_KM_PER_DAY.PRIVATE, source: "DEFAULT" });
  });

  it("exclut les relevés marqués aberrants (isOutlier)", () => {
    const now = day(40);
    const readings = [
      { mileage: 1000, readAt: day(0) },
      { mileage: 999999, readAt: day(20), isOutlier: true },
      { mileage: 2200, readAt: day(40) },
    ];
    const result = computeAvgKmPerDay({ readings, usage: "PRIVATE", now });
    expect(result.source).toBe("REGRESSION");
    expect(result.avgKmPerDay).toBeCloseTo(30, 5); // (2200-1000)/40
  });

  it("compteur remplacé : l'appelant doit fournir le kilométrage vie entière (mileage + odometerOffset)", () => {
    // Après un odometer_replaced, odometerOffset absorbe le saut (ancien dernier relevé − nouveau
    // départ). Les relevés passés ici sont déjà « vie entière » : la régression reste cohérente
    // (pente positive stable) au lieu de chuter artificiellement comme le ferait le compteur brut.
    const now = day(60);
    const lifetimeReadings = [
      { mileage: 50000, readAt: day(0) },
      { mileage: 51500, readAt: day(30) },
      { mileage: 53000, readAt: day(60) },
    ];
    const result = computeAvgKmPerDay({ readings: lifetimeReadings, usage: "PRIVATE", now });
    expect(result).toEqual({ avgKmPerDay: 50, source: "REGRESSION" });
  });
});

describe("computeEstimatedMileage — RG-M02-11", () => {
  it("ajoute l'avance estimée depuis le dernier relevé", () => {
    const estimated = computeEstimatedMileage({
      currentMileage: 48200,
      currentMileageAt: new Date("2026-10-18T00:00:00.000Z"),
      avgKmPerDay: 47.5,
      at: new Date("2026-10-28T00:00:00.000Z"),
    });
    expect(estimated).toBe(48200 + Math.round(47.5 * 10));
  });

  it("ne recule jamais si la date demandée précède le relevé", () => {
    const estimated = computeEstimatedMileage({
      currentMileage: 48200,
      currentMileageAt: new Date("2026-10-18T00:00:00.000Z"),
      avgKmPerDay: 47.5,
      at: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(estimated).toBe(48200);
  });
});
