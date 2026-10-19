import { describe, expect, it } from "vitest";
import { computeJ1ReminderTime, transactionalSendTime } from "./send-window";

const TZ = "Africa/Abidjan";

describe("transactionalSendTime (RG-M03-08)", () => {
  it("envoie immédiatement en journée", () => {
    const now = new Date("2026-10-24T10:15:00Z");
    expect(transactionalSendTime(now, TZ)).toEqual(now);
  });
  it("reporte à 07:00 entre 22:00 et 07:00", () => {
    expect(transactionalSendTime(new Date("2026-10-24T22:30:00Z"), TZ).toISOString()).toBe(
      "2026-10-25T07:00:00.000Z",
    );
    expect(transactionalSendTime(new Date("2026-10-25T03:00:00Z"), TZ).toISOString()).toBe(
      "2026-10-25T07:00:00.000Z",
    );
  });
});

describe("computeJ1ReminderTime (RG-M03-08)", () => {
  it("la veille à 17:00, ou 19:00 pour un RDV avant 10:00", () => {
    expect(
      computeJ1ReminderTime({
        startsAt: new Date("2026-10-24T11:00:00Z"),
        createdAt: new Date("2026-10-20T10:00:00Z"),
        timeZone: TZ,
      })!.toISOString(),
    ).toBe("2026-10-23T17:00:00.000Z");
    expect(
      computeJ1ReminderTime({
        startsAt: new Date("2026-10-24T08:30:00Z"),
        createdAt: new Date("2026-10-20T10:00:00Z"),
        timeZone: TZ,
      })!.toISOString(),
    ).toBe("2026-10-23T19:00:00.000Z");
  });
  it("pas de J-1 si le RDV est créé moins de 24 h avant", () => {
    expect(
      computeJ1ReminderTime({
        startsAt: new Date("2026-10-24T11:00:00Z"),
        createdAt: new Date("2026-10-23T12:00:00Z"),
        timeZone: TZ,
      }),
    ).toBeNull();
  });
});
