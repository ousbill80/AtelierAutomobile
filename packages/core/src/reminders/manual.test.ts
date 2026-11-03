import { describe, expect, it } from "vitest";
import { checkManualReminder, MANUAL_REMINDER_MIN_GAP_HOURS } from "./manual";

describe("checkManualReminder", () => {
  const now = new Date("2026-11-02T10:00:00Z");

  it("autorise sans relance récente ni relance en attente", () => {
    expect(checkManualReminder({ now, lastSentAt: null, hasPendingDue: false })).toEqual({
      allowed: true,
    });
  });

  it("refuse si une relance est déjà prête à partir", () => {
    expect(checkManualReminder({ now, lastSentAt: null, hasPendingDue: true })).toEqual({
      allowed: false,
      reason: "ALREADY_PENDING",
    });
  });

  it("refuse moins de 20 h après la dernière relance envoyée, avec l'heure de déblocage", () => {
    const lastSentAt = new Date("2026-11-02T08:00:00Z");
    expect(checkManualReminder({ now, lastSentAt, hasPendingDue: false })).toEqual({
      allowed: false,
      reason: "RECENTLY_SENT",
      nextAllowedAt: new Date("2026-11-03T04:00:00Z"),
    });
  });

  it("autorise pile 20 h après", () => {
    const lastSentAt = new Date(now.getTime() - MANUAL_REMINDER_MIN_GAP_HOURS * 3_600_000);
    expect(checkManualReminder({ now, lastSentAt, hasPendingDue: false })).toEqual({
      allowed: true,
    });
  });
});
