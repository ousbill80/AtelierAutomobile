import { describe, expect, it } from "vitest";
import {
  civilDateToUtcDate,
  computeEasterSunday,
  generateCiHolidays,
  getEstimatedIslamicHolidays,
  getFixedHolidays,
} from "./ci-holidays";

describe("computeEasterSunday — algorithme de Meeus/Jones/Butcher", () => {
  it("Pâques 2027 = 28/03 (M15 §12)", () => {
    expect(computeEasterSunday(2027)).toEqual({ year: 2027, month: 3, day: 28 });
  });

  it("Pâques 2026 = 05/04", () => {
    expect(computeEasterSunday(2026)).toEqual({ year: 2026, month: 4, day: 5 });
  });
});

describe("getFixedHolidays — jours fériés fixes et dérivés de Pâques (RG-M15-08)", () => {
  it("2027 : Lundi de Pâques 29/03, Ascension 06/05, Lundi de Pentecôte 17/05 (M15 §12)", () => {
    const holidays = getFixedHolidays(2027);
    const easterMonday = holidays.find((h) => h.name === "Lundi de Pâques");
    const ascension = holidays.find((h) => h.name === "Ascension");
    const pentecostMonday = holidays.find((h) => h.name === "Lundi de Pentecôte");
    expect(easterMonday?.date).toEqual({ year: 2027, month: 3, day: 29 });
    expect(ascension?.date).toEqual({ year: 2027, month: 5, day: 6 });
    expect(pentecostMonday?.date).toEqual({ year: 2027, month: 5, day: 17 });
  });

  it("contient les 10 jours fériés fixes de la liste ivoirienne (US-M15-04)", () => {
    const holidays = getFixedHolidays(2027);
    expect(holidays).toHaveLength(10);
    expect(holidays.every((h) => h.isEstimated === false)).toBe(true);
    const names = holidays.map((h) => h.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Jour de l'An",
        "Lundi de Pâques",
        "Fête du Travail",
        "Ascension",
        "Lundi de Pentecôte",
        "Fête de l'Indépendance",
        "Assomption",
        "Toussaint",
        "Anniversaire de la mort de Félix Houphouët-Boigny",
        "Noël",
      ]),
    );
  });

  it("dates fixes correctes (7 août, 15 août, 1er novembre, 15 novembre, 25 décembre)", () => {
    const holidays = getFixedHolidays(2027);
    expect(holidays.find((h) => h.name === "Fête de l'Indépendance")?.date).toEqual({
      year: 2027,
      month: 8,
      day: 7,
    });
    expect(holidays.find((h) => h.name === "Noël")?.date).toEqual({
      year: 2027,
      month: 12,
      day: 25,
    });
  });
});

describe("getEstimatedIslamicHolidays — fêtes musulmanes à date estimée (RG-M15-08)", () => {
  it("retourne les 4 fêtes, toutes marquées isEstimated = true", () => {
    const holidays = getEstimatedIslamicHolidays(2027);
    expect(holidays).toHaveLength(4);
    expect(holidays.every((h) => h.isEstimated === true)).toBe(true);
    expect(holidays.map((h) => h.name)).toEqual(
      expect.arrayContaining([
        "Aïd el-Fitr",
        "Tabaski (Aïd el-Kébir)",
        "Maouloud",
        "Lendemain de la Nuit du Destin",
      ]),
    );
  });

  it("les dates estimées retombent bien dans l'année grégorienne demandée", () => {
    for (const year of [2024, 2025, 2026, 2027, 2030]) {
      const holidays = getEstimatedIslamicHolidays(year);
      expect(holidays).toHaveLength(4);
      for (const holiday of holidays) {
        expect(holiday.date.year).toBe(year);
      }
    }
  });

  it("l'estimation dérive dans le temps (les fêtes hégiriennes reculent d'environ 11 jours par an)", () => {
    const h2024 = getEstimatedIslamicHolidays(2024).find((h) => h.name === "Aïd el-Fitr")!;
    const h2025 = getEstimatedIslamicHolidays(2025).find((h) => h.name === "Aïd el-Fitr")!;
    const d2024 = civilDateToUtcDate(h2024.date).getTime();
    const d2025 = civilDateToUtcDate(h2025.date).getTime();
    const diffDays = (d2025 - d2024) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(340);
    expect(diffDays).toBeLessThan(365);
  });
});

describe("generateCiHolidays — liste complète pour une année (US-M15-04)", () => {
  it("combine les 10 jours fixes et les 4 jours estimés (14 au total)", () => {
    const holidays = generateCiHolidays(2027);
    expect(holidays).toHaveLength(14);
    expect(holidays.filter((h) => h.isEstimated).length).toBe(4);
  });
});

describe("civilDateToUtcDate", () => {
  it("construit une date UTC à partir d'une date civile", () => {
    const date = civilDateToUtcDate({ year: 2027, month: 3, day: 28 });
    expect(date.toISOString()).toBe("2027-03-28T00:00:00.000Z");
  });
});
