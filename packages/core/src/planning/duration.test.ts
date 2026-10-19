import { describe, expect, it } from "vitest";
import { DEFAULT_APPOINTMENT_DURATIONS, defaultDuration } from "./duration";

describe("defaultDuration (RG-M03-04)", () => {
  it("renvoie la durée par défaut du type sans opérations connues", () => {
    expect(defaultDuration("SERVICE")).toBe(90);
    expect(defaultDuration("DIAGNOSTIC")).toBe(60);
  });

  it("exemple du PRD : vidange (0,5 h) + plaquettes (1 h) + géométrie (0,75 h) = 135 min", () => {
    expect(defaultDuration("REPAIR", DEFAULT_APPOINTMENT_DURATIONS, [0.5, 1, 0.75])).toBe(135);
  });

  it("arrondit au quart d'heure supérieur", () => {
    expect(defaultDuration("OTHER", DEFAULT_APPOINTMENT_DURATIONS, [1.1])).toBe(75); // 66 min → 75
  });

  it("ne descend jamais sous la durée minimum du type", () => {
    expect(defaultDuration("SERVICE", DEFAULT_APPOINTMENT_DURATIONS, [0.25])).toBe(90);
  });
});
