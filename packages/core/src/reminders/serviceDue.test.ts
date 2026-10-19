import { describe, expect, it } from "vitest";
import { computeNextServiceDue } from "./serviceDue";

describe("computeNextServiceDue — RG-M02-13", () => {
  it("exemple du PRD : le km gagne (25/11/2026) malgré une date plus lointaine (15/04/2027)", () => {
    const result = computeNextServiceDue({
      lastServiceDate: new Date("2026-04-15"),
      lastServiceMileage: 40000,
      serviceIntervalKm: 10000,
      serviceIntervalMonths: 12,
      currentMileage: 48200,
      currentMileageAt: new Date("2026-10-18"),
      avgKmPerDay: 47.5,
      today: new Date("2026-10-18"),
    });
    expect(result.trigger).toBe("MILEAGE");
    expect(result.nextServiceDueMileage).toBe(50000);
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-11-25");
    expect(result.overdue).toBe(false);
  });

  it("date seule connue", () => {
    const result = computeNextServiceDue({
      lastServiceDate: new Date("2026-01-15"),
      serviceIntervalMonths: 6,
      today: new Date("2026-10-18"),
    });
    expect(result.trigger).toBe("DATE");
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(result.nextServiceDueMileage).toBeNull();
    expect(result.overdue).toBe(true);
  });

  it("date et km connus : la date gagne quand elle est la plus proche", () => {
    const result = computeNextServiceDue({
      lastServiceDate: new Date("2026-10-01"),
      serviceIntervalMonths: 1,
      lastServiceMileage: 40000,
      serviceIntervalKm: 100000,
      currentMileage: 41000,
      currentMileageAt: new Date("2026-10-18"),
      avgKmPerDay: 10,
      today: new Date("2026-10-18"),
    });
    expect(result.trigger).toBe("DATE");
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("dépassée : le kilométrage estimé du jour a déjà atteint le seuil", () => {
    const result = computeNextServiceDue({
      lastServiceMileage: 10000,
      serviceIntervalKm: 5000,
      currentMileage: 16000,
      currentMileageAt: new Date("2026-10-01"),
      avgKmPerDay: 20,
      today: new Date("2026-10-18"),
    });
    expect(result.trigger).toBe("MILEAGE");
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2026-10-18");
    expect(result.overdue).toBe(true);
  });

  it("données manquantes → tout null", () => {
    const result = computeNextServiceDue({ today: new Date("2026-10-18") });
    expect(result).toEqual({
      nextServiceDueDate: null,
      nextServiceDueMileage: null,
      trigger: null,
      overdue: false,
    });
  });

  it("avgKmPerDay = 0 : le critère km est ignoré (pas de division par zéro)", () => {
    const result = computeNextServiceDue({
      lastServiceMileage: 10000,
      serviceIntervalKm: 5000,
      currentMileage: 12000,
      currentMileageAt: new Date("2026-10-01"),
      avgKmPerDay: 0,
      lastServiceDate: new Date("2026-01-01"),
      serviceIntervalMonths: 12,
      today: new Date("2026-10-18"),
    });
    expect(result.trigger).toBe("DATE");
    expect(result.nextServiceDueDate?.toISOString().slice(0, 10)).toBe("2027-01-01");
  });
});
