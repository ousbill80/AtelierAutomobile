import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeStaleForOrganization, lateAlertsForOrganization } from "./workshopJobs";

// Horloge figée : mardi 13/10/2026 à Abidjan (UTC+0).
const at = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00.000Z`);

describe("workshop.close_stale / workshop.late_alerts (M06 §9)", () => {
  let orgId: string;
  const users: string[] = [];
  let mechanicId: string;
  let advisorId: string;
  let orderId: string;
  let lineId: string;

  beforeAll(async () => {
    orgId = (
      await adminDb.organization.create({
        data: { name: "Garage Atelier Worker", onboardingCompletedAt: at("06:00") },
      })
    ).id;
    const site = await adminDb.site.create({
      data: {
        organizationId: orgId,
        name: "Yopougon",
        code: "YOP",
        openingHours: { tue: [["07:30", "18:00"]] },
      },
    });
    for (const role of ["MECHANIC", "ADVISOR"] as const) {
      const user = await adminDb.user.create({
        data: { name: role, email: `${randomBytes(5).toString("hex")}@example.com` },
      });
      users.push(user.id);
      const m = await adminDb.membership.create({
        data: { organizationId: orgId, userId: user.id, role },
      });
      if (role === "MECHANIC") mechanicId = m.id;
      else advisorId = m.id;
    }
    const customer = await adminDb.customer.create({
      data: { organizationId: orgId, displayName: "Kouassi Jean-Marc" },
    });
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgId,
        customerId: customer.id,
        plate: "2547 GH 01",
        make: "Toyota",
        model: "Corolla",
      },
    });
    orderId = (
      await adminDb.repairOrder.create({
        data: {
          organizationId: orgId,
          siteId: site.id,
          number: "OR-YOP-2026-00042",
          customerId: customer.id,
          vehicleId: vehicle.id,
          advisorId,
          status: "IN_PROGRESS",
          promisedAt: at("12:00"),
        },
      })
    ).id;
    lineId = (
      await adminDb.repairOrderLine.create({
        data: {
          organizationId: orgId,
          repairOrderId: orderId,
          type: "LABOR",
          description: "Vidange",
          quantity: 3,
          unitPrice: 15_000,
          vatRate: 18,
          approval: "APPROVED",
          status: "IN_PROGRESS",
          assignedToId: mechanicId,
        },
      })
    ).id;
    await adminDb.attendance.create({
      data: {
        organizationId: orgId,
        membershipId: mechanicId,
        siteId: site.id,
        date: new Date("2026-10-13T00:00:00.000Z"),
        clockIn: at("07:48"),
      },
    });
  });

  afterAll(async () => {
    const where = { organizationId: orgId };
    await adminDb.notification.deleteMany({ where });
    await adminDb.timeEntry.deleteMany({ where });
    await adminDb.attendance.deleteMany({ where });
    await adminDb.repairOrderLine.deleteMany({ where });
    await adminDb.repairOrder.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.delete({ where: { id: orgId } });
  });

  it("clôt une pause de plus de 4 h à pausedAt, avec needsReview", async () => {
    const entry = await adminDb.timeEntry.create({
      data: {
        organizationId: orgId,
        membershipId: mechanicId,
        repairOrderId: orderId,
        repairOrderLineId: lineId,
        startedAt: at("08:00"),
        pausedAt: at("09:00"),
      },
    });
    expect(await closeStaleForOrganization(orgId, at("13:30"))).toEqual({
      entries: 1,
      attendances: 0,
    });
    const closed = await adminDb.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(closed).toMatchObject({
      endedAt: at("09:00"),
      pausedAt: null,
      needsReview: true,
      reviewReason: "pause_expired",
    });
  });

  it("en fin de journée : entrée ouverte et présence sans départ closes (autoClosed)", async () => {
    const entry = await adminDb.timeEntry.create({
      data: {
        organizationId: orgId,
        membershipId: mechanicId,
        repairOrderId: orderId,
        repairOrderLineId: lineId,
        startedAt: at("14:00"),
      },
    });
    expect(await closeStaleForOrganization(orgId, at("17:00"))).toEqual({
      entries: 0,
      attendances: 0,
    });
    expect(await closeStaleForOrganization(orgId, at("23:59"))).toEqual({
      entries: 1,
      attendances: 1,
    });
    expect(await adminDb.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({
      endedAt: at("23:59"),
      needsReview: true,
      reviewReason: "end_of_day",
    });
    // Présence close à la fin de la dernière entrée de la journée.
    const attendance = await adminDb.attendance.findFirstOrThrow({
      where: { organizationId: orgId },
    });
    expect(attendance).toMatchObject({ clockOut: at("23:59"), autoClosed: true });
  });

  it("alerte de retard : une seule notification par OR et par jour au conseiller", async () => {
    expect(await lateAlertsForOrganization(orgId, at("13:00"))).toBe(1);
    expect(await lateAlertsForOrganization(orgId, at("13:15"))).toBe(0);
    const notification = await adminDb.notification.findFirstOrThrow({
      where: { organizationId: orgId },
    });
    expect(notification).toMatchObject({
      membershipId: advisorId,
      type: "workshop.late",
      title: "OR-YOP-2026-00042 (2547 GH 01) en retard sur la date promise",
    });
  });
});
