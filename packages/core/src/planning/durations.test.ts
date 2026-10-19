import { describe, expect, it } from "vitest";
import {
  defaultDuration,
  formatHoursMinutes,
  isBayCompatible,
  roundUpToQuarterHour,
} from "./durations";

describe("defaultDuration (RG-M03-04)", () => {
  it("renvoie la durée du type sans opération", () => {
    expect(defaultDuration({ type: "SERVICE" })).toBe(90);
    expect(defaultDuration({ type: "BODYWORK" })).toBe(30);
  });

  it("somme les standardHours arrondie au quart d'heure : 0,5 + 1 + 0,75 = 2 h 15", () => {
    expect(
      defaultDuration({
        type: "SERVICE",
        laborOperations: [{ standardHours: 0.5 }, { standardHours: 1 }, { standardHours: 0.75 }],
      }),
    ).toBe(135);
  });

  it("ne descend jamais sous la durée du type", () => {
    expect(defaultDuration({ type: "REPAIR", laborOperations: [{ standardHours: 0.5 }] })).toBe(
      120,
    );
  });

  it("utilise les durées configurées par site", () => {
    expect(defaultDuration({ type: "SERVICE", durations: { SERVICE: 75 } })).toBe(75);
  });
});

describe("roundUpToQuarterHour / formatHoursMinutes", () => {
  it("arrondit vers le haut", () => {
    expect(roundUpToQuarterHour(130)).toBe(135);
    expect(roundUpToQuarterHour(135)).toBe(135);
    expect(roundUpToQuarterHour(0)).toBe(0);
  });
  it("formate « 15 h 18 », « 14 h »", () => {
    expect(formatHoursMinutes(918)).toBe("15 h 18");
    expect(formatHoursMinutes(840)).toBe("14 h");
    expect(formatHoursMinutes(390)).toBe("6 h 30");
  });
});

describe("isBayCompatible", () => {
  it("DIAGNOSTIC exige un pont DIAGNOSTIC, OTHER accepte tout", () => {
    expect(isBayCompatible("DIAGNOSTIC", "LIFT")).toBe(false);
    expect(isBayCompatible("DIAGNOSTIC", "DIAGNOSTIC")).toBe(true);
    expect(isBayCompatible("OTHER", "WASH")).toBe(true);
    expect(isBayCompatible("INSPECTION_PREP", "DIAGNOSTIC")).toBe(true);
  });
});
