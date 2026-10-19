import { describe, expect, it } from "vitest";
import { computeInspectionStatus, computeServiceStatus } from "./status";

const today = new Date("2026-10-18T00:00:00.000Z");
const addDays = (n: number) => new Date(today.getTime() + n * 24 * 60 * 60 * 1000);

describe("computeInspectionStatus — RG-M02-12, bornes J-31/J-30/J0/J+1", () => {
  it("J-31 (31 j restants) → OK", () => {
    expect(computeInspectionStatus({ expiryDate: addDays(31), today })).toBe("OK");
  });
  it("J-30 (30 j restants) → DUE_SOON", () => {
    expect(computeInspectionStatus({ expiryDate: addDays(30), today })).toBe("DUE_SOON");
  });
  it("J0 (expire aujourd'hui) → DUE_SOON", () => {
    expect(computeInspectionStatus({ expiryDate: addDays(0), today })).toBe("DUE_SOON");
  });
  it("J+1 (expirée depuis 1 j) → EXPIRED", () => {
    expect(computeInspectionStatus({ expiryDate: addDays(-1), today })).toBe("EXPIRED");
  });
  it("pas de date → UNKNOWN", () => {
    expect(computeInspectionStatus({ expiryDate: null, today })).toBe("UNKNOWN");
  });
});

describe("computeServiceStatus — section 5, bornes 30 j / 1 000 km", () => {
  it("31 j restants, pas de km → OK", () => {
    expect(
      computeServiceStatus({
        nextServiceDueDate: addDays(31),
        nextServiceDueMileage: null,
        currentMileage: null,
        today,
      }),
    ).toBe("OK");
  });

  it("30 j restants → DUE_SOON", () => {
    expect(
      computeServiceStatus({
        nextServiceDueDate: addDays(30),
        nextServiceDueMileage: null,
        currentMileage: null,
        today,
      }),
    ).toBe("DUE_SOON");
  });

  it("date dépassée → OVERDUE", () => {
    expect(
      computeServiceStatus({
        nextServiceDueDate: addDays(-1),
        nextServiceDueMileage: null,
        currentMileage: null,
        today,
      }),
    ).toBe("OVERDUE");
  });

  it("1 001 km restants → OK, 1 000 km restants → DUE_SOON, 0 km restant → OVERDUE", () => {
    expect(
      computeServiceStatus({
        nextServiceDueDate: null,
        nextServiceDueMileage: 50000,
        currentMileage: 48999,
        today,
      }),
    ).toBe("OK");
    expect(
      computeServiceStatus({
        nextServiceDueDate: null,
        nextServiceDueMileage: 50000,
        currentMileage: 49000,
        today,
      }),
    ).toBe("DUE_SOON");
    expect(
      computeServiceStatus({
        nextServiceDueDate: null,
        nextServiceDueMileage: 50000,
        currentMileage: 50000,
        today,
      }),
    ).toBe("OVERDUE");
  });

  it("aucune donnée → UNKNOWN", () => {
    expect(
      computeServiceStatus({
        nextServiceDueDate: null,
        nextServiceDueMileage: null,
        currentMileage: null,
        today,
      }),
    ).toBe("UNKNOWN");
  });
});
