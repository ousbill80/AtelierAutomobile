// Types M03 (rendez-vous et planning) indépendants de Prisma : `packages/core` ne dépend pas
// du client généré (01 §2, règle d'or).

export const APPOINTMENT_TYPES = [
  "SERVICE",
  "INSPECTION_PREP",
  "REPAIR",
  "DIAGNOSTIC",
  "BODYWORK",
  "TIRES",
  "OTHER",
] as const;
export type AppointmentTypeKey = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_STATUSES = [
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "NO_SHOW",
  "CANCELLED",
  "COMPLETED",
] as const;
export type AppointmentStatusKey = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_SOURCES = ["STAFF", "PHONE", "WHATSAPP", "PORTAL", "REMINDER"] as const;
export type AppointmentSourceKey = (typeof APPOINTMENT_SOURCES)[number];

export type BayTypeKey = "LIFT" | "DIAGNOSTIC" | "BODYWORK" | "PAINT" | "WASH" | "OTHER";

export const CONFIRMATION_CHANNELS = ["phone", "whatsapp", "sms", "portal", "in_person"] as const;
export type ConfirmationChannel = (typeof CONFIRMATION_CHANNELS)[number];

/** RG-M03-11 : motifs d'annulation côté garage. */
export const GARAGE_CANCEL_REASONS = [
  "PART_UNAVAILABLE",
  "WORKSHOP_OVERLOADED",
  "MECHANIC_ABSENT",
  "DUPLICATE",
  "OTHER",
] as const;
export type GarageCancelReason = (typeof GARAGE_CANCEL_REASONS)[number];

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

/** RG-M03-02 : statuts qui ne bloquent ni pont ni mécanicien. */
export const NON_BLOCKING_STATUSES: readonly AppointmentStatusKey[] = ["CANCELLED", "NO_SHOW"];

/** Statuts « actifs » : RDV à venir encore attendus (rappels, retards, no-show). */
export const PENDING_STATUSES: readonly AppointmentStatusKey[] = ["BOOKED", "CONFIRMED"];

export type HalfDay = "AM" | "PM";
