import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncOrganizationTreasury } from "./treasuryJobs";

const NOW = new Date("2026-10-21T10:00:00.000Z");

describe("treasury.sync (M18 §9)", () => {
  let orgId: string;

  beforeAll(async () => {
    const org = await adminDb.organization.create({
      data: { name: `Trésorerie job ${randomBytes(2).toString("hex")}` },
    });
    orgId = org.id;
    const site = await adminDb.site.create({
      data: { organizationId: orgId, name: "Yopougon", code: "YOP" },
    });
    await adminDb.treasuryAccount.create({
      data: {
        organizationId: orgId,
        siteId: site.id,
        type: "CASH_REGISTER",
        name: "Caisse Yopougon",
        openingDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    await adminDb.payment.create({
      data: {
        organizationId: orgId,
        siteId: site.id,
        number: `REC-JOB-${randomBytes(3).toString("hex")}`,
        method: "CASH",
        amount: 25_000,
        receivedAt: NOW,
      },
    });
  });

  afterAll(async () => {
    const where = { organizationId: orgId };
    await adminDb.treasuryMovement.deleteMany({ where });
    await adminDb.payment.deleteMany({ where });
    await adminDb.treasuryAccount.deleteMany({ where });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.delete({ where: { id: orgId } });
  });

  it("projette l'encaissement une seule fois", async () => {
    expect(await syncOrganizationTreasury(orgId, NOW)).toBe(1);
    expect(await syncOrganizationTreasury(orgId, NOW)).toBe(0);
    const movement = await adminDb.treasuryMovement.findFirstOrThrow({
      where: { organizationId: orgId },
    });
    expect(movement).toMatchObject({ direction: "IN", kind: "PAYMENT", amount: 25_000 });
  });
});
