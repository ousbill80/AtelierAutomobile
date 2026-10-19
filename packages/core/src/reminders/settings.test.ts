import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDER_SETTINGS, parseReminderSettings } from "./settings";

describe("parseReminderSettings", () => {
  it("renvoie les défauts PRD pour un JSON vide ou absent", () => {
    expect(parseReminderSettings({})).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(parseReminderSettings(undefined)).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(parseReminderSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it("lit les valeurs fournies et retombe sur les défauts pour les clés manquantes", () => {
    const result = parseReminderSettings({
      approvalMode: "MANUAL_ALL",
      maxPerDay: 2,
      serviceDefaults: { months: 12 },
    });
    expect(result.approvalMode).toBe("MANUAL_ALL");
    expect(result.maxPerDay).toBe(2);
    expect(result.maxPerWeek).toBe(DEFAULT_REMINDER_SETTINGS.maxPerWeek);
    expect(result.serviceDefaults).toEqual({
      months: 12,
      km: DEFAULT_REMINDER_SETTINGS.serviceDefaults.km,
    });
  });

  it("ignore un approvalMode inconnu", () => {
    expect(parseReminderSettings({ approvalMode: "WHATEVER" }).approvalMode).toBe("PER_STEP");
  });

  it("parse les jours fériés en HolidayLike, ignorant les entrées invalides", () => {
    const result = parseReminderSettings({
      holidays: [{ date: "2026-11-01", label: "Toussaint" }, { date: "invalid" }, "nope"],
    });
    expect(result.holidays).toHaveLength(1);
    expect(result.holidays[0]?.date.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(result.holidays[0]?.siteId).toBeNull();
  });
});
