import { randomBytes } from "node:crypto";
import { fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDailyAgendaJob, runNoShowJob, runUnconfirmedCheckJob } from "./jobs";

describe("jobs M03 (no-show automatique, agenda, confirmations)", () => {
  let orgId: string;
  let siteId: string;
  let customerId: string;
  let advisorMembershipId: string;

  beforeAll(async () => {
    const org = await adminDb.organization.create({
      data: { name: `Garage Jobs ${randomBytes(2).toString("hex")}`, timezone: "Africa/Abidjan" },
    });
    orgId = org.id;
    const site = await adminDb.site.create({
      data: {
        organizationId: orgId,
        name: "Site J",
        code: "SJ",
        openingHours: { mon: [["08:00", "18:00"]], tue: [["08:00", "18:00"]] },
      },
    });
    siteId = site.id;
    const user = await adminDb.user.create({
      data: { name: "Conseiller", email: `${randomBytes(4).toString("hex")}@example.com` },
    });
    const membership = await adminDb.membership.create({
      data: { organizationId: orgId, userId: user.id, role: "ADVISOR", siteIds: [] },
    });
    advisorMembershipId = membership.id;
    const customer = await adminDb.customer.create({
      data: { organizationId: orgId, displayName: "Client Jobs", phone: "+2250700000001" },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await adminDb.notification.deleteMany({ where: { organizationId: orgId } });
    await adminDb.domainEvent.deleteMany({ where: { organizationId: orgId } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: orgId } });
    await adminDb.appointment.deleteMany({ where: { organizationId: orgId } });
    await adminDb.customer.deleteMany({ where: { organizationId: orgId } });
    const memberships = await adminDb.membership.findMany({ where: { organizationId: orgId } });
    await adminDb.membership.deleteMany({ where: { organizationId: orgId } });
    await adminDb.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
    await adminDb.site.deleteMany({ where: { organizationId: orgId } });
    await adminDb.organization.delete({ where: { id: orgId } });
  });

  it("passe en NO_SHOW les RDV du jour encore réservés après 20:00 heure locale, pas avant", async () => {
    // Lundi 26/10/2026 (Abidjan = UTC+0)
    const appointment = await adminDb.appointment.create({
      data: {
        organizationId: orgId,
        siteId,
        customerId,
        startsAt: new Date("2026-10-26T09:00:00Z"),
        endsAt: new Date("2026-10-26T10:30:00Z"),
        type: "SERVICE",
        status: "CONFIRMED",
      },
    });
    const future = await adminDb.appointment.create({
      data: {
        organizationId: orgId,
        siteId,
        customerId,
        startsAt: new Date("2026-10-27T09:00:00Z"),
        endsAt: new Date("2026-10-27T10:30:00Z"),
        type: "SERVICE",
        status: "BOOKED",
      },
    });
    const before = await runNoShowJob(fixedClock(new Date("2026-10-26T19:45:00Z")));
    expect(before.processed).toBe(0);
    const after = await runNoShowJob(fixedClock(new Date("2026-10-26T20:00:00Z")));
    expect(after.processed).toBe(1);
    const updated = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.status).toBe("NO_SHOW");
    expect(updated.noShowAt).toEqual(new Date("2026-10-26T20:00:00Z"));
    expect((await adminDb.appointment.findUniqueOrThrow({ where: { id: future.id } })).status).toBe(
      "BOOKED",
    );
    const event = await adminDb.domainEvent.findFirst({
      where: { organizationId: orgId, type: "appointment.no_show" },
    });
    expect(event).not.toBeNull();
    const notification = await adminDb.notification.findFirst({
      where: {
        organizationId: orgId,
        membershipId: advisorMembershipId,
        type: "appointment.no_show",
      },
    });
    expect(notification?.title).toContain("Absent");
    // Rejouer le job est idempotent.
    const again = await runNoShowJob(fixedClock(new Date("2026-10-26T20:15:00Z")));
    expect(again.processed).toBe(0);
  });

  it("notifie une seule fois par jour les RDV du lendemain non confirmés (18:00) et l'agenda du jour (07:00)", async () => {
    // La base de test est partagée avec d'autres organisations (seed) : on observe uniquement la nôtre.
    const count = (prefix: string) =>
      adminDb.notification.count({
        where: { organizationId: orgId, type: { startsWith: prefix } },
      });

    await runUnconfirmedCheckJob(fixedClock(new Date("2026-10-26T17:45:00Z")));
    expect(await count("appointments.unconfirmed:")).toBe(0);
    await runUnconfirmedCheckJob(fixedClock(new Date("2026-10-26T18:05:00Z")));
    expect(await count("appointments.unconfirmed:")).toBe(1);
    await runUnconfirmedCheckJob(fixedClock(new Date("2026-10-26T18:20:00Z")));
    expect(await count("appointments.unconfirmed:")).toBe(1);
    const notification = await adminDb.notification.findFirst({
      where: { organizationId: orgId, type: { startsWith: "appointments.unconfirmed:" } },
    });
    expect(notification?.title).toContain("1 RDV de demain à confirmer");

    await runDailyAgendaJob(fixedClock(new Date("2026-10-27T06:30:00Z")));
    expect(await count("appointments.daily_agenda:")).toBe(0);
    await runDailyAgendaJob(fixedClock(new Date("2026-10-27T07:00:00Z")));
    expect(await count("appointments.daily_agenda:")).toBe(1);
    await runDailyAgendaJob(fixedClock(new Date("2026-10-27T07:15:00Z")));
    expect(await count("appointments.daily_agenda:")).toBe(1);
    const agendaNotification = await adminDb.notification.findFirst({
      where: { organizationId: orgId, type: { startsWith: "appointments.daily_agenda:" } },
    });
    expect(agendaNotification?.title).toContain("Agenda du jour : 1 RDV");
  });
});
