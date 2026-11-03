import { describe, expect, it } from "vitest";
import {
  countByDay,
  dayRange,
  dueDayTone,
  monthGrid,
  monthOfDay,
  monthRange,
  shiftMonth,
} from "./dueCalendar";

describe("monthGrid", () => {
  it("novembre 2026 commence un dimanche : 6 cases vides avant le 1er", () => {
    const grid = monthGrid("2026-11");
    expect(grid.weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(grid.weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(grid.weeks.at(-1)).toEqual(["2026-11-30", null, null, null, null, null, null]);
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("février 2027 commence un lundi : pas de case vide au début, 4 semaines pleines", () => {
    const grid = monthGrid("2027-02");
    expect(grid.weeks).toHaveLength(4);
    expect(grid.weeks[0]![0]).toBe("2027-02-01");
    expect(grid.weeks[3]![6]).toBe("2027-02-28");
  });

  it("février bissextile (2028) compte 29 jours", () => {
    expect(monthGrid("2028-02").weeks.flat().filter(Boolean)).toHaveLength(29);
  });

  it("refuse un mois invalide", () => {
    expect(() => monthGrid("2026-13")).toThrow(/Mois invalide/);
    expect(() => monthGrid("2026-1")).toThrow(/Mois invalide/);
  });
});

describe("shiftMonth / monthRange / dayRange / monthOfDay", () => {
  it("passe d'une année à l'autre", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 0)).toBe("2026-11");
  });

  it("bornes du mois : début inclus, mois suivant exclu (UTC)", () => {
    const { from, to } = monthRange("2026-12");
    expect(from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("bornes d'un jour et rejet d'une date impossible", () => {
    const { from, to } = dayRange("2026-02-28");
    expect(from.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(() => dayRange("2026-02-30")).toThrow(/Date invalide/);
    expect(monthOfDay("2026-11-02")).toBe("2026-11");
  });
});

describe("countByDay", () => {
  it("regroupe par jour civil et ignore les dates absentes", () => {
    expect(
      countByDay([
        new Date("2026-11-15T00:00:00Z"),
        new Date("2026-11-15T00:00:00Z"),
        null,
        new Date("2026-11-16T00:00:00Z"),
        undefined,
      ]),
    ).toEqual({ "2026-11-15": 2, "2026-11-16": 1 });
  });
});

describe("dueDayTone", () => {
  const today = "2026-11-02";
  it.each([
    ["2026-11-01", "EXPIRED"],
    ["2026-11-02", "CLIENT"],
    ["2026-12-02", "CLIENT"], // J+30 : encore relance client
    ["2026-12-03", "WORKSHOP"], // J+31
    ["2027-01-01", "WORKSHOP"], // J+60
    ["2027-01-02", "LATER"], // J+61
  ] as const)("%s → %s", (day, tone) => {
    expect(dueDayTone(day, today)).toBe(tone);
  });
});
