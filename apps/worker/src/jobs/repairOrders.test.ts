import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lateCheckForOrganization, readyFollowupForOrganization } from "./repairOrders";

describe("M04 — repairOrders.late_check et repairOrders.ready_followup", () => {
  let org: { id: string };
  let advisor: { id: string };
  let manager: { id: string };
  const users: string[] = [];
  const now = new Date("2026-11-05T09:00:00Z");

  beforeAll(async () => {
    org = await adminDb.organization.create({
      data: {
        name: "Garage OR Jobs",
        settings: { repairOrders: { storageFeeEnabled: true, storageFeeAfterDays: 7 } },
      },
    });
    const site = await adminDb.site.create({
      data: { organizationId: org.id, name: "Yopougon", code: "YOP" },
    });
    const make = async (role: "ADVISOR" | "MANAGER") => {
      const user = await adminDb.user.create({
        data: { name: role, email: `${randomBytes(4).toString("hex")}@example.com` },
      });
      users.push(user.id);
      return adminDb.membership.create({
        data: { organizationId: org.id, userId: user.id, role, siteIds: [] },
      });
    };
    advisor = await make("ADVISOR");
    manager = await make("MANAGER");
    const customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Koné Ibrahim" },
    });
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        plate: "1 AB 01",
        make: "Kia",
        model: "Rio",
      },
    });
    const base = {
      organizationId: org.id,
      siteId: site.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      advisorId: advisor.id,
    };
    await adminDb.repairOrder.createMany({
      data: [
        {
          ...base,
          number: "OR-YOP-2026-00001",
          status: "IN_PROGRESS",
          promisedAt: new Date("2026-11-04T17:00:00Z"),
        },
        {
          ...base,
          number: "OR-YOP-2026-00002",
          status: "IN_PROGRESS",
          promisedAt: new Date("2026-11-06T17:00:00Z"),
        },
        {
          ...base,
          number: "OR-YOP-2026-00003",
          status: "READY",
          readyAt: new Date("2026-10-21T15:00:00Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    const where = { organizationId: org.id };
    await adminDb.notification.deleteMany({ where });
    await adminDb.repairOrder.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("notifie une seule fois par jour les OR en retard (conseiller + chef d'atelier)", async () => {
    expect(await lateCheckForOrganization(org.id, now)).toBe(2);
    expect(await lateCheckForOrganization(org.id, now)).toBe(0);
    const notes = await adminDb.notification.findMany({
      where: { organizationId: org.id, type: "repair_order.late" },
    });
    expect(notes.map((n) => n.membershipId).sort()).toEqual([advisor.id, manager.id].sort());
    expect(notes[0]!.title).toBe("OR en retard sur la promesse — OR-YOP-2026-00001");
  });

  it("véhicule prêt non récupéré et frais de gardiennage proposés (RG-M04-15)", async () => {
    expect(await readyFollowupForOrganization(org.id, now)).toBe(2);
    const fee = await adminDb.notification.findFirstOrThrow({
      where: { organizationId: org.id, type: "repair_order.storage_fee" },
    });
    expect(fee.body).toBe(
      "Frais de gardiennage du 30/10 au 05/11 (6 j × 2 000 FCFA) = 12 000 FCFA",
    );
    expect(await readyFollowupForOrganization(org.id, now)).toBe(0);
  });
});
