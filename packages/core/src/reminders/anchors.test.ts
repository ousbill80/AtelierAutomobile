import { describe, expect, it } from "vitest";
import {
  assertNoDuplicatePlate,
  computeServiceDue,
  estimateAvgKmPerDay,
  estimateInspectionExpiry,
  isEligible,
  isInspectionDateSuspect,
  isWithinCandidateWindow,
  resolveServiceInterval,
  type MileageReading,
} from "./anchors";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("isWithinCandidateWindow", () => {
  const today = d("2026-10-18");

  it("INSPECTION : accepte [aujourd'hui-60j ; aujourd'hui+45j]", () => {
    expect(isWithinCandidateWindow("INSPECTION", d("2026-08-19"), today)).toBe(true); // -60j
    expect(isWithinCandidateWindow("INSPECTION", d("2026-08-18"), today)).toBe(false); // -61j
    expect(isWithinCandidateWindow("INSPECTION", d("2026-12-02"), today)).toBe(true); // +45j
    expect(isWithinCandidateWindow("INSPECTION", d("2026-12-03"), today)).toBe(false); // +46j
  });

  it("SERVICE : accepte [aujourd'hui-90j ; aujourd'hui+30j]", () => {
    expect(isWithinCandidateWindow("SERVICE", d("2026-07-20"), today)).toBe(true); // -90j
    expect(isWithinCandidateWindow("SERVICE", d("2026-07-19"), today)).toBe(false);
    expect(isWithinCandidateWindow("SERVICE", d("2026-11-17"), today)).toBe(true); // +30j
    expect(isWithinCandidateWindow("SERVICE", d("2026-11-18"), today)).toBe(false);
  });

  it("INSURANCE_EXPIRY : accepte [aujourd'hui ; aujourd'hui+30j], jamais avant aujourd'hui", () => {
    expect(isWithinCandidateWindow("INSURANCE_EXPIRY", d("2026-10-17"), today)).toBe(false);
    expect(isWithinCandidateWindow("INSURANCE_EXPIRY", today, today)).toBe(true);
    expect(isWithinCandidateWindow("INSURANCE_EXPIRY", d("2026-11-17"), today)).toBe(true);
    expect(isWithinCandidateWindow("INSURANCE_EXPIRY", d("2026-11-18"), today)).toBe(false);
  });

  it("les types pilotés par statut (RECEIVABLE, APPOINTMENT…) ne sont jamais exclus par la fenêtre", () => {
    expect(isWithinCandidateWindow("RECEIVABLE", d("2020-01-01"), today)).toBe(true);
    expect(isWithinCandidateWindow("APPOINTMENT", d("2030-01-01"), today)).toBe(true);
  });
});

describe("estimateAvgKmPerDay", () => {
  const now = d("2026-10-18");

  it("retourne null avec moins de 2 relevés valides", () => {
    const readings: MileageReading[] = [{ date: d("2026-09-01"), mileage: 10000 }];
    expect(estimateAvgKmPerDay(readings, now)).toBeNull();
  });

  it("retourne null si l'écart entre le premier et le dernier relevé retenu est < 30 j", () => {
    const readings: MileageReading[] = [
      { date: d("2026-10-01"), mileage: 10000 },
      { date: d("2026-10-10"), mileage: 10500 },
    ];
    expect(estimateAvgKmPerDay(readings, now)).toBeNull();
  });

  it("ignore les relevés décroissants (compteur changé / erreur de saisie)", () => {
    const readings: MileageReading[] = [
      { date: d("2026-08-01"), mileage: 10000 },
      { date: d("2026-09-01"), mileage: 500 }, // erreur, ignoré
      { date: d("2026-10-01"), mileage: 12000 },
    ];
    // Retenus : 01/08 (10000) → 01/10 (12000) = 61 j, pente = 2000/61 ≈ 32.8
    const result = estimateAvgKmPerDay(readings, now);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(2000 / 61, 2);
  });

  it("borne la pente à 5 km/j minimum", () => {
    const readings: MileageReading[] = [
      { date: d("2026-06-01"), mileage: 10000 },
      { date: d("2026-10-01"), mileage: 10050 }, // ~0,4 km/j
    ];
    expect(estimateAvgKmPerDay(readings, now)).toBe(5);
  });

  it("borne la pente à 300 km/j maximum", () => {
    const readings: MileageReading[] = [
      { date: d("2026-09-01"), mileage: 10000 },
      { date: d("2026-10-01"), mileage: 40000 }, // 1000 km/j
    ];
    expect(estimateAvgKmPerDay(readings, now)).toBe(300);
  });

  it("ignore les relevés hors fenêtre de 365 j", () => {
    const readings: MileageReading[] = [
      { date: d("2024-01-01"), mileage: 1000 }, // trop ancien
      { date: d("2026-09-01"), mileage: 10000 },
      { date: d("2026-10-01"), mileage: 10930 }, // pente ~31 km/j
    ];
    const result = estimateAvgKmPerDay(readings, now);
    expect(result).toBeCloseTo(930 / 30, 2);
  });
});

describe("computeServiceDue", () => {
  it("exemple US-M10-04 (Mme Bamba, 70 km/j) : l'échéance km (31/08/2026) gagne sur la date (10/10/2026)", () => {
    const result = computeServiceDue({
      lastServiceDate: d("2026-04-10"),
      lastServiceMileage: 14500,
      serviceIntervalMonths: 6,
      serviceIntervalKm: 10000,
      refDate: d("2026-04-10"),
      refMileage: 14500,
      avgKmPerDay: 70,
    });
    expect(result.nextServiceDueMileage).toBe(24500);
    expect(result.basis).toBe("km");
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(result.incomplete).toBe(false);
  });

  it("exemple RG-M10-08 « date d'abord » (45 km/j) : la date (10/10/2026) gagne sur le km (19/11/2026)", () => {
    const result = computeServiceDue({
      lastServiceDate: d("2026-04-10"),
      lastServiceMileage: 14500,
      serviceIntervalMonths: 6,
      serviceIntervalKm: 10000,
      refDate: d("2026-04-10"),
      refMileage: 14500,
      avgKmPerDay: 45,
    });
    expect(result.basis).toBe("date");
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-10-10");
  });

  it("sans pente fiable (avgKmPerDay = null) : seule l'échéance date est utilisée", () => {
    const result = computeServiceDue({
      lastServiceDate: d("2026-04-10"),
      lastServiceMileage: 14500,
      serviceIntervalMonths: 6,
      serviceIntervalKm: 10000,
      refDate: d("2026-04-10"),
      refMileage: 14500,
      avgKmPerDay: null,
    });
    expect(result.basis).toBe("date");
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-10-10");
  });

  it("kilométrage jamais relevé : révision sur la date seule", () => {
    const result = computeServiceDue({
      lastServiceDate: d("2026-04-10"),
      lastServiceMileage: null,
      serviceIntervalMonths: 6,
      serviceIntervalKm: 10000,
      refDate: null,
      refMileage: null,
      avgKmPerDay: null,
    });
    expect(result.basis).toBe("date");
    expect(result.incomplete).toBe(false);
  });

  it("aucune base disponible : incomplete = true, pas de relance", () => {
    const result = computeServiceDue({
      lastServiceDate: null,
      lastServiceMileage: null,
      serviceIntervalMonths: null,
      serviceIntervalKm: null,
      refDate: null,
      refMileage: null,
      avgKmPerDay: null,
    });
    expect(result.nextServiceDueDate).toBeNull();
    expect(result.incomplete).toBe(true);
  });
});

describe("resolveServiceInterval", () => {
  const orgDefaults = { months: 6, km: 10000 };

  it("utilise les valeurs du véhicule si présentes", () => {
    const result = resolveServiceInterval(
      { serviceIntervalMonths: 12, serviceIntervalKm: 15000, fuelType: "diesel" },
      orgDefaults,
    );
    expect(result).toEqual({ months: 12, km: 15000 });
  });

  it("retombe sur la surcharge carburant diesel si le véhicule n'a pas d'intervalle propre", () => {
    const result = resolveServiceInterval({ fuelType: "diesel" }, orgDefaults, {
      diesel: { km: 10000 },
      essence: { km: 7500 },
    });
    expect(result.km).toBe(10000);
  });

  it("retombe sur les défauts organisation sans surcharge carburant", () => {
    const result = resolveServiceInterval({ fuelType: "essence" }, orgDefaults);
    expect(result).toEqual(orgDefaults);
  });
});

describe("isInspectionDateSuspect", () => {
  const now = d("2026-10-18");

  it("signale une expiration à plus de 2 ans", () => {
    expect(
      isInspectionDateSuspect(
        { inspectionExpiryDate: d("2029-01-01"), inspectionLastDate: null },
        now,
      ),
    ).toBe(true);
  });

  it("signale une dernière VT postérieure à l'expiration (jour/mois inversés)", () => {
    expect(
      isInspectionDateSuspect(
        { inspectionExpiryDate: d("2026-02-11"), inspectionLastDate: d("2026-11-02") },
        now,
      ),
    ).toBe(true);
  });

  it("ne signale rien pour des dates cohérentes", () => {
    expect(
      isInspectionDateSuspect(
        { inspectionExpiryDate: d("2026-11-02"), inspectionLastDate: d("2025-11-02") },
        now,
      ),
    ).toBe(false);
  });
});

describe("estimateInspectionExpiry", () => {
  it("ajoute la validité en mois à la dernière VT connue", () => {
    expect(estimateInspectionExpiry(d("2026-01-15"), 12).toISOString().slice(0, 10)).toBe(
      "2027-01-15",
    );
  });
});

describe("isEligible", () => {
  const baseCtx = {
    customerType: "INDIVIDUAL" as const,
    deletedAt: null,
    doNotRemind: false,
    remindersConsent: true,
    isOptedOut: false,
    tags: [] as string[],
  };

  it("client supprimé : jamais éligible, même transactionnel", () => {
    expect(isEligible("APPOINTMENT", { ...baseCtx, deletedAt: d("2026-01-01") })).toBe(false);
  });

  it("doNotRemind bloque les relances non transactionnelles", () => {
    expect(isEligible("INSPECTION", { ...baseCtx, doNotRemind: true })).toBe(false);
  });

  it("doNotRemind n'empêche pas les types transactionnels (APPOINTMENT, VEHICLE_READY)", () => {
    expect(isEligible("APPOINTMENT", { ...baseCtx, doNotRemind: true })).toBe(true);
    expect(isEligible("VEHICLE_READY", { ...baseCtx, remindersConsent: false })).toBe(true);
  });

  it("consentement retiré bloque le non-transactionnel", () => {
    expect(isEligible("SERVICE", { ...baseCtx, remindersConsent: false })).toBe(false);
  });

  it("OptOut bloque le non-transactionnel mais pas le transactionnel", () => {
    expect(isEligible("RECEIVABLE", { ...baseCtx, isOptedOut: true })).toBe(false);
    expect(isEligible("APPOINTMENT", { ...baseCtx, isOptedOut: true })).toBe(true);
  });

  it("montant minimum RECEIVABLE, défaut 2000 FCFA", () => {
    expect(isEligible("RECEIVABLE", { ...baseCtx, amount: 1500 })).toBe(false);
    expect(isEligible("RECEIVABLE", { ...baseCtx, amount: 2000 })).toBe(true);
  });

  it("montant minimum RECEIVABLE personnalisé", () => {
    expect(isEligible("RECEIVABLE", { ...baseCtx, amount: 4000 }, { minAmount: 5000 })).toBe(false);
  });

  it("customerTypes restreint l'éligibilité", () => {
    expect(isEligible("INSPECTION", baseCtx, { customerTypes: ["COMPANY"] })).toBe(false);
    expect(isEligible("INSPECTION", baseCtx, { customerTypes: ["INDIVIDUAL"] })).toBe(true);
  });

  it("tag exclu par défaut (vip-sans-relance)", () => {
    expect(isEligible("INSPECTION", { ...baseCtx, tags: ["vip-sans-relance"] })).toBe(false);
  });

  it("tags à inclure : exige une intersection", () => {
    expect(isEligible("INSPECTION", { ...baseCtx, tags: ["flotte"] }, { tags: ["flotte"] })).toBe(
      true,
    );
    expect(isEligible("INSPECTION", { ...baseCtx, tags: ["autre"] }, { tags: ["flotte"] })).toBe(
      false,
    );
  });

  it("siteIds restreint par site", () => {
    expect(
      isEligible("INSPECTION", { ...baseCtx, siteId: "site-2" }, { siteIds: ["site-1"] }),
    ).toBe(false);
    expect(
      isEligible("INSPECTION", { ...baseCtx, siteId: "site-1" }, { siteIds: ["site-1"] }),
    ).toBe(true);
  });

  it("vehicleMinYear restreint par ancienneté", () => {
    expect(
      isEligible("INSPECTION", { ...baseCtx, vehicleYear: 2010 }, { vehicleMinYear: 2015 }),
    ).toBe(false);
  });
});

describe("assertNoDuplicatePlate", () => {
  it("lève une DomainError si la plaque existe en double", () => {
    expect(() => assertNoDuplicatePlate(2, "2547 GH 01")).toThrow(/en double/);
  });

  it("ne lève rien pour une plaque unique", () => {
    expect(() => assertNoDuplicatePlate(1, "2547 GH 01")).not.toThrow();
  });
});
