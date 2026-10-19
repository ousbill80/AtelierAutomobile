import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// RG-M04-09 / RG-M07-04 — branchement stock ↔ OR par les routeurs M04 : l'accord du client
// réserve les pièces (« Pièce manquante » si rupture), la ligne terminée les sort du stock,
// l'annulation de l'OR libère le reste. Isolation : une autre organisation n'y a pas accès.
const callerFactory = createCallerFactory(appRouter);

async function ownerCaller(organizationId: string, users: string[]) {
  const user = await adminDb.user.create({
    data: { name: "Gérant", email: `${randomBytes(5).toString("hex")}@example.com` },
  });
  users.push(user.id);
  await adminDb.membership.create({ data: { organizationId, userId: user.id, role: "OWNER" } });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organizationId,
      isPinSession: false,
    },
  });
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return callerFactory(
    await createContext({ req, resHeaders: new Headers(), info: undefined as never }),
  );
}

describe("branchement stock ↔ OR (M07 × M04)", () => {
  const users: string[] = [];
  let orgA: string;
  let orgB: string;
  let siteId: string;
  let roId: string;
  let padsLineId: string;
  let batteryLineId: string;
  let padsId: string;
  let owner: Awaited<ReturnType<typeof ownerCaller>>;
  let ownerB: Awaited<ReturnType<typeof ownerCaller>>;

  beforeAll(async () => {
    orgA = (await adminDb.organization.create({ data: { name: "OR × Stock A" } })).id;
    orgB = (await adminDb.organization.create({ data: { name: "OR × Stock B" } })).id;
    siteId = (
      await adminDb.site.create({ data: { organizationId: orgA, name: "Yopougon", code: "YOP" } })
    ).id;
    owner = await ownerCaller(orgA, users);
    ownerB = await ownerCaller(orgB, users);
    padsId = (
      await adminDb.product.create({
        data: { organizationId: orgA, sku: "PLQ", name: "Plaquettes AV", averageCost: 18_000 },
      })
    ).id;
    const batteryId = (
      await adminDb.product.create({ data: { organizationId: orgA, sku: "BAT", name: "Batterie" } })
    ).id;
    await adminDb.stockLevel.create({
      data: { organizationId: orgA, siteId, productId: padsId, onHand: 4 },
    });
    await adminDb.stockMovement.create({
      data: {
        organizationId: orgA,
        siteId,
        productId: padsId,
        type: "PURCHASE_RECEIPT",
        quantity: 4,
        unitCost: 18_000,
        costAfter: 18_000,
      },
    });
    const customer = await adminDb.customer.create({
      data: { organizationId: orgA, displayName: "Kouassi Jean-Marc" },
    });
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgA,
        customerId: customer.id,
        plate: "2547 GH 01",
        make: "Toyota",
        model: "Corolla",
      },
    });
    roId = (
      await adminDb.repairOrder.create({
        data: {
          organizationId: orgA,
          siteId,
          number: "OR-YOP-2026-00042",
          customerId: customer.id,
          vehicleId: vehicle.id,
          status: "AWAITING_APPROVAL",
        },
      })
    ).id;
    const mk = (productId: string, description: string) =>
      adminDb.repairOrderLine.create({
        data: {
          organizationId: orgA,
          repairOrderId: roId,
          type: "PART",
          productId,
          description,
          quantity: 1,
          unitPrice: 25_000,
          vatRate: 18,
          approval: "PENDING",
        },
      });
    padsLineId = (await mk(padsId, "Plaquettes AV")).id;
    batteryLineId = (await mk(batteryId, "Batterie")).id;
  });

  afterAll(async () => {
    for (const id of [orgA, orgB]) {
      await adminDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET session_replication_role = replica");
        for (const table of [
          "AuditLog",
          "Notification",
          "DomainEvent",
          "VehicleRecommendation",
          "StockMovement",
          "StockReservation",
          "StockLevel",
          "RepairOrderStatusHistory",
          "RepairOrderLine",
          "RepairOrder",
          "Vehicle",
          "Customer",
          "Product",
          "Membership",
          "Site",
        ]) {
          await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, id);
        }
        await tx.$executeRawUnsafe('DELETE FROM "Organization" WHERE id = $1', id);
        await tx.$executeRawUnsafe("SET session_replication_role = DEFAULT");
      });
    }
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
  });

  it("accord du client : OR approuvé, pièces réservées, batterie « Pièce manquante »", async () => {
    await owner.repairOrderLine.update({ id: padsLineId, patch: { approval: "APPROVED" } });
    await owner.repairOrderLine.update({ id: batteryLineId, patch: { approval: "APPROVED" } });
    const order = await owner.repairOrder.get({ id: roId });
    expect(order.status).toBe("APPROVED");
    expect(order.lines.find((l) => l.id === padsLineId)?.stockState).toBe("reserved");
    expect(order.lines.find((l) => l.id === batteryLineId)?.stockState).toBe("missing");
    const level = await adminDb.stockLevel.findFirstOrThrow({
      where: { siteId, productId: padsId },
    });
    expect(level).toMatchObject({ onHand: 4, reserved: 1 });
    const queue = await owner.stock.queue({ siteId });
    expect(queue.map((q) => [q.product.name, q.status, q.repairOrder?.number])).toEqual([
      ["Plaquettes AV", "RESERVED", "OR-YOP-2026-00042"],
      ["Batterie", "BACKORDERED", "OR-YOP-2026-00042"],
    ]);
  });

  it("ligne terminée : plaquettes sorties du stock au CMP", async () => {
    await owner.repairOrderLine.setStatus({ id: padsLineId, status: "DONE" });
    const level = await adminDb.stockLevel.findFirstOrThrow({
      where: { siteId, productId: padsId },
    });
    expect(level).toMatchObject({ onHand: 3, reserved: 0 });
    const movement = await adminDb.stockMovement.findFirstOrThrow({
      where: { repairOrderId: roId, type: "ISSUE_TO_RO" },
    });
    expect(movement).toMatchObject({
      quantity: -1,
      unitCost: 18_000,
      repairOrderLineId: padsLineId,
    });
    const order = await owner.repairOrder.get({ id: roId });
    expect(order.lines.find((l) => l.id === padsLineId)?.stockState).toBe("issued");
  });

  it("isolation : l'autre organisation ne voit ni l'OR ni ses réservations", async () => {
    await expect(ownerB.repairOrder.get({ id: roId })).rejects.toThrow();
    expect(await ownerB.stock.queue({})).toEqual([]);
  });
});
