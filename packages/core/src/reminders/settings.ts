import type { HolidayLike } from "../calendar";
import { DEFAULT_CATCH_UP_DAYS, DEFAULT_MIN_GAP_DAYS } from "./types";
import { DEFAULT_APPROVAL_MODE, type ApprovalMode } from "./approval";
import { DEFAULT_MAX_PER_DAY, DEFAULT_MAX_PER_WEEK } from "./antispam";

/** M10 §6 — `Organization.settings.reminders`, défauts documentés dans le PRD. */
export interface ReminderSettings {
  approvalMode: ApprovalMode;
  maxPerDay: number;
  maxPerWeek: number;
  minGapDays: number;
  catchUpDays: number;
  pauseOnReplyHours: number;
  /** RG-M10-29 — au-delà de cette ancienneté (heures), les relances `RECEIVABLE` en
   * `REMINDERS_ONLY` sont forcées en `NEEDS_APPROVAL`. */
  maxDataAgeHours: number;
  defaultKmPerDay: number;
  serviceDefaults: { months: number; km: number };
  inspectionValidityMonths: number;
  holidays: HolidayLike[];
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  approvalMode: DEFAULT_APPROVAL_MODE,
  maxPerDay: DEFAULT_MAX_PER_DAY,
  maxPerWeek: DEFAULT_MAX_PER_WEEK,
  minGapDays: DEFAULT_MIN_GAP_DAYS,
  catchUpDays: DEFAULT_CATCH_UP_DAYS,
  pauseOnReplyHours: 48,
  maxDataAgeHours: 48,
  defaultKmPerDay: 40,
  serviceDefaults: { months: 6, km: 10000 },
  inspectionValidityMonths: 12,
  holidays: [],
};

function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === "PER_STEP" || value === "MANUAL_ALL" || value === "PAUSED";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Parse `Organization.settings.reminders` (JSON non typé en base) en {@link ReminderSettings},
 * en retombant sur les défauts PRD pour toute clé absente ou invalide — jamais d'exception sur un
 * JSON incomplet ou legacy.
 */
export function parseReminderSettings(raw: unknown): ReminderSettings {
  const input = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) ?? {};
  const serviceDefaultsRaw =
    input.serviceDefaults && typeof input.serviceDefaults === "object"
      ? (input.serviceDefaults as Record<string, unknown>)
      : {};

  return {
    approvalMode: isApprovalMode(input.approvalMode)
      ? input.approvalMode
      : DEFAULT_REMINDER_SETTINGS.approvalMode,
    maxPerDay: num(input.maxPerDay, DEFAULT_REMINDER_SETTINGS.maxPerDay),
    maxPerWeek: num(input.maxPerWeek, DEFAULT_REMINDER_SETTINGS.maxPerWeek),
    minGapDays: num(input.minGapDays, DEFAULT_REMINDER_SETTINGS.minGapDays),
    catchUpDays: num(input.catchUpDays, DEFAULT_REMINDER_SETTINGS.catchUpDays),
    pauseOnReplyHours: num(input.pauseOnReplyHours, DEFAULT_REMINDER_SETTINGS.pauseOnReplyHours),
    maxDataAgeHours: num(input.maxDataAgeHours, DEFAULT_REMINDER_SETTINGS.maxDataAgeHours),
    defaultKmPerDay: num(input.defaultKmPerDay, DEFAULT_REMINDER_SETTINGS.defaultKmPerDay),
    serviceDefaults: {
      months: num(serviceDefaultsRaw.months, DEFAULT_REMINDER_SETTINGS.serviceDefaults.months),
      km: num(serviceDefaultsRaw.km, DEFAULT_REMINDER_SETTINGS.serviceDefaults.km),
    },
    inspectionValidityMonths: num(
      input.inspectionValidityMonths,
      DEFAULT_REMINDER_SETTINGS.inspectionValidityMonths,
    ),
    holidays: Array.isArray(input.holidays)
      ? (input.holidays as unknown[])
          .map((h): HolidayLike | null => {
            if (!h || typeof h !== "object") return null;
            const date = (h as Record<string, unknown>).date;
            const parsed = typeof date === "string" ? new Date(date) : null;
            if (!parsed || Number.isNaN(parsed.getTime())) return null;
            return { date: parsed, siteId: null };
          })
          .filter((h): h is HolidayLike => h !== null)
      : [],
  };
}
