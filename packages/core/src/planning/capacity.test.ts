import { describe, expect, it } from "vitest";
import { computeCapacity } from "./capacity";

describe("computeCapacity (RG-M03-05)", () => {
  it("exemple du PRD : 3 mécaniciens × 6 h × 0,85 = 15,3 h ; 12 h déjà réservées, 2 h acceptées", () => {
    const result = computeCapacity({
      mechanicHoursAvailable: [6, 6, 6],
      existingLoadMinutes: 12 * 60,
      existingAppointmentsCount: 6,
      activeBaysCount: 3,
      maxAppointmentsPerHalfDay: 99, // isole la règle de capacité horaire testée ici
      candidateDurationMinutes: 2 * 60,
    });
    expect(result.capacityMinutes).toBe(918); // 15 h 18
    expect(result.loadAfterMinutes).toBe(14 * 60);
    expect(result.accepted).toBe(true);
  });

  it("refuse le second RDV de 2 h (16 h > 15,3 h)", () => {
    const result = computeCapacity({
      mechanicHoursAvailable: [6, 6, 6],
      existingLoadMinutes: 14 * 60, // après acceptation du premier RDV
      existingAppointmentsCount: 7,
      activeBaysCount: 3,
      maxAppointmentsPerHalfDay: 99,
      candidateDurationMinutes: 2 * 60,
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("CAPACITY_EXCEEDED");
  });

  it("refuse au-delà du nombre maximum de RDV par demi-journée (défaut ponts actifs × 2)", () => {
    const result = computeCapacity({
      mechanicHoursAvailable: [8, 8],
      existingLoadMinutes: 0,
      existingAppointmentsCount: 4, // défaut = 2 ponts × 2 = 4, déjà atteint
      activeBaysCount: 2,
      candidateDurationMinutes: 30,
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("MAX_APPOINTMENTS_REACHED");
  });

  it("une simple lecture (sans candidat) ne déclenche jamais MAX_APPOINTMENTS_REACHED", () => {
    const result = computeCapacity({
      mechanicHoursAvailable: [8],
      existingLoadMinutes: 0,
      existingAppointmentsCount: 10,
      activeBaysCount: 1,
    });
    expect(result.accepted).toBe(true);
  });

  it("respecte un maxAppointmentsPerHalfDay explicite plutôt que le défaut", () => {
    const result = computeCapacity({
      mechanicHoursAvailable: [8, 8, 8],
      existingLoadMinutes: 0,
      existingAppointmentsCount: 2,
      activeBaysCount: 3,
      maxAppointmentsPerHalfDay: 2,
      candidateDurationMinutes: 30,
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("MAX_APPOINTMENTS_REACHED");
  });
});
