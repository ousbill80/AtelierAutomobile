import { fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  processPurchaseLateAlertsJob,
  processStockIntegrityCheckJob,
  processStockReorderSuggestionsJob,
} from "./stockJobs";

// M07 §9 — jobs du stock : notifications de réapprovisionnement, alerte d'intégrité
// (onHand ≠ Σ mouvements) et commandes en retard, dédoublonnées par jour.
describe("jobs stock (M07)", () => {
  const now = new Date("2026-10-19T08:00:00.000Z");
  let orgId: string;
  let storekeeperId: string;
  let ownerId: string;
  const users: string[] = [];

  beforeAll(async () => {
    orgId = (await adminDb.organization.create({ data: { name: "Jobs Stock" } })).id;
    const site = await adminDb.site.create({
      data: { organizationId: orgId, name: "Yopougon", code: "YOP" },
    });
    for (const role of ["STOREKEEPER", "OWNER"] as const) {
      const user = await adminDb.user.create({
        data: { name: role, email: `${role}-${Date.now()}-${Math.random()}@example.com` },
      });
      users.push(user.id);
      const m = await adminDb.membership.create({
        data: { organizationId: orgId, userId: user.id, role },
      });
      if (role === "STOREKEEPER") storekeeperId = m.id;
      else ownerId = m.id;
    }
    const supplier = await adminDb.supplier.create({
      data: { organizationId: orgId, name: "CFAO" },
    });
    const product = await adminDb.product.create({
      data: {
        organizationId: orgId,
        sku: "FLT-1",
        name: "Filtre",
        minStock: 10,
        defaultSupplierId: supplier.id,
      },
    });
    // onHand 4 sans mouvement : sous le mini ET incohérent avec l'historique.
    await adminDb.stockLevel.create({
      data: { organizationId: orgId, siteId: site.id, productId: product.id, onHand: 4 },
    });
    await adminDb.purchaseOrder.create({
      data: {
        organizationId: orgId,
        siteId: site.id,
        supplierId: supplier.id,
        number: "BC-YOP-2026-00003",
        status: "SENT",
        expectedAt: new Date("2026-10-15T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await adminDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET session_replication_role = replica");
      for (const table of [
        "Notification",
        "DomainEvent",
        "PurchaseOrder",
        "StockLevel",
        "Product",
        "Supplier",
        "Membership",
        "Site",
      ]) {
        await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, orgId);
      }
      await tx.$executeRawUnsafe('DELETE FROM "Organization" WHERE id = $1', orgId);
      await tx.$executeRawUnsafe("SET session_replication_role = DEFAULT");
    });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
  });

  it("notifie le magasinier des suggestions, une fois par jour", async () => {
    await processStockReorderSuggestionsJob(fixedClock(now));
    await processStockReorderSuggestionsJob(fixedClock(now));
    const notes = await adminDb.notification.findMany({
      where: {
        organizationId: orgId,
        membershipId: storekeeperId,
        type: "stock.reorder_suggestions",
      },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("1 produit à réapprovisionner (YOP)");
  });

  it("signale au propriétaire un écart onHand ≠ Σ mouvements", async () => {
    await processStockIntegrityCheckJob(fixedClock(now));
    const notes = await adminDb.notification.findMany({
      where: { organizationId: orgId, membershipId: ownerId, type: "stock.integrity_mismatch" },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe("critical");
  });

  it("alerte sur les commandes en retard", async () => {
    await processPurchaseLateAlertsJob(fixedClock(now));
    const notes = await adminDb.notification.findMany({
      where: { organizationId: orgId, membershipId: storekeeperId, type: "purchase.late" },
    });
    expect(notes.map((n) => n.title)).toEqual(["Commande BC-YOP-2026-00003 en retard — CFAO"]);
  });
});
