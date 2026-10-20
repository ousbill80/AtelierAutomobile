import { randomBytes } from "node:crypto";
import { fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processPortalTokensExpireJob } from "./portal";

describe("M14 — portal.tokens_expire", () => {
  const now = new Date("2026-11-05T03:30:00Z");
  let org: { id: string };
  let customer: { id: string };

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Portail Jobs" } });
    customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Kouassi Jean" },
    });
  });

  afterAll(async () => {
    const where = { organizationId: org.id };
    await adminDb.portalAccess.deleteMany({ where });
    await adminDb.portalOtpChallenge.deleteMany({ where });
    await adminDb.portalToken.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  const token = (expiresAt: Date) =>
    adminDb.portalToken.create({
      data: {
        organizationId: org.id,
        tokenHash: randomBytes(32).toString("hex"),
        scope: "REPAIR_ORDER",
        targetId: "ro_x",
        customerId: customer.id,
        expiresAt,
      },
    });

  it("passe EXPIRED les jetons échus, garde les actifs, purge le journal > 12 mois", async () => {
    const stale = await token(new Date("2026-11-01T00:00:00Z"));
    const fresh = await token(new Date("2026-12-01T00:00:00Z"));
    await adminDb.portalAccess.createMany({
      data: [
        {
          organizationId: org.id,
          portalTokenId: fresh.id,
          action: "open",
          createdAt: new Date("2025-10-01T00:00:00Z"),
        },
        {
          organizationId: org.id,
          portalTokenId: fresh.id,
          action: "open",
          createdAt: new Date("2026-10-01T00:00:00Z"),
        },
      ],
    });
    await adminDb.portalOtpChallenge.create({
      data: {
        organizationId: org.id,
        phone: "+2250747218890",
        codeHash: "x",
        expiresAt: new Date("2026-11-01T00:00:00Z"),
      },
    });

    const result = await processPortalTokensExpireJob(fixedClock(now), {
      organizationId: org.id,
    });
    expect(result).toEqual({ expired: 1, purgedAccesses: 1, purgedChallenges: 1 });
    const rows = await adminDb.portalToken.findMany({
      where: { organizationId: org.id },
      select: { id: true, status: true },
    });
    expect(rows.find((r) => r.id === stale.id)?.status).toBe("EXPIRED");
    expect(rows.find((r) => r.id === fresh.id)?.status).toBe("ACTIVE");
    expect(await adminDb.portalAccess.count({ where: { organizationId: org.id } })).toBe(1);

    // Idempotent : un second passage ne change rien.
    expect(await processPortalTokensExpireJob(fixedClock(now), { organizationId: org.id })).toEqual(
      { expired: 0, purgedAccesses: 0, purgedChallenges: 0 },
    );
  });
});
