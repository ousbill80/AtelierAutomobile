import { describe, expect, it } from "vitest";
import {
  canRevertNoShow,
  countNoShows12m,
  isLate,
  noShowEligibility,
  requiresMandatoryConfirmation,
} from "./no-show";

const TZ = "Africa/Abidjan";

describe("isLate (US-M03-09)", () => {
  const startsAt = new Date("2026-10-24T09:00:00Z");
  it("vrai à partir de début + 60 min pour un RDV réservé ou confirmé", () => {
    expect(
      isLate({
        startsAt,
        status: "CONFIRMED",
        now: new Date("2026-10-24T09:59:00Z"),
        lateAfterMinutes: 60,
      }),
    ).toBe(false);
    expect(
      isLate({
        startsAt,
        status: "CONFIRMED",
        now: new Date("2026-10-24T10:00:00Z"),
        lateAfterMinutes: 60,
      }),
    ).toBe(true);
    expect(
      isLate({
        startsAt,
        status: "ARRIVED",
        now: new Date("2026-10-24T12:00:00Z"),
        lateAfterMinutes: 60,
      }),
    ).toBe(false);
  });
});

describe("noShowEligibility (RG-M03-10)", () => {
  const startsAt = new Date("2026-10-24T09:00:00Z");
  it("éligible le jour même à partir de 20:00 heure locale", () => {
    expect(
      noShowEligibility({
        startsAt,
        status: "BOOKED",
        now: new Date("2026-10-24T19:59:00Z"),
        timeZone: TZ,
        noShowJobTime: "20:00",
      }),
    ).toBe(false);
    expect(
      noShowEligibility({
        startsAt,
        status: "BOOKED",
        now: new Date("2026-10-24T20:00:00Z"),
        timeZone: TZ,
        noShowJobTime: "20:00",
      }),
    ).toBe(true);
  });
  it("tient compte du fuseau du site", () => {
    // 20:00 à Paris (UTC+2 le 24/10/2026) = 18:00 UTC
    expect(
      noShowEligibility({
        startsAt,
        status: "BOOKED",
        now: new Date("2026-10-24T18:00:00Z"),
        timeZone: "Europe/Paris",
        noShowJobTime: "20:00",
      }),
    ).toBe(true);
    expect(
      noShowEligibility({
        startsAt,
        status: "BOOKED",
        now: new Date("2026-10-24T17:59:00Z"),
        timeZone: "Europe/Paris",
        noShowJobTime: "20:00",
      }),
    ).toBe(false);
  });
  it("un RDV d'un jour précédent jamais traité est éligible ; un RDV futur ou arrivé ne l'est pas", () => {
    expect(
      noShowEligibility({
        startsAt,
        status: "CONFIRMED",
        now: new Date("2026-10-25T08:00:00Z"),
        timeZone: TZ,
        noShowJobTime: "20:00",
      }),
    ).toBe(true);
    expect(
      noShowEligibility({
        startsAt: new Date("2026-10-25T09:00:00Z"),
        status: "BOOKED",
        now: new Date("2026-10-24T21:00:00Z"),
        timeZone: TZ,
        noShowJobTime: "20:00",
      }),
    ).toBe(false);
    expect(
      noShowEligibility({
        startsAt,
        status: "ARRIVED",
        now: new Date("2026-10-24T21:00:00Z"),
        timeZone: TZ,
        noShowJobTime: "20:00",
      }),
    ).toBe(false);
  });
});

describe("canRevertNoShow / countNoShows12m / badge", () => {
  it("correction possible dans les 48 h", () => {
    const noShowAt = new Date("2026-10-24T20:00:00Z");
    expect(canRevertNoShow({ noShowAt, now: new Date("2026-10-26T19:59:00Z") })).toBe(true);
    expect(canRevertNoShow({ noShowAt, now: new Date("2026-10-26T20:01:00Z") })).toBe(false);
    expect(canRevertNoShow({ noShowAt: null, now: new Date() })).toBe(false);
  });
  it("compte les absences sur 12 mois glissants", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    const count = countNoShows12m(
      [
        { status: "NO_SHOW", startsAt: new Date("2026-01-10T09:00:00Z") },
        { status: "NO_SHOW", startsAt: new Date("2025-10-25T09:00:00Z") },
        { status: "NO_SHOW", startsAt: new Date("2025-10-01T09:00:00Z") },
        { status: "CANCELLED", startsAt: new Date("2026-05-01T09:00:00Z") },
      ],
      now,
    );
    expect(count).toBe(2);
    expect(requiresMandatoryConfirmation(count)).toBe(true);
    expect(requiresMandatoryConfirmation(1)).toBe(false);
  });
});
