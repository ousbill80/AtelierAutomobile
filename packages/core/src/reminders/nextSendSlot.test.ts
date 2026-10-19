import { describe, expect, it } from "vitest";
import { nextSendSlot, type SendWindowLike } from "./nextSendSlot";

const VT_WINDOW: SendWindowLike = {
  days: [1, 2, 3, 4, 5, 6], // lun-sam
  from: "08:00",
  to: "19:00",
  preferredTime: "09:00",
};
const TZ = "Africa/Abidjan";
const TOUSSAINT = { date: new Date("2026-11-01"), siteId: null };

describe("nextSendSlot — RG-M10-09", () => {
  it("palier avant échéance sur un jour non ouvré (dimanche + férié) : repli au samedi précédent", () => {
    const slot = nextSendSlot({
      target: new Date("2026-11-01"), // dimanche, Toussaint
      offsetDays: -7,
      sendWindow: VT_WINDOW,
      holidays: [TOUSSAINT],
      timeZone: TZ,
      now: new Date("2026-10-18T08:00:00Z"),
    });
    expect(slot.toISOString()).toBe(new Date("2026-10-31T09:00:00Z").toISOString());
  });

  it("palier à J0 ou après sur un jour non ouvré : recule au jour ouvré suivant", () => {
    const slot = nextSendSlot({
      target: new Date("2026-11-01"), // dimanche
      offsetDays: 0,
      sendWindow: VT_WINDOW,
      holidays: [TOUSSAINT],
      timeZone: TZ,
      now: new Date("2026-10-20T08:00:00Z"),
    });
    expect(slot.toISOString()).toBe(new Date("2026-11-02T09:00:00Z").toISOString());
  });

  it("heure cible déjà passée mais fenêtre encore ouverte : envoi immédiat (prochain passage)", () => {
    const now = new Date("2026-10-26T12:00:00Z"); // lundi, dans la fenêtre 08:00-19:00
    const slot = nextSendSlot({
      target: new Date("2026-10-26"),
      offsetDays: 0,
      sendWindow: VT_WINDOW,
      timeZone: TZ,
      now,
    });
    expect(slot.toISOString()).toBe(now.toISOString());
  });

  it("heure cible passée et fenêtre fermée : lendemain ouvré à l'heure préférée", () => {
    const now = new Date("2026-10-26T20:00:00Z"); // lundi 20:00, fenêtre fermée
    const slot = nextSendSlot({
      target: new Date("2026-10-26"),
      offsetDays: 0,
      sendWindow: VT_WINDOW,
      timeZone: TZ,
      now,
    });
    expect(slot.toISOString()).toBe(new Date("2026-10-27T09:00:00Z").toISOString());
  });

  it("step.sendAt impose une heure différente de preferredTime", () => {
    const slot = nextSendSlot({
      target: new Date("2026-10-27"), // mardi, ouvré
      offsetDays: -1,
      sendAt: "17:00",
      sendWindow: VT_WINDOW,
      timeZone: TZ,
      now: new Date("2026-10-20T08:00:00Z"),
    });
    expect(slot.toISOString()).toBe(new Date("2026-10-27T17:00:00Z").toISOString());
  });
});
