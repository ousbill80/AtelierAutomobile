// Libellés français et petits utilitaires partagés par les écrans du module M10 (relances) :
// /relances, /relances/echeances, /parametres/relances et les blocs « Relances » des fiches
// client/véhicule. Regroupés ici pour éviter de dupliquer ces constantes dans chaque fichier.
import type { StatusTone } from "@atelieros/ui";
import { t } from "@/i18n/t";

/** Libellés d'une branche de messages/fr.json, indexés par code (types, statuts…). */
function labelsOf<K extends string>(prefix: string, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((key) => [key, t(`${prefix}.${key}`)])) as Record<K, string>;
}

export const REMINDER_TYPE_LABELS: Record<string, string> = labelsOf("reminders.types", [
  "INSPECTION",
  "SERVICE",
  "RECEIVABLE",
  "APPOINTMENT",
  "QUOTE_FOLLOWUP",
  "VEHICLE_READY",
  "INSURANCE_EXPIRY",
  "SATISFACTION",
  "RECOMMENDED_WORK",
  "CUSTOM",
] as const);

export const REMINDER_CHANNEL_LABELS: Record<string, string> = labelsOf("common.channels", [
  "WHATSAPP",
  "SMS",
  "EMAIL",
] as const);

// Pas de `Record<string, string>` ici : la page /relances dérive son type `Tab` des clés de cet
// objet (`keyof typeof`), qui doivent donc rester des littéraux.
export const REMINDER_TAB_LABELS = labelsOf("reminders.queue.tabs", [
  "TO_APPROVE",
  "PLANNED_TODAY",
  "SENT_TODAY",
  "FAILED",
  "TO_CALL",
  "EXPIRED",
] as const);

export const REMINDER_STOP_EVENT_LABELS: Record<string, string> = labelsOf("reminders.stopEvents", [
  "appointment.created",
  "appointment.cancelled",
  "appointment.updated",
  "repair_order.created",
  "vehicle.inspection_updated",
  "vehicle.service_recorded",
  "vehicle.owner_changed",
  "vehicle.insurance_updated",
  "payment.received",
  "collection.promised",
  "collection.disputed",
  "collection.paused",
  "quote.accepted",
  "quote.declined",
  "quote.expired",
  "repair_order.status_changed",
  "message.inbound_received",
  "customer.updated",
] as const);

export const DUE_DATES_FILTER_LABELS: Record<string, string> = labelsOf(
  "reminders.dueFilterLabels",
  ["ALL", "UPCOMING", "EXPIRED", "MISSING_DATA"] as const,
);

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("fr-FR");
}

/** Dérive un statut d'échéance simple côté client (RG-M02-12/§5) à partir d'une date. */
export function computeDueStatus(date: Date | string | null | undefined): {
  status: "UNKNOWN" | "OK" | "DUE_SOON" | "EXPIRED";
  daysRemaining: number | null;
} {
  if (!date) return { status: "UNKNOWN", daysRemaining: null };
  const d = typeof date === "string" ? new Date(date) : date;
  const days = Math.floor((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { status: "EXPIRED", daysRemaining: days };
  if (days <= 30) return { status: "DUE_SOON", daysRemaining: days };
  return { status: "OK", daysRemaining: days };
}

/** Couleur du badge de statut d'une relance (toujours accompagnée du libellé). */
export function reminderStatusTone(status: string): StatusTone {
  switch (status) {
    case "SENT":
      return "ok";
    case "FAILED":
      return "bad";
    case "SKIPPED":
    case "NEEDS_APPROVAL":
      return "warn";
    default:
      return "off";
  }
}
