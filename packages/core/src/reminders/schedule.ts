import { addDays, differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { isBusinessDay, type HolidayLike, type Weekday } from "../calendar";
import { DEFAULT_CATCH_UP_DAYS, DEFAULT_MIN_GAP_DAYS } from "./types";
import type { ReminderStatus, ReminderStep, SendWindow, StepAnchorMode } from "./types";

// ───────────────────────── RG-M10-05 — clés de séquence et de dédoublonnage ─────────────────────────

/** RG-M10-05 — `"{TYPE}:{entityId}:{anchorISO}"`, ex. `INSPECTION:veh_8k2:2026-11-02`. */
export function sequenceKey(
  type: string,
  entityId: string,
  anchor: Date,
  timeZone: string,
): string {
  return `${type}:${entityId}:${formatInTimeZone(anchor, timeZone, "yyyy-MM-dd")}`;
}

/** RG-M10-05 — `sequenceKey + ":" + stepKey`, unique par `[organizationId, dedupeKey]`. */
export function dedupeKey(sequence: string, stepKey: string): string {
  return `${sequence}:${stepKey}`;
}

/** RG-M10-05 — relance hors séquence : promesse rompue. `"RECEIVABLE:{caseId}:{anchor}:PROMISE_BROKEN:{promiseId}"`. */
export function promiseBrokenDedupeKey(
  caseId: string,
  anchor: Date,
  promiseId: string,
  timeZone: string,
): string {
  return `${sequenceKey("RECEIVABLE", caseId, anchor, timeZone)}:PROMISE_BROKEN:${promiseId}`;
}

/** RG-M10-05 — relance manuelle hors séquence : `"…:MANUAL:{yyyyMMddHHmm}"`. */
export function manualDedupeKey(sequence: string, timestamp: Date, timeZone: string): string {
  return `${sequence}:MANUAL:${formatInTimeZone(timestamp, timeZone, "yyyyMMddHHmm")}`;
}

// ───────────────────────── RG-M10-06/07 — choix du palier ─────────────────────────

export interface AnchorDates {
  default: Date;
  sentAt?: Date;
  validUntil?: Date;
}

/** RG-M10-03 — date cible d'un palier, résolue depuis l'ancre adaptée (`step.anchor`). */
export function targetDate(anchors: AnchorDates, step: ReminderStep): Date {
  const anchorMode: StepAnchorMode = step.anchor ?? "default";
  const base = anchors[anchorMode] ?? anchors.default;
  return addDays(base, step.offsetDays);
}

export interface StepHistoryEntry {
  stepKey: string;
  status: ReminderStatus;
  sentAt?: Date | null;
}

export interface PickStepConfig {
  minGapDays?: number;
  catchUpDays?: number;
}

export interface PickStepResult {
  step: ReminderStep;
  /** La relance ne doit pas être programmée avant cette date (RG-M10-07, espacement `minGapDays`). */
  notBefore?: Date;
  /** `true` si la date cible du palier est déjà passée (rattrapage, RG-M10-06). */
  catchUp: boolean;
}

/**
 * RG-M10-06 / RG-M10-07 — à un instant donné, on ne crée que le palier le plus récent déjà dû
 * d'une séquence ; jamais de palier ≤ à un palier déjà `SENT` ; rattrapage borné par la fenêtre
 * `[t(P) ; t(N) - minGapDays - 1]` (ou `t(P) + catchUpDays` pour le dernier palier).
 */
export function pickStep(
  steps: readonly ReminderStep[],
  anchors: AnchorDates,
  today: Date,
  history: readonly StepHistoryEntry[],
  cfg: PickStepConfig = {},
): PickStepResult | null {
  const minGapDays = cfg.minGapDays ?? DEFAULT_MIN_GAP_DAYS;
  const defaultCatchUpDays = cfg.catchUpDays ?? DEFAULT_CATCH_UP_DAYS;

  const sorted = [...steps].sort(
    (a, b) => targetDate(anchors, a).getTime() - targetDate(anchors, b).getTime(),
  );

  const due = sorted.filter((s) => targetDate(anchors, s).getTime() <= today.getTime());
  if (due.length === 0) return null;

  const step = due[due.length - 1] as ReminderStep;
  const stepIndex = sorted.findIndex((s) => s.key === step.key);

  // Déjà créé pour cette séquence (quel que soit le statut) → jamais recréé.
  if (history.some((r) => r.stepKey === step.key)) return null;

  const sentHistory = history.filter((r) => r.status === "SENT" && r.sentAt);
  const lastSent = sentHistory.reduce<StepHistoryEntry | null>((latest, r) => {
    if (!latest || (r.sentAt && latest.sentAt && r.sentAt.getTime() > latest.sentAt.getTime())) {
      return r;
    }
    return latest;
  }, null);

  if (lastSent) {
    const lastSentIndex = sorted.findIndex((s) => s.key === lastSent.stepKey);
    if (lastSentIndex >= 0 && lastSentIndex >= stepIndex) return null;
  }

  const next = sorted[stepIndex + 1];
  const limit = next
    ? addDays(targetDate(anchors, next), -minGapDays - 1)
    : addDays(targetDate(anchors, step), step.catchUpDays ?? defaultCatchUpDays);
  if (today.getTime() > limit.getTime()) return null;

  const notBefore =
    lastSent?.sentAt && differenceInCalendarDays(today, lastSent.sentAt) < minGapDays
      ? addDays(lastSent.sentAt, minGapDays)
      : undefined;

  return { step, notBefore, catchUp: targetDate(anchors, step).getTime() < today.getTime() };
}

// ───────────────────────── RG-M10-09 — créneau d'envoi ─────────────────────────

function toDateKey(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd");
}

/** Jour calendaire (`yyyy-MM-dd` dans `timeZone`) représenté par un instant sûr pour les comparaisons de clé. */
function dayAnchorInstant(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`);
}

function keyPlusCalendarDays(key: string, delta: number): string {
  const [year, month, day] = key.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return shifted.toISOString().slice(0, 10);
}

function isSendableDay(
  dayKey: string,
  sendWindow: Pick<SendWindow, "days">,
  holidays: readonly HolidayLike[],
  timeZone: string,
  siteId: string | null,
): boolean {
  const weeklyClosure = ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).filter(
    (d) => !sendWindow.days.includes(d),
  );
  return isBusinessDay(dayAnchorInstant(dayKey), timeZone, { siteId, holidays, weeklyClosure });
}

function nextSendableDayAfter(
  key: string,
  sendWindow: Pick<SendWindow, "days">,
  holidays: readonly HolidayLike[],
  timeZone: string,
  siteId: string | null,
): string {
  let candidate = keyPlusCalendarDays(key, 1);
  let guard = 0;
  while (!isSendableDay(candidate, sendWindow, holidays, timeZone, siteId) && guard < 60) {
    candidate = keyPlusCalendarDays(candidate, 1);
    guard += 1;
  }
  return candidate;
}

function combineDayAndTime(dayKey: string, time: string, timeZone: string): Date {
  return fromZonedTime(`${dayKey} ${time}:00`, timeZone);
}

export interface NextSendSlotInput {
  /** Date cible brute du palier (avant ajustement jour ouvré / passé). */
  targetDate: Date;
  /** `step.offsetDays < 0` → `"before"` ; `>= 0` → `"on_or_after"` (RG-M10-09). */
  offsetSign: "before" | "on_or_after";
  /** `step.sendAt`, sinon `sendWindow.preferredTime`. */
  sendAt?: string;
  sendWindow: SendWindow;
  holidays: readonly HolidayLike[];
  timeZone: string;
  /** Horloge injectée (jamais `new Date()` dans `core`). */
  now: Date;
  siteId?: string | null;
}

/**
 * RG-M10-09 — calcule l'instant UTC d'envoi d'un palier : jour ouvré (fenêtre + jours fériés),
 * avancé/reculé selon le signe du décalage, heure imposée ou `preferredTime`, jamais dans le
 * passé (un palier en rattrapage est ramené à aujourd'hui), et replanifié au lendemain ouvré si la
 * fenêtre du jour est déjà fermée.
 */
export function nextSendSlot(input: NextSendSlotInput): Date {
  const { sendWindow, holidays, timeZone, now, offsetSign } = input;
  const siteId = input.siteId ?? null;
  const todayKey = toDateKey(now, timeZone);
  const targetKey = toDateKey(input.targetDate, timeZone);

  const isPast = targetKey < todayKey;
  const baseKey = isPast ? todayKey : targetKey;
  const effectiveSign: "before" | "on_or_after" = isPast ? "on_or_after" : offsetSign;

  const businessKey = resolveBusinessDayKey(
    baseKey,
    effectiveSign,
    sendWindow,
    holidays,
    timeZone,
    siteId,
    todayKey,
  );

  const timeStr = input.sendAt ?? sendWindow.preferredTime;
  let candidate = combineDayAndTime(businessKey, timeStr, timeZone);

  if (candidate.getTime() <= now.getTime()) {
    const stillOpenToday =
      businessKey === todayKey && formatInTimeZone(now, timeZone, "HH:mm") < sendWindow.to;
    if (stillOpenToday) {
      return now;
    }
    const nextKey = nextSendableDayAfter(businessKey, sendWindow, holidays, timeZone, siteId);
    candidate = combineDayAndTime(nextKey, sendWindow.preferredTime, timeZone);
  }

  return candidate;
}

function resolveBusinessDayKey(
  dayKey: string,
  sign: "before" | "on_or_after",
  sendWindow: Pick<SendWindow, "days">,
  holidays: readonly HolidayLike[],
  timeZone: string,
  siteId: string | null,
  todayKey: string,
): string {
  if (isSendableDay(dayKey, sendWindow, holidays, timeZone, siteId)) return dayKey;

  if (sign === "before") {
    let earlier = keyPlusCalendarDays(dayKey, -1);
    let guard = 0;
    while (earlier >= todayKey && guard < 60) {
      if (isSendableDay(earlier, sendWindow, holidays, timeZone, siteId)) return earlier;
      earlier = keyPlusCalendarDays(earlier, -1);
      guard += 1;
    }
    // Aucun jour ouvré antérieur disponible (déjà passé) : on recule au suivant.
  }

  return nextSendableDayAfter(dayKey, sendWindow, holidays, timeZone, siteId);
}

// ───────────────────────── RG-M10-19 — expiration d'une validation ─────────────────────────

/**
 * RG-M10-19 — une relance `NEEDS_APPROVAL` non traitée expire à
 * `min(t(palier suivant) − 1 j, t(palier) + 7 j)`.
 */
export function approvalExpiry(
  steps: readonly ReminderStep[],
  anchors: AnchorDates,
  step: ReminderStep,
  expiresAfterDays = 7,
): Date {
  const sorted = [...steps].sort(
    (a, b) => targetDate(anchors, a).getTime() - targetDate(anchors, b).getTime(),
  );
  const index = sorted.findIndex((s) => s.key === step.key);
  const next = sorted[index + 1];
  const byCatchUp = addDays(targetDate(anchors, step), expiresAfterDays);
  if (!next) return byCatchUp;
  const beforeNext = addDays(targetDate(anchors, next), -1);
  return beforeNext.getTime() < byCatchUp.getTime() ? beforeNext : byCatchUp;
}
