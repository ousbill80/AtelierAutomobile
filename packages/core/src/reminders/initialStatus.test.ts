import { describe, expect, it } from "vitest";
import { initialStatus, type InitialStatusInput } from "./initialStatus";

const BASE: InitialStatusInput = {
  step: { internalOnly: false, autoSend: true },
  catchUp: false,
  isFirstRunOfRule: false,
  approvalMode: "PER_STEP",
  inWarmup: false,
  isReceivable: false,
  operatingMode: "FULL",
  dataAgeHours: null,
  maxDataAgeHours: 48,
};

describe("initialStatus — RG-M10-18 / RG-M10-29", () => {
  it("palier interne (alerte gérant) : directement SENT", () => {
    expect(initialStatus({ ...BASE, step: { ...BASE.step, internalOnly: true } })).toBe("SENT");
  });

  it("MANUAL_ALL impose NEEDS_APPROVAL même si autoSend", () => {
    expect(initialStatus({ ...BASE, approvalMode: "MANUAL_ALL" })).toBe("NEEDS_APPROVAL");
  });

  it("rodage (14 j) impose NEEDS_APPROVAL", () => {
    expect(initialStatus({ ...BASE, inWarmup: true })).toBe("NEEDS_APPROVAL");
  });

  it("premier passage de la règle + rattrapage → NEEDS_APPROVAL", () => {
    expect(initialStatus({ ...BASE, catchUp: true, isFirstRunOfRule: true })).toBe(
      "NEEDS_APPROVAL",
    );
  });

  it("rattrapage hors premier passage de règle : suit autoSend normalement", () => {
    expect(initialStatus({ ...BASE, catchUp: true, isFirstRunOfRule: false })).toBe("PLANNED");
  });

  it("requiresPermission impose toujours NEEDS_APPROVAL", () => {
    expect(
      initialStatus({
        ...BASE,
        step: { ...BASE.step, requiresPermission: "receivable:formal_notice" },
      }),
    ).toBe("NEEDS_APPROVAL");
  });

  it("REMINDERS_ONLY + créance + données trop anciennes → NEEDS_APPROVAL", () => {
    expect(
      initialStatus({
        ...BASE,
        isReceivable: true,
        operatingMode: "REMINDERS_ONLY",
        dataAgeHours: 72,
        maxDataAgeHours: 48,
      }),
    ).toBe("NEEDS_APPROVAL");
  });

  it("REMINDERS_ONLY + créance mais données fraîches : suit autoSend", () => {
    expect(
      initialStatus({
        ...BASE,
        isReceivable: true,
        operatingMode: "REMINDERS_ONLY",
        dataAgeHours: 10,
        maxDataAgeHours: 48,
      }),
    ).toBe("PLANNED");
  });

  it("autoSend=false sans autre condition → NEEDS_APPROVAL", () => {
    expect(initialStatus({ ...BASE, step: { ...BASE.step, autoSend: false } })).toBe(
      "NEEDS_APPROVAL",
    );
  });
});
