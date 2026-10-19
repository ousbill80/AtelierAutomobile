import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUnclosedSessions } from "./cashJobs";

// Horloge figée : 19/10/2026 23:00 à Abidjan (UTC+0).
const NOW = new Date("2026-10-19T23:00:00.000Z");

describe("cash.check_unclosed (RG-M08-29)", () => {
  let org: { id: string };
  const users: string[] = [];
  let cashierId: string;
  let ownerId: string;

  beforeAll(async () => {
    org = await adminDb.organization.create({
      data: { name: "Garage Caisse Ouverte", onboardingCompletedAt: NOW },
    });
    const site = await adminDb.site.create({
      data: { organizationId: org.id, name: "Yopougon", code: "YOP" },
    });
    for (const role of ["CASHIER", "OWNER"] as const) {
      const user = await adminDb.user.create({
        data: { name: role, email: `${randomBytes(5).toString("hex")}@example.com` },
      });
      users.push(user.id);
      const m = await adminDb.membership.create({
        data: { organizationId: org.id, userId: user.id, role, siteIds: [] },
      });
      if (role === "CASHIER") cashierId = m.id;
      else ownerId = m.id;
    }
    await adminDb.cashSession.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        openedById: cashierId,
        openedAt: new Date("2026-10-19T07:30:00.000Z"),
        openingFloat: 50_000,
      },
    });
  });

  afterAll(async () => {
    const where = { organizationId: org.id };
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.cashSession.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("notifies the cashier and the owner once per open session", async () => {
    expect(await checkUnclosedSessions(org.id, NOW)).toBe(2);
    const notifications = await adminDb.notification.findMany({
      where: { organizationId: org.id },
    });
    expect(notifications.map((n) => n.membershipId).sort()).toEqual([cashierId, ownerId].sort());
    expect(notifications[0]!.title).toBe("Caisse non clôturée — Yopougon");
    // Idempotent : une seconde passe ne renotifie pas cette session. (Le job global n'est pas
    // lancé ici : il toucherait les sessions des autres suites qui tournent en parallèle.)
    expect(await checkUnclosedSessions(org.id, NOW)).toBe(0);
    expect(await adminDb.notification.count({ where: { organizationId: org.id } })).toBe(2);
    expect(
      await adminDb.domainEvent.count({
        where: { organizationId: org.id, type: "cash.session_not_closed" },
      }),
    ).toBe(1);
  });
});
