import { fr } from "date-fns/locale/fr";
import { formatInTimeZone } from "date-fns-tz";
import type { AppointmentType } from "./types";

/** Libellés métier des types de RDV, utilisés dans les messages envoyés aux clients (M03 §7). */
export const APPOINTMENT_TYPE_MESSAGE_LABELS: Record<AppointmentType, string> = {
  SERVICE: "la révision",
  INSPECTION_PREP: "la pré-visite technique",
  REPAIR: "la réparation",
  DIAGNOSTIC: "le diagnostic",
  BODYWORK: "l'expertise carrosserie",
  TIRES: "les pneus",
  OTHER: "le rendez-vous",
};

/** « samedi 24/10/2026 à 09:00 » dans le fuseau de l'organisation (RG-M03-15). */
export function formatAppointmentDateTime(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "EEEE dd/MM/yyyy 'à' HH:mm", { locale: fr });
}

/** « samedi 24/10/2026 » */
export function formatAppointmentDay(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "EEEE dd/MM/yyyy", { locale: fr });
}

/** « 09:00 » */
export function formatAppointmentTime(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "HH:mm");
}

export interface AppointmentMessageContext {
  /** « M. Kouassi », « Mme Bamba », « SOTRA Logistique ». */
  customerGreeting: string;
  garageName: string;
  startsAt: Date;
  timeZone: string;
  type: AppointmentType;
  /** « Toyota Corolla (2547 GH 01) » ; `null` si véhicule à identifier. */
  vehicleLabel: string | null;
}

function subject(ctx: AppointmentMessageContext): string {
  const what = APPOINTMENT_TYPE_MESSAGE_LABELS[ctx.type];
  return ctx.vehicleLabel ? `${what} de votre ${ctx.vehicleLabel}` : what;
}

/** US-M03-01 — confirmation immédiate à la création (transactionnel). */
export function renderAppointmentConfirmation(ctx: AppointmentMessageContext): string {
  return (
    `Bonjour ${ctx.customerGreeting}, votre RDV chez ${ctx.garageName} est confirmé le ` +
    `${formatAppointmentDateTime(ctx.startsAt, ctx.timeZone)} pour ${subject(ctx)}. ` +
    `Répondez 1 pour confirmer, 2 pour déplacer.`
  );
}

/** US-M03-03 — déplacement. */
export function renderAppointmentMoved(ctx: AppointmentMessageContext): string {
  return (
    `Bonjour ${ctx.customerGreeting}, votre RDV chez ${ctx.garageName} a été déplacé au ` +
    `${formatAppointmentDateTime(ctx.startsAt, ctx.timeZone)} pour ${subject(ctx)}.`
  );
}

/** RG-M03-08 — annulation par le garage, avec lien pour reprogrammer. */
export function renderAppointmentCancelled(
  ctx: AppointmentMessageContext & { rebookUrl?: string | null },
): string {
  const base =
    `Bonjour ${ctx.customerGreeting}, votre RDV chez ${ctx.garageName} du ` +
    `${formatAppointmentDateTime(ctx.startsAt, ctx.timeZone)} a été annulé.`;
  return ctx.rebookUrl ? `${base} Reprogrammez ici : ${ctx.rebookUrl}` : base;
}

/** RG-M03-08 — rappel J-1 (réponses 1/2/3). */
export function renderAppointmentReminder(ctx: AppointmentMessageContext): string {
  return (
    `Bonjour ${ctx.customerGreeting}, rappel : votre RDV chez ${ctx.garageName} est demain, le ` +
    `${formatAppointmentDateTime(ctx.startsAt, ctx.timeZone)}, pour ${subject(ctx)}. ` +
    `Répondez 1 pour confirmer, 2 pour déplacer, 3 pour annuler.`
  );
}

/** US-M03-09 — proposition de reprogrammation après absence. */
export function renderAppointmentNoShow(
  ctx: AppointmentMessageContext & { rebookUrl?: string | null },
): string {
  const what = APPOINTMENT_TYPE_MESSAGE_LABELS[ctx.type];
  const base = `Bonjour ${ctx.customerGreeting}, nous ne vous avons pas vu aujourd'hui chez ${ctx.garageName}. Souhaitez-vous reprogrammer ${what} ?`;
  return ctx.rebookUrl ? `${base} ${ctx.rebookUrl}` : base;
}

export interface GroupConfirmationContext {
  contactGreeting: string;
  garageName: string;
  timeZone: string;
  items: ReadonlyArray<{ plate: string; startsAt: Date }>;
}

/** RG-M03-14 — une seule confirmation listant les plaques et heures d'un groupe de RDV. */
export function renderGroupConfirmation(ctx: GroupConfirmationContext): string {
  const sorted = [...ctx.items].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const day = sorted[0] ? formatAppointmentDay(sorted[0].startsAt, ctx.timeZone) : "";
  const lines = sorted.map(
    (item) => `- ${item.plate} à ${formatAppointmentTime(item.startsAt, ctx.timeZone)}`,
  );
  return (
    `Bonjour ${ctx.contactGreeting}, vos ${sorted.length} RDV chez ${ctx.garageName} sont confirmés le ${day} :\n` +
    lines.join("\n")
  );
}

/** « M. Kouassi », « Mme Bamba », ou le nom affiché pour une entreprise / sans civilité. */
export function customerGreeting(input: {
  civility: "M" | "MME" | "MLLE" | null | undefined;
  lastName: string | null | undefined;
  displayName: string;
}): string {
  if (input.civility && input.lastName) {
    const prefix = input.civility === "M" ? "M." : input.civility === "MME" ? "Mme" : "Mlle";
    return `${prefix} ${input.lastName}`;
  }
  return input.displayName;
}
