import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPOINTMENT_SETTINGS,
  resolveAppointmentSettings,
  resolvePlanningSettings,
} from "./settings";

describe("resolveAppointmentSettings / resolvePlanningSettings (M03 §6)", () => {
  it("renvoie les défauts pour des réglages vides ou invalides", () => {
    expect(resolveAppointmentSettings({})).toEqual(DEFAULT_APPOINTMENT_SETTINGS);
    expect(resolveAppointmentSettings(null)).toEqual(DEFAULT_APPOINTMENT_SETTINGS);
    expect(
      resolveAppointmentSettings({
        appointments: { durations: { SERVICE: "x", REPAIR: 5 }, noShowJobTime: "25:00" },
      }).durations,
    ).toEqual(DEFAULT_APPOINTMENT_SETTINGS.durations);
    expect(
      resolvePlanningSettings({
        planning: { productivityRate: 3, lunchBreak: ["13:00", "12:00"] },
      }),
    ).toEqual({ productivityRate: 0.85, lunchBreak: null });
  });

  it("fusionne les surcharges valides", () => {
    const settings = resolveAppointmentSettings({
      appointments: {
        durations: { SERVICE: 75 },
        portalTypes: ["SERVICE", "BOGUS"],
        maxAppointmentsPerHalfDay: 6,
        autoAssignBay: true,
      },
    });
    expect(settings.durations.SERVICE).toBe(75);
    expect(settings.durations.REPAIR).toBe(120);
    expect(settings.portalTypes).toEqual(["SERVICE"]);
    expect(settings.maxAppointmentsPerHalfDay).toBe(6);
    expect(settings.autoAssignBay).toBe(true);
    expect(
      resolvePlanningSettings({
        planning: { productivityRate: 0.9, lunchBreak: ["12:30", "13:30"] },
      }),
    ).toEqual({ productivityRate: 0.9, lunchBreak: ["12:30", "13:30"] });
  });
});
