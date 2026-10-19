import { describe, expect, it } from "vitest";
import { christianHolidaysOfYear, easterBasedHolidays, ivorianFixedHolidays } from "./holidays";

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe("easterBasedHolidays", () => {
  it("calcule les fêtes mobiles de 2027 (exemple RG-M10-10 : lundi de Pâques 29/03, Ascension 06/05, lundi de Pentecôte 17/05)", () => {
    const result = easterBasedHolidays(2027);
    expect(iso(result.easterMonday)).toBe("2027-03-29");
    expect(iso(result.ascension)).toBe("2027-05-06");
    expect(iso(result.pentecostMonday)).toBe("2027-05-17");
  });

  it("calcule les fêtes mobiles de 2026", () => {
    // Pâques 2026 = 5 avril 2026 (référence calendaire usuelle).
    const result = easterBasedHolidays(2026);
    expect(iso(result.easterSunday)).toBe("2026-04-05");
    expect(iso(result.easterMonday)).toBe("2026-04-06");
    expect(iso(result.ascension)).toBe("2026-05-14");
    expect(iso(result.pentecostMonday)).toBe("2026-05-25");
  });
});

describe("ivorianFixedHolidays", () => {
  it("liste les 7 jours fériés fixes RG-M10-10", () => {
    const holidays = ivorianFixedHolidays(2026);
    expect(holidays).toHaveLength(7);
    expect(iso(holidays[0]!.date)).toBe("2026-01-01");
    expect(iso(holidays[4]!.date)).toBe("2026-11-01"); // Toussaint
  });
});

describe("christianHolidaysOfYear", () => {
  it("combine fixes et mobiles (10 jours fériés)", () => {
    const holidays = christianHolidaysOfYear(2027);
    expect(holidays).toHaveLength(10);
    expect(holidays.every((h) => h.siteId === null)).toBe(true);
  });
});
