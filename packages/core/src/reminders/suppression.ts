import { addDays, addHours } from "date-fns";
import { DomainError } from "../errors";
import type { ReminderType } from "./types";

// ───────────────────────── RG-M10-23 — liste blanche `stopOn` ─────────────────────────

/**
 * RG-M10-22/23 — noms d'événements acceptés dans `ReminderRule.stopOn`. Toute autre valeur est
 * rejetée par le validateur.
 */
export const REMINDER_STOP_EVENTS = [
  "appointment.created",
  "appointment.cancelled",
  "appointment.no_show",
  "repair_order.created",
  "vehicle.inspection_updated",
  "vehicle.service_recorded",
  "vehicle.owner_changed",
  "payment.received",
  "collection.promised",
  "collection.disputed",
  "collection.paused",
  "quote.accepted",
  "quote.declined",
  "quote.expired",
  "message.inbound_received",
  "customer.updated",
] as const;

export type ReminderStopEvent = (typeof REMINDER_STOP_EVENTS)[number];

export function isValidStopEvent(value: string): value is ReminderStopEvent {
  return (REMINDER_STOP_EVENTS as readonly string[]).includes(value);
}

/** RG-M10-23 — lève une `DomainError` si `stopOn` contient une valeur hors liste blanche. */
export function validateStopOn(stopOn: readonly string[]): void {
  const invalid = stopOn.filter((event) => !isValidStopEvent(event));
  if (invalid.length > 0) {
    throw new DomainError(
      "reminders.invalid_stop_event",
      `Événement(s) d'arrêt inconnu(s) : ${invalid.join(", ")}`,
      {
        invalid,
      },
    );
  }
}

// ───────────────────────── RG-M10-21 — suppressions ─────────────────────────

export interface ReminderSuppressionRecord {
  sequenceKey?: string | null;
  customerId?: string | null;
  vehicleId?: string | null;
  type?: ReminderType | null;
  /** `null`/`undefined` = permanente. */
  until?: Date | null;
}

export interface SuppressionTarget {
  sequenceKey: string;
  customerId: string;
  vehicleId?: string | null;
  type: ReminderType;
}

/**
 * RG-M10-21 — une suppression couvre une cible si elle correspond par `sequenceKey`, ou par
 * `(customerId, type)`, ou par `(vehicleId, type)`, et n'est pas expirée (`until` dépassé).
 */
export function isSuppressed(
  target: SuppressionTarget,
  suppressions: readonly ReminderSuppressionRecord[],
  now: Date,
): boolean {
  return suppressions.some((s) => {
    if (s.until && s.until.getTime() <= now.getTime()) return false;
    if (s.sequenceKey && s.sequenceKey === target.sequenceKey) return true;
    if (s.customerId && s.type && s.customerId === target.customerId && s.type === target.type) {
      return true;
    }
    if (
      s.vehicleId &&
      s.type &&
      target.vehicleId &&
      s.vehicleId === target.vehicleId &&
      s.type === target.type
    ) {
      return true;
    }
    return false;
  });
}

/** RG-M10-21 — portée obligatoire : `sequenceKey`, ou `customerId`+`type`, ou `vehicleId`+`type`. */
export function assertValidSuppressionScope(record: ReminderSuppressionRecord): void {
  const hasSequence = Boolean(record.sequenceKey);
  const hasCustomerScope = Boolean(record.customerId) && Boolean(record.type);
  const hasVehicleScope = Boolean(record.vehicleId) && Boolean(record.type);
  if (!hasSequence && !hasCustomerScope && !hasVehicleScope) {
    throw new DomainError(
      "reminders.invalid_suppression_scope",
      "Une suppression doit porter sur une séquence, ou sur (client, type), ou sur (véhicule, type).",
      { record },
    );
  }
}

// ───────────────────────── Constructeurs purs (RG-M10-21/22) ─────────────────────────

const SUPPRESSED_BY_APPOINTMENT: readonly ReminderType[] = [
  "INSPECTION",
  "SERVICE",
  "QUOTE_FOLLOWUP",
];

/**
 * RG-M10-22 — `appointment.created`/`repair_order.created` : suppression jusqu'à
 * `startsAt + 1 j` sur `INSPECTION`/`SERVICE`/`QUOTE_FOLLOWUP` du véhicule.
 */
export function buildAppointmentSuppressions(input: {
  vehicleId: string;
  startsAt: Date;
  source: "appointment" | "repair_order";
}): ReminderSuppressionRecord[] {
  const until = addDays(input.startsAt, 1);
  return SUPPRESSED_BY_APPOINTMENT.map((type) => ({
    vehicleId: input.vehicleId,
    type,
    until,
  }));
}

/**
 * RG-M10-22 — `vehicle.inspection_updated`/`vehicle.service_recorded` : suppression permanente de
 * l'ancienne séquence (nouvelle ancre ⇒ nouvelle séquence planifiée normalement).
 */
export function buildAnchorChangedSuppression(oldSequenceKey: string): ReminderSuppressionRecord {
  return { sequenceKey: oldSequenceKey, until: null };
}

/**
 * RG-M10-22 — `vehicle.owner_changed` : suppression permanente pour l'ancien propriétaire sur ce
 * véhicule et ce type (le nouveau propriétaire reprend au palier suivant non envoyé).
 */
export function buildOwnerChangedSuppression(
  vehicleId: string,
  type: ReminderType,
): ReminderSuppressionRecord {
  return { vehicleId, type, until: null };
}

/** RG-M10-20/21 — action manuelle « Arrêter la séquence » : suppression permanente de la séquence. */
export function buildStopSequenceSuppression(sequenceKey: string): ReminderSuppressionRecord {
  return { sequenceKey, until: null };
}

/**
 * RG-M10-22 — réponse entrante (hors STOP) : la séquence concernée est suspendue
 * `pauseOnReplyHours` (défaut 48 h) pour laisser l'humain répondre.
 */
export function buildReplyPauseSuppression(
  sequenceKey: string,
  now: Date,
  pauseOnReplyHours = 48,
): ReminderSuppressionRecord {
  return { sequenceKey, until: addHours(now, pauseOnReplyHours) };
}

/**
 * RG-M10-22 — `appointment.cancelled`/RDV `NO_SHOW` : la suppression est levée, la séquence
 * reprend au palier suivant (pas de rattrapage). Ici : retire simplement les suppressions
 * couvrant cette `sequenceKey` de la liste active.
 */
export function liftSuppressionsForSequence(
  suppressions: readonly ReminderSuppressionRecord[],
  sequenceKey: string,
): ReminderSuppressionRecord[] {
  return suppressions.filter((s) => s.sequenceKey !== sequenceKey);
}
