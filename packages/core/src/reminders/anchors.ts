import { addDays, addMonths, differenceInCalendarDays } from "date-fns";
import { DomainError } from "../errors";
import {
  DEFAULT_EXCLUDE_TAGS,
  DEFAULT_MIN_RECEIVABLE_AMOUNT,
  TRANSACTIONAL_REMINDER_TYPES,
  type ReminderType,
} from "./types";

// ───────────────────────── RG-M10-01 — candidats par type ─────────────────────────

/** Fenêtres de candidature par type (RG-M10-01). Types absents = éligibilité pilotée par statut, pas par fenêtre de date. */
const CANDIDATE_WINDOW_DAYS: Partial<
  Record<ReminderType, { beforeToday: number; afterToday: number }>
> = {
  INSPECTION: { beforeToday: 60, afterToday: 45 },
  SERVICE: { beforeToday: 90, afterToday: 30 },
  INSURANCE_EXPIRY: { beforeToday: 0, afterToday: 30 },
};

/** RG-M10-01 — l'ancre est-elle dans la fenêtre de candidature de son type (quand une fenêtre de date s'applique) ? */
export function isWithinCandidateWindow(type: ReminderType, anchor: Date, today: Date): boolean {
  const window = CANDIDATE_WINDOW_DAYS[type];
  if (!window) return true; // éligibilité pilotée par statut (RECEIVABLE, APPOINTMENT, QUOTE_FOLLOWUP, VEHICLE_READY, SATISFACTION)
  const diff = differenceInCalendarDays(anchor, today); // > 0 si l'ancre est dans le futur
  return diff >= -window.beforeToday && diff <= window.afterToday;
}

// ───────────────────────── RG-M10-08 — échéance de révision ─────────────────────────

export interface MileageReading {
  date: Date;
  mileage: number;
}

export interface EstimateAvgKmPerDayOptions {
  /** Bornes RG-M10-08, défaut [5, 300]. */
  minKmPerDay?: number;
  maxKmPerDay?: number;
  /** Fenêtre d'observation, défaut 365 j. */
  lookbackDays?: number;
  /** Écart minimal entre le premier et le dernier relevé retenu, défaut 30 j. */
  minSpanDays?: number;
}

/**
 * RG-M10-08 — pente km/j entre le premier et le dernier relevé fiable des `lookbackDays` derniers
 * jours. Relevés décroissants ignorés ; `null` si aucune pente fiable (moins de 2 relevés valides
 * ou écart < `minSpanDays`). La valeur retenue est bornée à [min, max] km/j.
 */
export function estimateAvgKmPerDay(
  readings: readonly MileageReading[],
  now: Date,
  options: EstimateAvgKmPerDayOptions = {},
): number | null {
  const minKmPerDay = options.minKmPerDay ?? 5;
  const maxKmPerDay = options.maxKmPerDay ?? 300;
  const lookbackDays = options.lookbackDays ?? 365;
  const minSpanDays = options.minSpanDays ?? 30;

  const inWindow = readings
    .filter((r) => differenceInCalendarDays(now, r.date) <= lookbackDays && r.date <= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Relevés décroissants ignorés (compteur changé ou erreur de saisie) : on ne garde qu'une
  // séquence non décroissante.
  const kept: MileageReading[] = [];
  for (const reading of inWindow) {
    const last = kept[kept.length - 1];
    if (!last || reading.mileage >= last.mileage) {
      kept.push(reading);
    }
  }

  if (kept.length < 2) return null;
  const first = kept[0] as MileageReading;
  const last = kept[kept.length - 1] as MileageReading;
  const spanDays = differenceInCalendarDays(last.date, first.date);
  if (spanDays < minSpanDays) return null;

  const rawSlope = (last.mileage - first.mileage) / spanDays;
  return Math.min(Math.max(rawSlope, minKmPerDay), maxKmPerDay);
}

export interface ComputeServiceDueInput {
  lastServiceDate: Date | null;
  lastServiceMileage: number | null;
  /** Déjà résolu (surcharge véhicule puis défauts organisation, RG-M10-08). */
  serviceIntervalMonths: number | null;
  serviceIntervalKm: number | null;
  /** Dernier relevé kilométrique fiable utilisé comme base de projection. */
  refDate: Date | null;
  refMileage: number | null;
  /** `null` = pas de pente fiable (RG-M10-08 : on ne relance jamais sur une estimation non fondée). */
  avgKmPerDay: number | null;
}

export interface ServiceDueResult {
  nextServiceDueDate: Date | null;
  nextServiceDueMileage: number | null;
  /** Quelle base a déterminé `nextServiceDueDate`. */
  basis: "date" | "km" | null;
  /** Aucune base de calcul disponible → « Données incomplètes », pas de relance (RG-M10-08). */
  incomplete: boolean;
}

/** RG-M10-08 — échéance de révision, date OU kilométrage (le premier atteint). */
export function computeServiceDue(input: ComputeServiceDueInput): ServiceDueResult {
  const dateDue =
    input.lastServiceDate && input.serviceIntervalMonths
      ? addMonths(input.lastServiceDate, input.serviceIntervalMonths)
      : null;

  const kmDue =
    input.lastServiceMileage != null && input.serviceIntervalKm
      ? input.lastServiceMileage + input.serviceIntervalKm
      : null;

  const kmDate =
    kmDue != null && input.avgKmPerDay != null && input.refDate != null && input.refMileage != null
      ? addDays(input.refDate, Math.ceil((kmDue - input.refMileage) / input.avgKmPerDay))
      : null;

  let nextServiceDueDate: Date | null;
  let basis: "date" | "km" | null;
  if (dateDue && kmDate) {
    if (dateDue.getTime() <= kmDate.getTime()) {
      nextServiceDueDate = dateDue;
      basis = "date";
    } else {
      nextServiceDueDate = kmDate;
      basis = "km";
    }
  } else if (dateDue) {
    nextServiceDueDate = dateDue;
    basis = "date";
  } else if (kmDate) {
    nextServiceDueDate = kmDate;
    basis = "km";
  } else {
    nextServiceDueDate = null;
    basis = null;
  }

  return {
    nextServiceDueDate,
    nextServiceDueMileage: kmDue,
    basis,
    incomplete: nextServiceDueDate === null,
  };
}

export interface ServiceDefaults {
  months: number;
  km: number;
}

export interface FuelServiceOverrides {
  diesel?: Partial<ServiceDefaults>;
  essence?: Partial<ServiceDefaults>;
}

/** RG-M10-08 — intervalle de révision effectif : surcharge véhicule, sinon défauts organisation (par carburant si configuré). */
export function resolveServiceInterval(
  vehicle: {
    serviceIntervalMonths?: number | null;
    serviceIntervalKm?: number | null;
    fuelType?: "diesel" | "essence" | string | null;
  },
  orgDefaults: ServiceDefaults,
  fuelOverrides: FuelServiceOverrides = {},
): ServiceDefaults {
  const fuelDefault =
    vehicle.fuelType === "diesel"
      ? fuelOverrides.diesel
      : vehicle.fuelType === "essence"
        ? fuelOverrides.essence
        : undefined;
  return {
    months: vehicle.serviceIntervalMonths ?? fuelDefault?.months ?? orgDefaults.months,
    km: vehicle.serviceIntervalKm ?? fuelDefault?.km ?? orgDefaults.km,
  };
}

// ───────────────────────── RG-M10-30 — garde-fous de données ─────────────────────────

/** RG-M10-30 — « Date de VT suspecte » (inversion jour/mois fréquente à l'import). */
export function isInspectionDateSuspect(
  input: { inspectionExpiryDate: Date | null; inspectionLastDate: Date | null },
  now: Date,
): boolean {
  const { inspectionExpiryDate, inspectionLastDate } = input;
  if (inspectionExpiryDate) {
    const twoYearsOut = addMonths(now, 24);
    if (inspectionExpiryDate.getTime() > twoYearsOut.getTime()) return true;
  }
  if (
    inspectionLastDate &&
    inspectionExpiryDate &&
    inspectionLastDate.getTime() > inspectionExpiryDate.getTime()
  ) {
    return true;
  }
  return false;
}

/** RG-M10-30 — expiration estimée à partir de la dernière VT connue (marquée « estimée » dans l'aperçu). */
export function estimateInspectionExpiry(lastDate: Date, validityMonths: number): Date {
  return addMonths(lastDate, validityMonths);
}

// ───────────────────────── RG-M10-04 — éligibilité ─────────────────────────

export interface EligibilityContext {
  customerType: "INDIVIDUAL" | "COMPANY";
  deletedAt: Date | null;
  doNotRemind: boolean;
  remindersConsent: boolean;
  /** Adresse candidate déjà présente dans `OptOut` (résolu par l'appelant). */
  isOptedOut: boolean;
  tags: readonly string[];
  siteId?: string | null;
  vehicleYear?: number | null;
  /** Montant en retard pertinent (RECEIVABLE uniquement). */
  amount?: number | null;
}

export interface EligibilityConditions {
  customerTypes?: Array<"INDIVIDUAL" | "COMPANY">;
  minAmount?: number;
  tags?: readonly string[];
  excludeTags?: readonly string[];
  siteIds?: readonly string[];
  vehicleMinYear?: number;
}

/** RG-M10-04 — un client/véhicule est-il éligible à une relance d'un `type` donné ? */
export function isEligible(
  type: ReminderType,
  ctx: EligibilityContext,
  conditions: EligibilityConditions = {},
): boolean {
  if (ctx.deletedAt) return false;

  const isTransactional = TRANSACTIONAL_REMINDER_TYPES.has(type);
  if (!isTransactional) {
    if (ctx.doNotRemind) return false;
    if (!ctx.remindersConsent) return false;
    if (ctx.isOptedOut) return false;
  }

  if (conditions.customerTypes && !conditions.customerTypes.includes(ctx.customerType)) {
    return false;
  }

  if (type === "RECEIVABLE") {
    const minAmount = conditions.minAmount ?? DEFAULT_MIN_RECEIVABLE_AMOUNT;
    if (ctx.amount != null && ctx.amount < minAmount) return false;
  }

  if (conditions.tags && conditions.tags.length > 0) {
    const hasIncludedTag = conditions.tags.some((tag) => ctx.tags.includes(tag));
    if (!hasIncludedTag) return false;
  }

  const excludeTags = conditions.excludeTags ?? DEFAULT_EXCLUDE_TAGS;
  if (excludeTags.some((tag) => ctx.tags.includes(tag))) return false;

  if (conditions.siteIds && conditions.siteIds.length > 0) {
    if (!ctx.siteId || !conditions.siteIds.includes(ctx.siteId)) return false;
  }

  if (conditions.vehicleMinYear != null && ctx.vehicleYear != null) {
    if (ctx.vehicleYear < conditions.vehicleMinYear) return false;
  }

  return true;
}

/** Garde-fou : une plaque ne doit jamais être relancée en double (RG-M10-30). */
export function assertNoDuplicatePlate(plateOccurrences: number, plate: string): void {
  if (plateOccurrences > 1) {
    throw new DomainError(
      "reminders.duplicate_plate",
      `Véhicule en double : ${plate} (${plateOccurrences} fiches) — fusionner les fiches avant de relancer.`,
      { plate, occurrences: plateOccurrences },
    );
  }
}
