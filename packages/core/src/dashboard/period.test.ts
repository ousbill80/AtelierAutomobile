import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock";
import { resolvePeriod, variation } from "./period";

const TZ = "Africa/Abidjan";
const clock = fixedClock(new Date("2026-10-18T10:00:00.000Z"));

describe("resolvePeriod (RG-M12-01)", () => {
  it("mois en cours du 1er au 18 → comparaison du 1er au 18 du mois précédent", () => {
    const p = resolvePeriod("month", clock.now(), TZ);
    expect([p.fromDate, p.toDate]).toEqual(["2026-10-01", "2026-10-19"]);
    expect([p.previousFromDate, p.previousToDate]).toEqual(["2026-09-01", "2026-09-19"]);
    expect(p.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("mois en cours le 31/03 : comparaison bornée au mois de février", () => {
    const p = resolvePeriod("month", new Date("2026-03-31T12:00:00Z"), TZ);
    expect([p.previousFromDate, p.previousToDate]).toEqual(["2026-02-01", "2026-03-01"]);
  });

  it("aujourd'hui, 7 j, 30 j et mois précédent", () => {
    expect(resolvePeriod("today", clock.now(), TZ)).toMatchObject({
      fromDate: "2026-10-18",
      toDate: "2026-10-19",
      previousFromDate: "2026-10-17",
    });
    expect(resolvePeriod("7d", clock.now(), TZ)).toMatchObject({
      fromDate: "2026-10-12",
      previousFromDate: "2026-10-05",
      previousToDate: "2026-10-12",
    });
    expect(resolvePeriod("30d", clock.now(), TZ).fromDate).toBe("2026-09-19");
    expect(resolvePeriod("prev_month", new Date("2026-01-10T00:00:00Z"), TZ)).toMatchObject({
      fromDate: "2025-12-01",
      toDate: "2026-01-01",
      previousFromDate: "2025-11-01",
    });
  });

  it("applique le fuseau de l'organisation avant troncature", () => {
    // 31/10 23 h 30 UTC = 01/11 00 h 30 à Paris (UTC+1) : jour local = 01/11.
    const p = resolvePeriod("today", new Date("2026-10-31T23:30:00Z"), "Europe/Paris");
    expect(p.fromDate).toBe("2026-11-01");
    expect(p.from.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
});

describe("variation (RG-M12-01)", () => {
  it("pourcentage arrondi, « nouveau » si période précédente nulle", () => {
    expect(variation(150, 100)).toEqual({ kind: "pct", pct: 50 });
    expect(variation(66, 100)).toEqual({ kind: "pct", pct: -34 });
    expect(variation(10, 0)).toEqual({ kind: "new" });
    expect(variation(0, 0)).toEqual({ kind: "none" });
  });
});
