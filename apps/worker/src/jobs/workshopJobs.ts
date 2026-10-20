// M06 §9 — tâches worker de l'atelier :
// - `workshop.close_stale` (toutes les heures à :59, fuseau de l'organisation) : pauses de plus
//   de 4 h ou passant minuit closes à `pausedAt` (RG-M06-07), entrées ouvertes et présences
//   sans départ closes en fin de journée (US-M06-09), avec `needsReview` / `autoClosed`.
// - `workshop.late_alerts` (toutes les 15 min) : le conseiller est notifié une fois par OR et par
//   jour des OR en retard ou « à risque » (RG-M06-02).
import {
  decideStaleAttendance,
  decideStaleEntry,
  localDateKey,
  openIntervalsForDay,
  systemClock,
  workshopLateness,
  zonedInstant,
  type Clock,
  type OpeningHours,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { logger } from "../logger";

const BEFORE_READY = [
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
] as const;

/** Fin d'ouverture du site le jour local `dateKey` (null si fermé ou non renseigné). */
function siteCloseAt(openingHours: unknown, dateKey: string, timeZone: string): Date | null {
  const intervals = openIntervalsForDay(dateKey, {
    timeZone,
    openingHours: (openingHours ?? {}) as OpeningHours,
  });
  const last = intervals[intervals.length - 1];
  return last ? zonedInstant(dateKey, last[1], timeZone) : null;
}

export async function closeStaleForOrganization(
  organizationId: string,
  now: Date,
): Promise<{ entries: number; attendances: number }> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const tz = org.timezone;
  const tenantDb = db.forTenant({ organizationId });
  return tenantDb.transaction(async (tx) => {
    let entries = 0;
    const open = await tx.timeEntry.findMany({ where: { endedAt: null } });
    for (const entry of open) {
      const closure = decideStaleEntry(entry, now, tz);
      if (!closure) continue;
      await tx.timeEntry.update({
        where: { id: entry.id },
        data: {
          endedAt: closure.endedAt,
          pausedAt: null,
          needsReview: true,
          reviewReason: entry.reviewReason ?? closure.reason,
        },
      });
      entries++;
    }

    let attendances = 0;
    const pending = await tx.attendance.findMany({
      where: { clockOut: null, clockIn: { not: null } },
      include: { site: { select: { openingHours: true } } },
    });
    for (const att of pending) {
      const dayKey = att.date.toISOString().slice(0, 10);
      const dayStart = zonedInstant(dayKey, 0, tz);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const last = await tx.timeEntry.findFirst({
        where: {
          membershipId: att.membershipId,
          endedAt: { not: null, gte: dayStart, lt: dayEnd },
        },
        orderBy: { endedAt: "desc" },
      });
      const clockOut = decideStaleAttendance(
        att,
        last?.endedAt ?? null,
        att.site ? siteCloseAt(att.site.openingHours, dayKey, tz) : null,
        now,
        tz,
      );
      if (!clockOut) continue;
      await tx.attendance.update({
        where: { id: att.id },
        data: { clockOut, autoClosed: true },
      });
      attendances++;
    }
    return { entries, attendances };
  });
}

export async function processWorkshopCloseStaleJob(clock: Clock = systemClock) {
  const organizations = await adminDb.organization.findMany({
    where: { operatingMode: "FULL" },
    select: { id: true },
  });
  let total = 0;
  for (const org of organizations) {
    try {
      const result = await closeStaleForOrganization(org.id, clock.now());
      total += result.entries + result.attendances;
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        "workshop.close_stale : échec sur une organisation, passage à la suivante",
      );
    }
  }
  return total;
}

export async function lateAlertsForOrganization(
  organizationId: string,
  now: Date,
): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const tenantDb = db.forTenant({ organizationId });
  const dayKey = localDateKey(now, org.timezone);
  return tenantDb.transaction(async (tx) => {
    const orders = await tx.repairOrder.findMany({
      where: { deletedAt: null, promisedAt: { not: null }, status: { in: [...BEFORE_READY] } },
      include: {
        lines: { select: { type: true, status: true, approval: true, quantity: true } },
        vehicle: { select: { plate: true } },
      },
    });
    let notified = 0;
    const managers = await tx.membership.findMany({
      where: { isActive: true, role: { in: ["MANAGER", "OWNER"] } },
      select: { id: true },
    });
    for (const order of orders) {
      const lateness = workshopLateness(order, order.lines, now);
      if (!lateness.late && !lateness.atRisk) continue;
      const recipients = order.advisorId ? [order.advisorId] : managers.map((m) => m.id);
      const dedupeKey = `workshop.late:${order.id}:${dayKey}`;
      for (const membershipId of recipients) {
        const existing = await tx.notification.findFirst({ where: { membershipId, dedupeKey } });
        if (existing) continue;
        await tx.notification.create({
          data: {
            organizationId,
            membershipId,
            type: lateness.late ? "workshop.late" : "workshop.at_risk",
            title: lateness.late
              ? `${order.number} (${order.vehicle.plate}) en retard sur la date promise`
              : `${order.number} (${order.vehicle.plate}) risque de ne pas être prêt à l'heure promise`,
            link: `/ordres/${order.id}`,
            severity: lateness.late ? "warning" : "info",
            dedupeKey,
          },
        });
        notified++;
      }
    }
    return notified;
  });
}

export async function processWorkshopLateAlertsJob(clock: Clock = systemClock) {
  const organizations = await adminDb.organization.findMany({
    where: { operatingMode: "FULL" },
    select: { id: true },
  });
  let total = 0;
  for (const org of organizations) {
    try {
      total += await lateAlertsForOrganization(org.id, clock.now());
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        "workshop.late_alerts : échec sur une organisation, passage à la suivante",
      );
    }
  }
  return total;
}
