import { formatInTimeZone } from "date-fns-tz";
import {
  formatAppointmentTime,
  noShowEligibility,
  resolveAppointmentSettings,
  systemClock,
  type Clock,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { markNoShow, type Actor } from "./appointments";
import { notifyRoles } from "./notifications";

function systemActor(organizationId: string): Actor {
  return { organizationId, membershipId: null, userId: null, canForce: true };
}

export interface JobReport {
  organizations: number;
  processed: number;
}

export interface JobOptions {
  /** Restreint le job à une organisation (tests ; en production le job parcourt toutes les organisations). */
  organizationId?: string;
}

/**
 * `appointments.mark_no_show` (toutes les 15 min) — RG-M03-10 : pour chaque organisation dont
 * l'heure locale a dépassé `noShowJobTime`, passe en NO_SHOW les RDV du jour encore
 * BOOKED/CONFIRMED (et ceux des jours précédents jamais traités). Idempotent par construction.
 */
export async function runNoShowJob(
  clock: Clock = systemClock,
  options: JobOptions = {},
): Promise<JobReport> {
  const now = clock.now();
  const organizations = await adminDb.organization.findMany({
    where: options.organizationId ? { id: options.organizationId } : undefined,
    select: { id: true, timezone: true, settings: true },
  });
  let processed = 0;
  for (const organization of organizations) {
    const settings = resolveAppointmentSettings(organization.settings);
    const tenantDb = db.forTenant({ organizationId: organization.id });
    const pending = await tenantDb.appointment.findMany({
      where: {
        status: { in: ["BOOKED", "CONFIRMED"] },
        startsAt: { lt: now, gte: new Date(now.getTime() - 7 * 86_400_000) },
      },
      select: { id: true, startsAt: true, status: true },
    });
    for (const appointment of pending) {
      const eligible = noShowEligibility({
        startsAt: appointment.startsAt,
        status: appointment.status,
        now,
        timeZone: organization.timezone,
        noShowJobTime: settings.noShowJobTime,
      });
      if (!eligible) continue;
      await markNoShow(
        systemActor(organization.id),
        { id: appointment.id, automatic: true },
        clock,
      );
      processed += 1;
    }
  }
  return { organizations: organizations.length, processed };
}

/**
 * `appointments.unconfirmed_check` (18:00 heure locale) — liste des RDV du lendemain non
 * confirmés → notification « Appels à passer » aux conseillers et chefs d'atelier (RG-M03-08).
 */
export async function runUnconfirmedCheckJob(clock: Clock = systemClock): Promise<JobReport> {
  const now = clock.now();
  const organizations = await adminDb.organization.findMany({
    select: { id: true, timezone: true },
  });
  let processed = 0;
  for (const organization of organizations) {
    const tz = organization.timezone;
    if (formatInTimeZone(now, tz, "HH:mm") < "18:00") continue;
    const today = formatInTimeZone(now, tz, "yyyy-MM-dd");
    const tenantDb = db.forTenant({ organizationId: organization.id });
    const sites = await tenantDb.site.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    for (const site of sites) {
      const tomorrowStart = new Date(now.getTime() + 86_400_000);
      const candidates = await tenantDb.appointment.findMany({
        where: {
          siteId: site.id,
          status: "BOOKED",
          startsAt: { gte: new Date(now.getTime()), lt: new Date(now.getTime() + 2 * 86_400_000) },
        },
        select: { id: true, startsAt: true, customer: { select: { displayName: true } } },
      });
      const tomorrow = formatInTimeZone(tomorrowStart, tz, "yyyy-MM-dd");
      const unconfirmed = candidates.filter(
        (a) => formatInTimeZone(a.startsAt, tz, "yyyy-MM-dd") === tomorrow,
      );
      if (unconfirmed.length === 0) continue;
      const sent = await notifyRoles({
        organizationId: organization.id,
        roles: ["ADVISOR", "MANAGER"],
        siteId: site.id,
        type: "appointments.unconfirmed",
        dedupeKey: `${site.id}:${today}`,
        title: `${unconfirmed.length} RDV de demain à confirmer par téléphone (${site.name})`,
        body: unconfirmed
          .map((a) => `${formatAppointmentTime(a.startsAt, tz)} — ${a.customer.displayName}`)
          .join("\n"),
        link: "/rendez-vous/aujourdhui",
      });
      if (sent > 0) processed += 1;
    }
  }
  return { organizations: organizations.length, processed };
}

/**
 * `appointments.daily_agenda` (07:00 heure locale) — agenda du jour envoyé en notification au
 * chef d'atelier et aux conseillers (M03 §9).
 */
export async function runDailyAgendaJob(clock: Clock = systemClock): Promise<JobReport> {
  const now = clock.now();
  const organizations = await adminDb.organization.findMany({
    select: { id: true, timezone: true },
  });
  let processed = 0;
  for (const organization of organizations) {
    const tz = organization.timezone;
    if (formatInTimeZone(now, tz, "HH:mm") < "07:00") continue;
    const today = formatInTimeZone(now, tz, "yyyy-MM-dd");
    const tenantDb = db.forTenant({ organizationId: organization.id });
    const sites = await tenantDb.site.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    for (const site of sites) {
      const appointments = await tenantDb.appointment.findMany({
        where: {
          siteId: site.id,
          status: { in: ["BOOKED", "CONFIRMED"] },
          startsAt: {
            gte: new Date(now.getTime() - 86_400_000),
            lt: new Date(now.getTime() + 86_400_000),
          },
        },
        select: {
          startsAt: true,
          customer: { select: { displayName: true } },
          vehicle: { select: { plate: true } },
        },
        orderBy: { startsAt: "asc" },
      });
      const todays = appointments.filter(
        (a) => formatInTimeZone(a.startsAt, tz, "yyyy-MM-dd") === today,
      );
      const sent = await notifyRoles({
        organizationId: organization.id,
        roles: ["ADVISOR", "MANAGER"],
        siteId: site.id,
        type: "appointments.daily_agenda",
        dedupeKey: `${site.id}:${today}`,
        title: `Agenda du jour : ${todays.length} RDV (${site.name})`,
        body:
          todays.length === 0
            ? "Aucun rendez-vous aujourd'hui."
            : todays
                .map(
                  (a) =>
                    `${formatAppointmentTime(a.startsAt, tz)} — ${a.customer.displayName}${a.vehicle ? ` (${a.vehicle.plate})` : ""}`,
                )
                .join("\n"),
        link: "/rendez-vous/aujourdhui",
      });
      if (sent > 0) processed += 1;
    }
  }
  return { organizations: organizations.length, processed };
}
