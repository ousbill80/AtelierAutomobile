import { adminDb } from "@atelieros/db";
import { afterAll, describe, expect, it } from "vitest";
import { purgeExpiredAssistantThreads } from "./aiAssistantPurge";

describe("ai.assistant_purge (RG-M17-20)", () => {
  const orgIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    await adminDb.aiAssistantMessage.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.aiAssistantThread.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.notification.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("supprime les fils expirés et leurs messages, garde les autres", async () => {
    const org = await adminDb.organization.create({ data: { name: "Purge assistant" } });
    orgIds.push(org.id);
    const user = await adminDb.user.create({
      data: { name: "P", email: `purge-${org.id}@example.com` },
    });
    userIds.push(user.id);
    const membership = await adminDb.membership.create({
      data: { organizationId: org.id, userId: user.id, role: "OWNER", siteIds: [] },
    });
    const now = new Date("2026-10-20T03:00:00Z");
    const expired = await adminDb.aiAssistantThread.create({
      data: {
        organizationId: org.id,
        membershipId: membership.id,
        expiresAt: new Date("2026-10-19T00:00:00Z"),
        messages: {
          create: { organizationId: org.id, role: "user", content: { text: "ancien" } },
        },
      },
    });
    const kept = await adminDb.aiAssistantThread.create({
      data: {
        organizationId: org.id,
        membershipId: membership.id,
        expiresAt: new Date("2026-11-19T00:00:00Z"),
      },
    });
    expect(await purgeExpiredAssistantThreads(now)).toBeGreaterThanOrEqual(1);
    expect(await adminDb.aiAssistantThread.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await adminDb.aiAssistantMessage.count({ where: { threadId: expired.id } })).toBe(0);
    expect(await adminDb.aiAssistantThread.findUnique({ where: { id: kept.id } })).not.toBeNull();
  });
});
