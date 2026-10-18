import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  DEFAULT_WEEKLY_CLOSURE,
  formatDate,
  isBusinessDay,
  isHoliday,
  today,
} from "./calendar";
import { fixedClock } from "./clock";

const TZ = "Africa/Abidjan";

describe("formatDate — affichage métier dd/MM/yyyy", () => {
  it("formate une date dans le fuseau de l'organisation", () => {
    expect(formatDate(new Date("2026-01-05T10:00:00Z"), TZ)).toBe("05/01/2026");
  });
});

describe("DEFAULT_WEEKLY_CLOSURE", () => {
  it("dimanche seul, par défaut (M03)", () => {
    expect(DEFAULT_WEEKLY_CLOSURE).toEqual([0]);
  });
});

describe("isBusinessDay — fermeture hebdomadaire", () => {
  it("le dimanche n'est pas ouvré par défaut", () => {
    expect(isBusinessDay(new Date("2026-10-18T09:00:00Z"), TZ)).toBe(false); // dimanche
  });

  it("le samedi est ouvré par défaut (exemple métier M03)", () => {
    expect(isBusinessDay(new Date("2026-10-24T09:00:00Z"), TZ)).toBe(true); // samedi
  });

  it("un jour de semaine ordinaire est ouvré", () => {
    expect(isBusinessDay(new Date("2026-10-19T09:00:00Z"), TZ)).toBe(true); // lundi
  });

  it("accepte une fermeture hebdomadaire personnalisée (ex. samedi + dimanche)", () => {
    expect(isBusinessDay(new Date("2026-10-24T09:00:00Z"), TZ, { weeklyClosure: [0, 6] })).toBe(
      false,
    );
  });
});

describe("isHoliday / isBusinessDay — jours fériés", () => {
  const holidays = [
    { date: new Date("2026-08-07T00:00:00Z"), siteId: null }, // férié national, tous sites
    { date: new Date("2026-03-15T00:00:00Z"), siteId: "site_1" }, // fermeture propre à un site
  ];

  it("un jour férié global s'applique à tous les sites", () => {
    expect(isHoliday(new Date("2026-08-07T08:00:00Z"), "site_1", holidays, TZ)).toBe(true);
    expect(isHoliday(new Date("2026-08-07T08:00:00Z"), "site_2", holidays, TZ)).toBe(true);
    expect(
      isBusinessDay(new Date("2026-08-07T08:00:00Z"), TZ, { siteId: "site_2", holidays }),
    ).toBe(false);
  });

  it("une fermeture propre à un site ne s'applique pas aux autres sites", () => {
    expect(isHoliday(new Date("2026-03-15T08:00:00Z"), "site_1", holidays, TZ)).toBe(true);
    expect(isHoliday(new Date("2026-03-15T08:00:00Z"), "site_2", holidays, TZ)).toBe(false);
  });

  it("un jour sans fermeture hebdomadaire ni férié est ouvré", () => {
    expect(
      isBusinessDay(new Date("2026-10-19T08:00:00Z"), TZ, { siteId: "site_1", holidays }),
    ).toBe(true);
  });
});

describe("addBusinessDays", () => {
  it("avance de N jours ouvrés en sautant les dimanches", () => {
    const monday = new Date("2026-10-19T08:00:00Z");
    const result = addBusinessDays(monday, 6, TZ);
    expect(formatDate(result, TZ)).toBe("26/10/2026");
  });

  it("saute aussi les jours fériés fournis", () => {
    const start = new Date("2026-08-05T08:00:00Z"); // mercredi
    const holidays = [{ date: new Date("2026-08-07T00:00:00Z"), siteId: null }]; // vendredi férié
    const result = addBusinessDays(start, 2, TZ, { holidays });
    expect(formatDate(result, TZ)).toBe("08/08/2026");
  });

  it("refuse une valeur non entière ou négative/nulle", () => {
    const date = new Date("2026-10-19T08:00:00Z");
    expect(() => addBusinessDays(date, 0, TZ)).toThrow(/entier positif/);
    expect(() => addBusinessDays(date, -1, TZ)).toThrow(/entier positif/);
    expect(() => addBusinessDays(date, 1.5, TZ)).toThrow(/entier positif/);
  });
});

describe("today — horloge injectable", () => {
  it("utilise l'horloge injectée, jamais new Date() direct", () => {
    const clock = fixedClock(new Date("2026-12-25T10:00:00Z"));
    expect(today(clock, TZ)).toBe("25/12/2026");
  });
});
