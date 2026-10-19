import { describe, expect, it } from "vitest";
import { isWithinOpeningHours } from "./openingHours";

const TZ = "Africa/Abidjan"; // UTC+0, sans heure d'été — dates UTC = heure locale.
const OPENING_HOURS = {
  mon: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ] as const,
  tue: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ] as const,
  sat: [["08:00", "13:00"]] as const,
  sun: [],
};

describe("isWithinOpeningHours (RG-M03-01)", () => {
  it("accepte un créneau entièrement dans une plage d'ouverture", () => {
    // Lundi 09:00-10:30.
    expect(
      isWithinOpeningHours(
        new Date("2026-10-19T09:00:00Z"),
        new Date("2026-10-19T10:30:00Z"),
        TZ,
        OPENING_HOURS,
      ),
    ).toBe(true);
  });

  it("refuse un créneau qui chevauche la pause de midi", () => {
    // Lundi 12:00-13:00 : chevauche la pause 12:30-13:30.
    expect(
      isWithinOpeningHours(
        new Date("2026-10-19T12:00:00Z"),
        new Date("2026-10-19T13:00:00Z"),
        TZ,
        OPENING_HOURS,
      ),
    ).toBe(false);
  });

  it("refuse un créneau le dimanche (fermeture)", () => {
    // Dimanche 18/10/2026.
    expect(
      isWithinOpeningHours(
        new Date("2026-10-18T09:00:00Z"),
        new Date("2026-10-18T10:00:00Z"),
        TZ,
        OPENING_HOURS,
      ),
    ).toBe(false);
  });

  it("accepte le samedi demi-journée dans sa plage réduite", () => {
    // Samedi 24/10/2026 08:00-09:30.
    expect(
      isWithinOpeningHours(
        new Date("2026-10-24T08:00:00Z"),
        new Date("2026-10-24T09:30:00Z"),
        TZ,
        OPENING_HOURS,
      ),
    ).toBe(true);
  });

  it("refuse un créneau qui dépasse la fermeture du samedi", () => {
    // Samedi 24/10/2026 12:30-14:00 : dépasse 13:00.
    expect(
      isWithinOpeningHours(
        new Date("2026-10-24T12:30:00Z"),
        new Date("2026-10-24T14:00:00Z"),
        TZ,
        OPENING_HOURS,
      ),
    ).toBe(false);
  });

  it("refuse un jour férié même dans les horaires d'ouverture", () => {
    expect(
      isWithinOpeningHours(
        new Date("2026-10-19T09:00:00Z"),
        new Date("2026-10-19T10:00:00Z"),
        TZ,
        OPENING_HOURS,
        {
          siteId: "site_1",
          holidays: [{ date: new Date("2026-10-19T00:00:00Z"), siteId: null }],
        },
      ),
    ).toBe(false);
  });
});
