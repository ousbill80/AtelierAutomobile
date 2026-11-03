import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "./client";
import { deliverPendingPushes, type PushSender } from "./push";
import { deleteTestOrganizations } from "./testing";

describe("deliverPendingPushes (PWA)", () => {
  let orgId: string;
  let userId: string;
  let membershipId: string;
  const now = new Date("2026-11-02T08:00:00Z");

  beforeAll(async () => {
    const org = await adminDb.organization.create({ data: { name: "Test Push" } });
    const user = await adminDb.user.create({
      data: { name: "Gérant Push", email: `push-${org.id}@example.com` },
    });
    const membership = await adminDb.membership.create({
      data: { organizationId: org.id, userId: user.id, role: "OWNER", siteIds: [] },
    });
    orgId = org.id;
    userId = user.id;
    membershipId = membership.id;
    await adminDb.pushSubscription.createMany({
      data: [
        {
          organizationId: orgId,
          membershipId,
          endpoint: `https://push.test/${orgId}/ok`,
          p256dh: "k1",
          auth: "a1",
        },
        {
          organizationId: orgId,
          membershipId,
          endpoint: `https://push.test/${orgId}/gone`,
          p256dh: "k2",
          auth: "a2",
        },
      ],
    });
    await adminDb.notification.createMany({
      data: [
        {
          organizationId: orgId,
          membershipId,
          type: "reminder.escalated",
          title: "Créance à traiter",
          body: "SOTRA : 450 000 FCFA",
          link: "/creances/c1",
          createdAt: new Date(now.getTime() - 5 * 60_000),
        },
        {
          // Trop ancienne (> 2 h) : jamais poussée.
          organizationId: orgId,
          membershipId,
          type: "old",
          title: "Ancienne",
          createdAt: new Date(now.getTime() - 5 * 60 * 60_000),
        },
      ],
    });
  });

  afterAll(async () => {
    await deleteTestOrganizations([orgId], [userId]);
  });

  it("pousse sur chaque appareil, supprime l'abonnement expiré et ne repousse pas", async () => {
    const calls: { endpoint: string; title: string; link?: string | null }[] = [];
    const sender: PushSender = {
      async send(subscription, payload) {
        calls.push({ endpoint: subscription.endpoint, title: payload.title, link: payload.link });
        return { status: subscription.endpoint.endsWith("/gone") ? "gone" : "sent" };
      },
    };

    const report = await deliverPendingPushes(sender, now);
    const mine = calls.filter((c) => c.endpoint.includes(orgId));
    expect(mine).toHaveLength(2);
    expect(mine.every((c) => c.title === "Créance à traiter" && c.link === "/creances/c1")).toBe(
      true,
    );
    expect(report.removed).toBeGreaterThanOrEqual(1);

    const subs = await adminDb.pushSubscription.findMany({ where: { organizationId: orgId } });
    expect(subs.map((s) => s.endpoint)).toEqual([`https://push.test/${orgId}/ok`]);
    expect(subs[0]!.lastSuccessAt?.toISOString()).toBe(now.toISOString());

    const pushed = await adminDb.notification.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
    });
    expect(pushed.find((n) => n.type === "old")!.pushedAt).toBeNull();
    expect(pushed.find((n) => n.type === "reminder.escalated")!.pushedAt).not.toBeNull();

    calls.length = 0;
    await deliverPendingPushes(sender, now);
    expect(calls.filter((c) => c.endpoint.includes(orgId))).toHaveLength(0);
  });
});
