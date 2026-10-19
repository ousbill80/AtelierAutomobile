import { describe, expect, it } from "vitest";
import { priorityOf } from "./priority";

describe("priorityOf — RG-M10-16", () => {
  it("APPOINTMENT et VEHICLE_READY sont hors plafond (priorité 0)", () => {
    expect(priorityOf("APPOINTMENT", { key: "CONFIRM", offsetDays: 0 })).toBe(0);
    expect(priorityOf("VEHICLE_READY", { key: "J0", offsetDays: 0 })).toBe(0);
  });

  it("RECEIVABLE : paliers ≥ J+30 et promesse rompue en priorité 1, les autres en 3", () => {
    expect(priorityOf("RECEIVABLE", { key: "J+30", offsetDays: 30 })).toBe(1);
    expect(priorityOf("RECEIVABLE", { key: "J+60", offsetDays: 60 })).toBe(1);
    expect(
      priorityOf("RECEIVABLE", { key: "J+15", offsetDays: 15 }, { isPromiseBroken: true }),
    ).toBe(1);
    expect(priorityOf("RECEIVABLE", { key: "J+3", offsetDays: 3 })).toBe(3);
  });

  it("INSPECTION : J0 et J+7 en priorité 2, les autres en 4", () => {
    expect(priorityOf("INSPECTION", { key: "J0", offsetDays: 0 })).toBe(2);
    expect(priorityOf("INSPECTION", { key: "J+7", offsetDays: 7 })).toBe(2);
    expect(priorityOf("INSPECTION", { key: "J-30", offsetDays: -30 })).toBe(4);
  });

  it("QUOTE_FOLLOWUP (4), SERVICE (5), INSURANCE_EXPIRY (6), SATISFACTION (7)", () => {
    expect(priorityOf("QUOTE_FOLLOWUP", { key: "J+2", offsetDays: 2 })).toBe(4);
    expect(priorityOf("SERVICE", { key: "J0", offsetDays: 0 })).toBe(5);
    expect(priorityOf("INSURANCE_EXPIRY", { key: "J-15", offsetDays: -15 })).toBe(6);
    expect(priorityOf("SATISFACTION", { key: "J+2", offsetDays: 2 })).toBe(7);
  });
});
