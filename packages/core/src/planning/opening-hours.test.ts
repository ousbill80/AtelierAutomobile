import { describe, expect, it } from "vitest";
import {
  instantAt,
  isWithinOpeningHours,
  openingRangesForDay,
  subtractRange,
} from "./opening-hours";

const TZ = "Africa/Abidjan";
const HOURS = {
  mon: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ] as [string, string][],
  sat: [["08:00", "14:00"]] as [string, string][],
  sun: [] as [string, string][],
};
// 24/10/2026 est un samedi, 26/10/2026 un lundi, 25/10/2026 un dimanche.
const at = (day: string, time: string) => instantAt(day, time, TZ);

describe("openingRangesForDay (RG-M03-01)", () => {
  it("renvoie les plages du lundi en instants UTC (Abidjan = UTC+0)", () => {
    const ranges = openingRangesForDay(HOURS, at("2026-10-26", "10:00"), TZ);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]!.start.toISOString()).toBe("2026-10-26T07:30:00.000Z");
    expect(ranges[1]!.end.toISOString()).toBe("2026-10-26T18:00:00.000Z");
  });

  it("gère un fuseau avec décalage (Europe/Paris)", () => {
    const ranges = openingRangesForDay(
      HOURS,
      instantAt("2026-10-26", "10:00", "Europe/Paris"),
      "Europe/Paris",
    );
    expect(ranges[0]!.start.toISOString()).toBe("2026-10-26T06:30:00.000Z");
  });

  it("retire la pause déjeuner configurée d'une plage continue", () => {
    const ranges = openingRangesForDay(
      { mon: [["07:30", "18:00"]] },
      at("2026-10-26", "09:00"),
      TZ,
      {
        lunchBreak: ["12:30", "13:30"],
      },
    );
    expect(ranges.map((r) => [r.start.toISOString(), r.end.toISOString()])).toEqual([
      ["2026-10-26T07:30:00.000Z", "2026-10-26T12:30:00.000Z"],
      ["2026-10-26T13:30:00.000Z", "2026-10-26T18:00:00.000Z"],
    ]);
  });

  it("est vide le dimanche et un jour férié", () => {
    expect(openingRangesForDay(HOURS, at("2026-10-25", "10:00"), TZ)).toEqual([]);
    const holidays = [{ date: new Date("2026-10-26T00:00:00Z"), siteId: null }];
    expect(openingRangesForDay(HOURS, at("2026-10-26", "10:00"), TZ, { holidays })).toEqual([]);
  });
});

describe("isWithinOpeningHours (RG-M03-01)", () => {
  it("accepte un RDV entièrement dans une plage", () => {
    expect(
      isWithinOpeningHours({
        startsAt: at("2026-10-24", "09:00"),
        endsAt: at("2026-10-24", "10:30"),
        openingHours: HOURS,
        timeZone: TZ,
      }),
    ).toEqual({ ok: true });
  });

  it("refuse un RDV qui chevauche la pause de midi", () => {
    expect(
      isWithinOpeningHours({
        startsAt: at("2026-10-26", "12:00"),
        endsAt: at("2026-10-26", "13:00"),
        openingHours: HOURS,
        timeZone: TZ,
      }),
    ).toEqual({ ok: false, reason: "OUTSIDE_RANGE" });
  });

  it("refuse un RDV qui dépasse la demi-journée du samedi", () => {
    expect(
      isWithinOpeningHours({
        startsAt: at("2026-10-24", "13:00"),
        endsAt: at("2026-10-24", "14:30"),
        openingHours: HOURS,
        timeZone: TZ,
      }),
    ).toEqual({ ok: false, reason: "OUTSIDE_RANGE" });
  });

  it("refuse le dimanche (fermé) et les jours fériés", () => {
    expect(
      isWithinOpeningHours({
        startsAt: at("2026-10-25", "09:00"),
        endsAt: at("2026-10-25", "10:00"),
        openingHours: HOURS,
        timeZone: TZ,
      }),
    ).toEqual({ ok: false, reason: "CLOSED_DAY" });
    expect(
      isWithinOpeningHours({
        startsAt: at("2026-10-26", "09:00"),
        endsAt: at("2026-10-26", "10:00"),
        openingHours: HOURS,
        timeZone: TZ,
        holidays: [{ date: new Date("2026-10-26T00:00:00Z"), siteId: "site-a" }],
        siteId: "site-a",
      }),
    ).toEqual({ ok: false, reason: "HOLIDAY" });
  });

  it("un jour férié propre à un autre site n'affecte pas ce site", () => {
    expect(
      isWithinOpeningHours({
        startsAt: at("2026-10-26", "09:00"),
        endsAt: at("2026-10-26", "10:00"),
        openingHours: HOURS,
        timeZone: TZ,
        holidays: [{ date: new Date("2026-10-26T00:00:00Z"), siteId: "site-b" }],
        siteId: "site-a",
      }),
    ).toEqual({ ok: true });
  });
});

describe("subtractRange", () => {
  it("coupe une plage en deux, tronque ou laisse intact", () => {
    const r = (s: string, e: string) => ({ start: at("2026-10-26", s), end: at("2026-10-26", e) });
    expect(subtractRange([r("08:00", "18:00")], r("12:00", "13:00"))).toEqual([
      r("08:00", "12:00"),
      r("13:00", "18:00"),
    ]);
    expect(subtractRange([r("08:00", "12:30")], r("12:00", "13:00"))).toEqual([
      r("08:00", "12:00"),
    ]);
    expect(subtractRange([r("14:00", "18:00")], r("12:00", "13:00"))).toEqual([
      r("14:00", "18:00"),
    ]);
  });
});
