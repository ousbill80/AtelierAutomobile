// RG-M03-08 — textes des messages transactionnels de RDV (confirmation, déplacement,
// annulation, absence, confirmation groupée). Envoyés via M11 (`messagingEnqueue`) ; quand
// l'organisation a un modèle `rdv_confirm` actif, c'est lui qui est utilisé pour la confirmation.
import { formatInTimeZone } from "date-fns-tz";
import type { AppointmentTypeKey } from "./types";

const WEEKDAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** « samedi 24/10/2026 » */
export function formatDayFr(date: Date, timeZone: string): string {
  const weekday = Number(formatInTimeZone(date, timeZone, "i")) % 7;
  return `${WEEKDAYS_FR[weekday]} ${formatInTimeZone(date, timeZone, "dd/MM/yyyy")}`;
}

export function formatTimeFr(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "HH:mm");
}

/** Complément « pour la révision de votre … » (US-M03-01). */
export const APPOINTMENT_PURPOSE_FR: Record<AppointmentTypeKey, string> = {
  SERVICE: "la révision",
  INSPECTION_PREP: "la pré-visite technique",
  REPAIR: "la réparation",
  DIAGNOSTIC: "le diagnostic",
  BODYWORK: "l'expertise carrosserie",
  TIRES: "les pneus",
  OTHER: "l'intervention",
};

/** Objet du no-show « reprogrammer votre révision ». */
const RESCHEDULE_OBJECT_FR: Record<AppointmentTypeKey, string> = {
  SERVICE: "votre révision",
  INSPECTION_PREP: "votre pré-visite technique",
  REPAIR: "votre réparation",
  DIAGNOSTIC: "votre diagnostic",
  BODYWORK: "votre expertise carrosserie",
  TIRES: "votre changement de pneus",
  OTHER: "votre rendez-vous",
};

export interface AppointmentMessageInput {
  salutation: string;
  garageName: string;
  type: AppointmentTypeKey;
  startsAt: Date;
  timeZone: string;
  vehicle?: { make: string; model: string; plate: string } | null;
  link?: string | null;
  garagePhone?: string | null;
}

function vehiclePart(vehicle: AppointmentMessageInput["vehicle"]): string {
  if (!vehicle) return "";
  return ` de votre ${[vehicle.make, vehicle.model].filter(Boolean).join(" ")} (${vehicle.plate})`;
}

export function confirmationMessage(input: AppointmentMessageInput): string {
  return (
    `Bonjour ${input.salutation}, votre RDV chez ${input.garageName} est confirmé le ` +
    `${formatDayFr(input.startsAt, input.timeZone)} à ${formatTimeFr(input.startsAt, input.timeZone)} ` +
    `pour ${APPOINTMENT_PURPOSE_FR[input.type]}${vehiclePart(input.vehicle)}. ` +
    `Répondez 1 pour confirmer, 2 pour déplacer.` +
    (input.link ? ` Gérer votre RDV : ${input.link}` : "")
  );
}

export function rescheduledMessage(input: AppointmentMessageInput): string {
  return (
    `Bonjour ${input.salutation}, votre RDV a été déplacé au ` +
    `${formatDayFr(input.startsAt, input.timeZone)} à ${formatTimeFr(input.startsAt, input.timeZone)}. ` +
    `${input.garageName}` +
    (input.link ? ` — ${input.link}` : "")
  );
}

export function cancelledMessage(input: AppointmentMessageInput): string {
  return (
    `Bonjour ${input.salutation}, votre RDV du ${formatDayFr(input.startsAt, input.timeZone)} à ` +
    `${formatTimeFr(input.startsAt, input.timeZone)} chez ${input.garageName} est annulé.` +
    (input.link ? ` Pour reprogrammer : ${input.link}` : "") +
    (input.garagePhone ? ` Tél. ${input.garagePhone}` : "")
  );
}

export function noShowMessage(input: AppointmentMessageInput): string {
  return (
    `Bonjour ${input.salutation}, nous ne vous avons pas vu aujourd'hui. Souhaitez-vous ` +
    `reprogrammer ${RESCHEDULE_OBJECT_FR[input.type]} ?` +
    (input.link ? ` ${input.link}` : "") +
    ` ${input.garageName}`
  );
}

export function reminderNowMessage(input: AppointmentMessageInput): string {
  return (
    `Bonjour ${input.salutation}, rappel de votre RDV chez ${input.garageName} le ` +
    `${formatDayFr(input.startsAt, input.timeZone)} à ${formatTimeFr(input.startsAt, input.timeZone)}` +
    `${vehiclePart(input.vehicle)}. Répondez 1 pour confirmer, 2 pour déplacer, 3 pour annuler.`
  );
}

/** RG-M03-14 : une seule confirmation listant tous les véhicules du groupe. */
export function batchConfirmationMessage(input: {
  salutation: string;
  garageName: string;
  type: AppointmentTypeKey;
  timeZone: string;
  items: ReadonlyArray<{ plate: string; startsAt: Date }>;
}): string {
  const first = input.items[0];
  const day = first ? formatDayFr(first.startsAt, input.timeZone) : "";
  const lines = input.items
    .map((i) => `- ${i.plate} à ${formatTimeFr(i.startsAt, input.timeZone)}`)
    .join("\n");
  return (
    `Bonjour ${input.salutation}, ${input.items.length} RDV sont confirmés chez ${input.garageName} ` +
    `le ${day} pour ${APPOINTMENT_PURPOSE_FR[input.type]} :\n${lines}`
  );
}
