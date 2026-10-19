import { describe, expect, it } from "vitest";
import { isWithinSendWindow, nextSendWindowStart } from "./sendWindow";

const WINDOW = { from: "07:00", to: "21:00" };
const TZ = "Africa/Abidjan"; // UTC+0, pas de décalage horaire

describe("isWithinSendWindow", () => {
  it("vrai en pleine journée", () => {
    expect(isWithinSendWindow(new Date("2026-10-19T12:00:00Z"), TZ, WINDOW)).toBe(true);
  });

  it("faux avant 07:00", () => {
    expect(isWithinSendWindow(new Date("2026-10-19T06:59:00Z"), TZ, WINDOW)).toBe(false);
  });

  it("faux à partir de 21:00", () => {
    expect(isWithinSendWindow(new Date("2026-10-19T21:00:00Z"), TZ, WINDOW)).toBe(false);
  });

  it("vrai exactement à l'ouverture (07:00)", () => {
    expect(isWithinSendWindow(new Date("2026-10-19T07:00:00Z"), TZ, WINDOW)).toBe(true);
  });
});

describe("nextSendWindowStart", () => {
  it("renvoie le jour même à 08:00 si on est avant 08:00", () => {
    const result = nextSendWindowStart(new Date("2026-10-19T05:00:00Z"), TZ);
    expect(result.toISOString()).toBe("2026-10-19T08:00:00.000Z");
  });

  it("renvoie le lendemain 08:00 si on est après 08:00", () => {
    const result = nextSendWindowStart(new Date("2026-10-19T22:00:00Z"), TZ);
    expect(result.toISOString()).toBe("2026-10-20T08:00:00.000Z");
  });
});
