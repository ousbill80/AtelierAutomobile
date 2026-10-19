import { describe, expect, it } from "vitest";
import { canRevertNoShow, isAppointmentLate, isEligibleForAutoNoShow } from "./noShow";

const TZ = "Africa/Abidjan";

describe("isAppointmentLate (RG-M03-09)", () => {
  it("signale un RDV en retard après le seuil (défaut 60 min)", () => {
    expect(
      isAppointmentLate(
        new Date("2026-10-24T10:01:00Z"),
        new Date("2026-10-24T09:00:00Z"),
        "BOOKED",
      ),
    ).toBe(true);
  });

  it("ne signale rien avant le seuil", () => {
    expect(
      isAppointmentLate(
        new Date("2026-10-24T09:30:00Z"),
        new Date("2026-10-24T09:00:00Z"),
        "BOOKED",
      ),
    ).toBe(false);
  });

  it("ignore les statuts déjà traités (ARRIVED, CANCELLED…)", () => {
    expect(
      isAppointmentLate(
        new Date("2026-10-24T11:00:00Z"),
        new Date("2026-10-24T09:00:00Z"),
        "ARRIVED",
      ),
    ).toBe(false);
  });
});

describe("isEligibleForAutoNoShow (RG-M03-10)", () => {
  it("n'est pas éligible avant l'heure du job (20:00) le jour même", () => {
    expect(
      isEligibleForAutoNoShow({
        status: "BOOKED",
        startsAt: new Date("2026-10-24T09:00:00Z"),
        now: new Date("2026-10-24T19:00:00Z"),
        timeZone: TZ,
      }),
    ).toBe(false);
  });

  it("est éligible le jour même après l'heure du job", () => {
    expect(
      isEligibleForAutoNoShow({
        status: "CONFIRMED",
        startsAt: new Date("2026-10-24T09:00:00Z"),
        now: new Date("2026-10-24T20:00:00Z"),
        timeZone: TZ,
      }),
    ).toBe(true);
  });

  it("est éligible en filet de sécurité pour un jour déjà passé", () => {
    expect(
      isEligibleForAutoNoShow({
        status: "BOOKED",
        startsAt: new Date("2026-10-24T09:00:00Z"),
        now: new Date("2026-10-26T08:00:00Z"),
        timeZone: TZ,
      }),
    ).toBe(true);
  });

  it("ignore un RDV déjà arrivé ou annulé", () => {
    expect(
      isEligibleForAutoNoShow({
        status: "ARRIVED",
        startsAt: new Date("2026-10-24T09:00:00Z"),
        now: new Date("2026-10-24T20:00:00Z"),
        timeZone: TZ,
      }),
    ).toBe(false);
  });

  it("ignore un RDV qui n'a pas encore eu lieu", () => {
    expect(
      isEligibleForAutoNoShow({
        status: "BOOKED",
        startsAt: new Date("2026-10-25T09:00:00Z"),
        now: new Date("2026-10-24T20:00:00Z"),
        timeZone: TZ,
      }),
    ).toBe(false);
  });
});

describe("canRevertNoShow (RG-M03-10)", () => {
  it("autorise la correction dans les 48 h", () => {
    expect(
      canRevertNoShow(new Date("2026-10-24T20:00:00Z"), new Date("2026-10-26T19:00:00Z")),
    ).toBe(true);
  });

  it("refuse la correction après 48 h", () => {
    expect(
      canRevertNoShow(new Date("2026-10-24T20:00:00Z"), new Date("2026-10-26T21:00:00Z")),
    ).toBe(false);
  });
});
