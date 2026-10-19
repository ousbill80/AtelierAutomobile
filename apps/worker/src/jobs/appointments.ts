// M03 §9 — jobs du planning et consommateur d'événements côté RDV.
//
// - `appointments.mark_no_show` : RG-M03-10, NO_SHOW automatique des RDV encore BOOKED/
//   CONFIRMED une fois `noShowJobTime` (20:00 heure locale par défaut) atteinte.
// - `appointments.daily_agenda` : 07:00, agenda du jour (notification interne) au chef
//   d'atelier et aux conseillers. Le WhatsApp optionnel n'est pas envoyé (écart documenté).
// - `appointments.unconfirmed_check` : 18:00, RDV du lendemain non confirmés → « Appels à passer ».
// - `handleAppointmentEvent` : `repair_order.created` (lien RDV → OR, ARRIVED),
//   `repair_order.status_changed` (DELIVERED/INVOICED → COMPLETED), `message.inbound_received`
//   (réponses 1/2/3, US-M03-07). Idempotent : chaque effet vérifie l'état courant.
import {
  addDaysToKey,
  classifyAppointmentReply,
  formatTimeFr,
  localDateKey,
  localMinutes,
  noShowEligibility,
  resolvePlanningConfig,
  systemClock,
  zonedInstant,
  type AppointmentStatusKey,
  type Clock,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { logger } from "../logger";

type TenantDb = ReturnType<typeof db.forTenant>;

/** `organizationIds` : restreint le passage (tests) ; absent = toutes les organisations. */
export interface JobScope {
  organizationIds?: string[];
}

async function forEachOrganization(
  jobName: string,
  scope: JobScope,
  fn: (org: { id: string; timezone: string; settings: unknown }) => Promise<void>,
): Promise<void> {
  const organizations = await adminDb.organization.findMany({
    where: scope.organizationIds ? { id: { in: scope.organizationIds } } : undefined,
    select: { id: true, timezone: true, settings: true },
  });
  for (const org of organizations) {
    try {
      await fn(org);
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        `${jobName} : échec sur une organisation, passage à la suivante`,
      );
    }
  }
}

async function emit(
  tenantDb: TenantDb,
  organizationId: string,
  type: string,
  payload: Record<string, unknown>,
) {
  await tenantDb.domainEvent.create({ data: { organizationId, type, payload: payload as never } });
}

/** Notification interne aux MANAGER/ADVISOR du site, une fois par `dedupeKey`. */
async function notifyStaff(
  tenantDb: TenantDb,
  input: {
    organizationId: string;
    siteId: string;
    type: string;
    title: string;
    body?: string;
    link?: string;
    dedupeKey: string;
  },
) {
  const members = await tenantDb.membership.findMany({
    where: { isActive: true, role: { in: ["MANAGER", "ADVISOR"] } },
    select: { id: true, siteIds: true },
  });
  for (const m of members) {
    if (m.siteIds.length > 0 && !m.siteIds.includes(input.siteId)) continue;
    const existing = await tenantDb.notification.findFirst({
      where: { membershipId: m.id, dedupeKey: input.dedupeKey },
    });
    if (existing) continue;
    await tenantDb.notification.create({
      data: {
        organizationId: input.organizationId,
        membershipId: m.id,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        dedupeKey: input.dedupeKey,
        severity: "info",
      },
    });
  }
}

export async function processMarkNoShowJob(
  clock: Clock = systemClock,
  scope: JobScope = {},
): Promise<number> {
  let total = 0;
  await forEachOrganization("appointments.mark_no_show", scope, async (org) => {
    const now = clock.now();
    const config = resolvePlanningConfig(org.settings);
    const tenantDb = db.forTenant({ organizationId: org.id });
    const candidates = await tenantDb.appointment.findMany({
      where: { status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { lt: now } },
      select: {
        id: true,
        status: true,
        startsAt: true,
        customerId: true,
        vehicleId: true,
        reminderId: true,
      },
    });
    for (const appt of candidates) {
      if (
        !noShowEligibility(
          { status: appt.status as AppointmentStatusKey, startsAt: appt.startsAt },
          now,
          org.timezone,
          config.appointments.noShowJobTime,
        )
      ) {
        continue;
      }
      const updated = await tenantDb.appointment.updateMany({
        where: { id: appt.id, status: { in: ["BOOKED", "CONFIRMED"] } },
        data: { status: "NO_SHOW", noShowAt: now },
      });
      if (updated.count === 0) continue;
      total += 1;
      await tenantDb.reminder.updateMany({
        where: {
          appointmentId: appt.id,
          type: "APPOINTMENT",
          status: { in: ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] },
        },
        data: { status: "CANCELLED", skippedReason: "Client absent." },
      });
      await emit(tenantDb, org.id, "appointment.no_show", {
        appointmentId: appt.id,
        customerId: appt.customerId,
        vehicleId: appt.vehicleId,
        reminderId: appt.reminderId,
        automatic: true,
      });
    }
  });
  return total;
}

export async function processDailyAgendaJob(
  clock: Clock = systemClock,
  scope: JobScope = {},
): Promise<void> {
  await forEachOrganization("appointments.daily_agenda", scope, async (org) => {
    const now = clock.now();
    if (localMinutes(now, org.timezone) < 7 * 60) return;
    const today = localDateKey(now, org.timezone);
    const tenantDb = db.forTenant({ organizationId: org.id });
    const appointments = await tenantDb.appointment.findMany({
      where: {
        startsAt: {
          gte: zonedInstant(today, 0, org.timezone),
          lt: zonedInstant(addDaysToKey(today, 1), 0, org.timezone),
        },
        status: { in: ["BOOKED", "CONFIRMED"] },
      },
      include: { customer: { select: { displayName: true } } },
      orderBy: { startsAt: "asc" },
    });
    const bySite = new Map<string, typeof appointments>();
    for (const a of appointments) bySite.set(a.siteId, [...(bySite.get(a.siteId) ?? []), a]);
    for (const [siteId, list] of bySite) {
      await notifyStaff(tenantDb, {
        organizationId: org.id,
        siteId,
        type: "appointments.daily_agenda",
        title: `${list.length} RDV aujourd'hui · ${list.filter((a) => a.status === "CONFIRMED").length} confirmés`,
        body: list
          .map((a) => `${formatTimeFr(a.startsAt, org.timezone)} ${a.customer.displayName}`)
          .join(" · "),
        link: "/rendez-vous/aujourdhui",
        dedupeKey: `appointments.daily_agenda:${siteId}:${today}`,
      });
    }
  });
}

export async function processUnconfirmedCheckJob(
  clock: Clock = systemClock,
  scope: JobScope = {},
): Promise<void> {
  await forEachOrganization("appointments.unconfirmed_check", scope, async (org) => {
    const now = clock.now();
    if (localMinutes(now, org.timezone) < 18 * 60) return;
    const tomorrow = addDaysToKey(localDateKey(now, org.timezone), 1);
    const tenantDb = db.forTenant({ organizationId: org.id });
    const unconfirmed = await tenantDb.appointment.findMany({
      where: {
        status: "BOOKED",
        startsAt: {
          gte: zonedInstant(tomorrow, 0, org.timezone),
          lt: zonedInstant(addDaysToKey(tomorrow, 1), 0, org.timezone),
        },
      },
      include: { customer: { select: { displayName: true } } },
    });
    const bySite = new Map<string, typeof unconfirmed>();
    for (const a of unconfirmed) bySite.set(a.siteId, [...(bySite.get(a.siteId) ?? []), a]);
    for (const [siteId, list] of bySite) {
      await notifyStaff(tenantDb, {
        organizationId: org.id,
        siteId,
        type: "appointments.unconfirmed_check",
        title: `${list.length} RDV de demain sans confirmation : appels à passer`,
        body: list
          .map((a) => `${formatTimeFr(a.startsAt, org.timezone)} ${a.customer.displayName}`)
          .join(" · "),
        link: "/rendez-vous/aujourdhui",
        dedupeKey: `appointments.unconfirmed_check:${siteId}:${tomorrow}`,
      });
    }
  });
}

interface EventRow {
  id: string;
  organizationId: string;
  type: string;
  payload: unknown;
}

/** Consommateur M03 des événements de domaine, appelé par `reminders.on_event` (même file). */
export async function handleAppointmentEvent(event: EventRow, now: Date): Promise<void> {
  const tenantDb = db.forTenant({ organizationId: event.organizationId });
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "repair_order.created": {
      const appointmentId = payload.appointmentId as string | undefined;
      const repairOrderId = (payload.repairOrderId ?? payload.id) as string | undefined;
      if (!appointmentId || !repairOrderId) return;
      const appt = await tenantDb.appointment.findFirst({ where: { id: appointmentId } });
      if (!appt) return;
      const pending = appt.status === "BOOKED" || appt.status === "CONFIRMED";
      await tenantDb.appointment.update({
        where: { id: appt.id },
        data: { repairOrderId, ...(pending ? { status: "ARRIVED", arrivedAt: now } : {}) },
      });
      return;
    }
    case "repair_order.status_changed": {
      const newStatus = payload.newStatus as string | undefined;
      const repairOrderId = (payload.repairOrderId ?? payload.id) as string | undefined;
      if (!repairOrderId || (newStatus !== "DELIVERED" && newStatus !== "INVOICED")) return;
      const appointments = await tenantDb.appointment.findMany({
        where: { repairOrderId, status: "ARRIVED" },
        select: { id: true },
      });
      for (const appt of appointments) {
        await tenantDb.appointment.update({
          where: { id: appt.id },
          data: { status: "COMPLETED", completedAt: now },
        });
        await emit(tenantDb, event.organizationId, "appointment.completed", {
          appointmentId: appt.id,
          repairOrderId,
        });
      }
      return;
    }
    case "message.inbound_received": {
      const customerId = payload.customerId as string | undefined;
      const messageId = payload.messageId as string | undefined;
      if (!customerId || !messageId || payload.stop === true) return;
      const message = await tenantDb.message.findFirst({
        where: { id: messageId },
        select: { body: true, channel: true },
      });
      if (!message) return;
      // Ne s'applique qu'en réponse à un message de RDV des 72 dernières heures.
      const lastAppointmentMessage = await tenantDb.message.findFirst({
        where: {
          customerId,
          direction: "OUTBOUND",
          idempotencyKey: { startsWith: "appt:" },
          createdAt: { gte: new Date(now.getTime() - 72 * 3_600_000) },
        },
        orderBy: { createdAt: "desc" },
        select: { idempotencyKey: true },
      });
      // `appt:<id>:…` (un RDV) ou `appt:<groupId>:batch:…` (confirmation groupée d'une flotte).
      const [, targetId, kind] = lastAppointmentMessage?.idempotencyKey?.split(":") ?? [];
      if (!targetId) return;
      const targets = await tenantDb.appointment.findMany({
        where: {
          ...(kind === "batch" ? { groupId: targetId } : { id: targetId }),
          status: { in: ["BOOKED", "CONFIRMED"] },
        },
        include: { customer: { select: { displayName: true } } },
        orderBy: { startsAt: "asc" },
      });
      const first = targets[0];
      if (!first) return;
      const reply = classifyAppointmentReply(message.body);
      if (!reply) return;
      const via =
        message.channel === "SMS" ? "sms" : message.channel === "EMAIL" ? "email" : "whatsapp";
      if (reply.intent === "CONFIRM" && reply.automatic) {
        for (const appt of targets) {
          if (appt.status !== "BOOKED") continue;
          await tenantDb.appointment.update({
            where: { id: appt.id },
            data: { status: "CONFIRMED", confirmedAt: now, confirmedVia: via },
          });
          await emit(tenantDb, event.organizationId, "appointment.confirmed", {
            appointmentId: appt.id,
            via,
          });
        }
        return;
      }
      if (reply.intent === "CANCEL" && reply.automatic) {
        for (const appt of targets) {
          await tenantDb.appointment.update({
            where: { id: appt.id },
            data: {
              status: "CANCELLED",
              cancelledAt: now,
              cancelledBy: "CUSTOMER",
              cancelReason: `Réponse « ${message.body.trim()} »`,
            },
          });
          await tenantDb.reminder.updateMany({
            where: {
              appointmentId: appt.id,
              type: "APPOINTMENT",
              status: { in: ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] },
            },
            data: { status: "CANCELLED", skippedReason: "Rendez-vous annulé." },
          });
          await emit(tenantDb, event.organizationId, "appointment.cancelled", {
            appointmentId: appt.id,
            vehicleId: appt.vehicleId,
            customerId: appt.customerId,
            cancelledBy: "CUSTOMER",
          });
        }
        await notifyStaff(tenantDb, {
          organizationId: event.organizationId,
          siteId: first.siteId,
          type: "appointment.cancelled_by_customer",
          title:
            targets.length > 1
              ? `${first.customer.displayName} a annulé ${targets.length} RDV`
              : `${first.customer.displayName} a annulé son RDV`,
          link: "/rendez-vous",
          dedupeKey: `appointment.cancelled:${targetId}`,
        });
        return;
      }
      // « 2 » ou texte libre : jamais de modification automatique, RDV à replanifier.
      await notifyStaff(tenantDb, {
        organizationId: event.organizationId,
        siteId: first.siteId,
        type: "appointment.to_reschedule",
        title: `RDV à replanifier — ${first.customer.displayName}`,
        body: `« ${message.body.trim()} »`,
        link: "/rendez-vous",
        dedupeKey: `appointment.to_reschedule:${targetId}:${messageId}`,
      });
      return;
    }
    default:
      return;
  }
}
