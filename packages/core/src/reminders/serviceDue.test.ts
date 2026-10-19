import { describe, expect, it } from "vitest";
import { computeNextServiceDue } from "./serviceDue";

describe("computeNextServiceDue — RG-M02-13", () => {
  it("exemple du PRD : le kilométrage l'emporte sur la date (25/11/2026 avant le 15/04/2027)", () => {
    const result = computeNextServiceDue({
      lastServiceDate: new Date("2026-04-15T00:00:00.000Z"),
      lastServiceMileage: 40000,
      serviceIntervalKm: 10000,
      serviceIntervalMonths: 12,
      currentMileage: 48200,
      currentMileageAt: new Date("2026-10-18T00:00:00.000Z"),
      avgKmPerDay: 47.5,
      today: new Date("2026-10-18T00:00:00.000Z"),
    });
    expect(result.trigger).toBe("MILEAGE");
    expect(result.nextServiceDueMileage).toBe(50000);
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-11-25");
  });

  it("date seule connue (pas de kilométrage) → trigger DATE", () => {
    const result = computeNextServiceDue({
      lastServiceDate: new Date("2026-01-01T00:00:00.000Z"),
      serviceIntervalMonths: 12,
      today: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(result.trigger).toBe("DATE");
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(result.nextServiceDueMileage).toBeNull();
  });

  it("kilométrage seul connu (pas de dernière date de révision) → trigger MILEAGE", () => {
    const result = computeNextServiceDue({
      lastServiceMileage: 40000,
      serviceIntervalKm: 10000,
      currentMileage: 45000,
      currentMileageAt: new Date("2026-06-01T00:00:00.000Z"),
      avgKmPerDay: 50,
      today: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(result.trigger).toBe("MILEAGE");
    expect(result.nextServiceDueMileage).toBe(50000);
    // (50000-45000)/50 = 100 jours
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-09-09");
  });

  it("la date gagne quand elle est atteinte avant le km", () => {
    const result = computeNextServiceDue({
      lastServiceDate: new Date("2026-01-01T00:00:00.000Z"),
      lastServiceMileage: 10000,
      serviceIntervalMonths: 1,
      serviceIntervalKm: 100000,
      currentMileage: 10500,
      currentMileageAt: new Date("2026-01-01T00:00:00.000Z"),
      avgKmPerDay: 10,
      today: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.trigger).toBe("DATE");
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-02-01");
  });

  it("révision dépassée en kilométrage → due aujourd'hui", () => {
    const today = new Date("2026-06-01T00:00:00.000Z");
    const result = computeNextServiceDue({
      lastServiceMileage: 10000,
      serviceIntervalKm: 10000,
      currentMileage: 21000,
      currentMileageAt: today,
      avgKmPerDay: 50,
      today,
    });
    expect(result.trigger).toBe("MILEAGE");
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("données manquantes → tout est null", () => {
    const result = computeNextServiceDue({ today: new Date("2026-06-01T00:00:00.000Z") });
    expect(result).toEqual({
      nextServiceDueDate: null,
      nextServiceDueMileage: null,
      trigger: null,
    });
  });

  it("avgKmPerDay = 0 désactive le critère kilométrique (pas de division par zéro)", () => {
    const result = computeNextServiceDue({
      lastServiceMileage: 40000,
      serviceIntervalKm: 10000,
      currentMileage: 45000,
      currentMileageAt: new Date("2026-06-01T00:00:00.000Z"),
      avgKmPerDay: 0,
      today: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(result).toEqual({
      nextServiceDueDate: null,
      nextServiceDueMileage: 50000,
      trigger: null,
    });
  });
});
