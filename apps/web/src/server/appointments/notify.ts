// RG-M03-08 — confirmations et messages « déplacé »/« annulé » : transactionnels, envoyés
// même si le client est désinscrit des relances (M11, `kind: "transactional"`). Pas de
// `MessageTemplate` dédié ici : le corps est construit directement, comme l'exemple du PRD.
import { formatInTimeZone } from "date-fns-tz";
import type { Channel } from "@atelieros/core";
import type { ScopedTenantClient } from "@atelieros/db";
import { messagingEnqueue, type EnqueueRequest } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";

type TenantDb = ScopedTenantClient;

export interface NotifyCustomerLike {
  id: string;
  phone: string | null;
  whatsappPhone: string | null;
  email: string | null;
  displayName: string;
}

export interface NotifyVehicleLike {
  plate: string;
  make: string;
  model: string;
}

const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  SERVICE: "la révision",
  INSPECTION_PREP: "la pré-visite technique",
  REPAIR: "la réparation",
  DIAGNOSTIC: "le diagnostic",
  BODYWORK: "l'expertise carrosserie",
  TIRES: "le contrôle pneus",
  OTHER: "le rendez-vous",
};

function formatSlot(startsAt: Date, timeZone: string): { date: string; time: string } {
  return {
    date: formatInTimeZone(startsAt, timeZone, "EEEE dd/MM/yyyy"),
    time: formatInTimeZone(startsAt, timeZone, "HH:mm"),
  };
}

async function sendTransactional(
  tx: TenantDb,
  organizationId: string,
  idempotencyKey: string,
  customer: NotifyCustomerLike,
  body: string,
): Promise<void> {
  const channels: Channel[] = ["WHATSAPP", "SMS", "EMAIL"];
  const req: EnqueueRequest = {
    idempotencyKey,
    kind: "transactional",
    customerId: customer.id,
    to: {
      phone: customer.phone,
      whatsapp: customer.whatsappPhone ?? customer.phone,
      email: customer.email,
      name: customer.displayName,
    },
    channels,
    bodyOverride: body,
  };
  const result = await messagingEnqueue(tx, organizationId, req);
  if (result.created) await enqueueMessageSendJob(result.message.id);
}

export async function notifyAppointmentConfirmation(
  tx: TenantDb,
  organizationId: string,
  appointmentId: string,
  startsAt: Date,
  type: string,
  timeZone: string,
  organizationName: string,
  customer: NotifyCustomerLike,
  vehicle: NotifyVehicleLike | null,
): Promise<void> {
  const { date, time } = formatSlot(startsAt, timeZone);
  const label = APPOINTMENT_TYPE_LABELS[type] ?? "le rendez-vous";
  const vehiclePart = vehicle
    ? ` de votre ${vehicle.make} ${vehicle.model} (${vehicle.plate})`
    : "";
  const body =
    `Bonjour ${customer.displayName}, votre RDV chez ${organizationName} est confirmé le ` +
    `${date} à ${time} pour ${label}${vehiclePart}. Répondez 1 pour confirmer, 2 pour déplacer.`;
  await sendTransactional(tx, organizationId, `apt:confirm:${appointmentId}`, customer, body);
}

export async function notifyAppointmentRescheduled(
  tx: TenantDb,
  organizationId: string,
  appointmentId: string,
  startsAt: Date,
  timeZone: string,
  customer: NotifyCustomerLike,
): Promise<void> {
  const { date, time } = formatSlot(startsAt, timeZone);
  const body = `Votre RDV a été déplacé au ${date} à ${time}.`;
  await sendTransactional(
    tx,
    organizationId,
    `apt:moved:${appointmentId}:${startsAt.getTime()}`,
    customer,
    body,
  );
}

export async function notifyAppointmentBatchConfirmation(
  tx: TenantDb,
  organizationId: string,
  groupId: string,
  timeZone: string,
  organizationName: string,
  customer: NotifyCustomerLike,
  placements: readonly { plate: string; startsAt: Date }[],
): Promise<void> {
  const lines = placements
    .map((p) => {
      const { date, time } = formatSlot(p.startsAt, timeZone);
      return `${p.plate} : ${date} à ${time}`;
    })
    .join(" · ");
  const body =
    `Bonjour ${customer.displayName}, ${placements.length} RDV confirmés chez ${organizationName} — ` +
    `${lines}.`;
  await sendTransactional(tx, organizationId, `apt:batch:${groupId}`, customer, body);
}

/** "Envoyer un rappel maintenant" (§7) : un rappel manuel, à la demande, donc jamais dédoublonné
 * avec la confirmation initiale (clé d'idempotence propre, horodatée). */
export async function notifyAppointmentReminderNow(
  tx: TenantDb,
  organizationId: string,
  appointmentId: string,
  startsAt: Date,
  timeZone: string,
  organizationName: string,
  customer: NotifyCustomerLike,
): Promise<string | null> {
  const { date, time } = formatSlot(startsAt, timeZone);
  const body = `Rappel : votre RDV chez ${organizationName} est prévu le ${date} à ${time}.`;
  const idempotencyKey = `apt:remind:${appointmentId}:${Date.now()}`;
  const channels: Channel[] = ["WHATSAPP", "SMS", "EMAIL"];
  const result = await messagingEnqueue(tx, organizationId, {
    idempotencyKey,
    kind: "transactional",
    customerId: customer.id,
    to: {
      phone: customer.phone,
      whatsapp: customer.whatsappPhone ?? customer.phone,
      email: customer.email,
      name: customer.displayName,
    },
    channels,
    bodyOverride: body,
  });
  if (!result.created) return null;
  await enqueueMessageSendJob(result.message.id);
  return result.message.id;
}

export async function notifyAppointmentCancelled(
  tx: TenantDb,
  organizationId: string,
  appointmentId: string,
  customer: NotifyCustomerLike,
): Promise<void> {
  const body =
    "Votre RDV a été annulé par le garage. Pour reprogrammer, contactez-nous ou rappelez-nous.";
  await sendTransactional(tx, organizationId, `apt:cancelled:${appointmentId}`, customer, body);
}
