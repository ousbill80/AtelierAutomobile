// RG-M04-09 / RG-M07-04 — branchement stock ↔ OR : réservation à l'approbation, pièce
// manquante, ajustement à la quantité, libération au refus / à l'annulation, sortie à la
// validation de la ligne, pièce fournie par le client ignorée.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../client";
import { db } from "../tenant";
import { loadStockContext, type StockContext } from "./context";
import { applyMovement } from "./movements";
import { receivePurchaseOrder } from "./purchase";
import { issueReservedForLine, repairOrderLineStock, syncRepairOrderStock } from "./repairOrders";

const now = () => new Date();

describe("stock ↔ ordres de réparation", () => {
  let orgId: string;
  let siteId: string;
  let ctx: StockContext;
  let pads: { id: string };
  let battery: { id: string };
  let oil: { id: string };
  let roId: string;
  let padsLine: { id: string };
  let batteryLine: { id: string };
  let oilLine: { id: string };
  let suppliedLine: { id: string };

  const tenant = () => db.forTenant({ organizationId: orgId });
  const sync = () => tenant().transaction((tx) => syncRepairOrderStock(tx, ctx, roId, now()));
  const state = () => tenant().transaction((tx) => repairOrderLineStock(tx, roId));
  const level = (productId: string) =>
    adminDb.stockLevel.findFirstOrThrow({ where: { siteId, productId } });

  beforeAll(async () => {
    orgId = (await adminDb.organization.create({ data: { name: "Stock × OR" } })).id;
    siteId = (
      await adminDb.site.create({ data: { organizationId: orgId, name: "Yopougon", code: "YOP" } })
    ).id;
    ctx = await loadStockContext(orgId);
    pads = await adminDb.product.create({
      data: { organizationId: orgId, sku: "PLQ", name: "Plaquettes AV" },
    });
    battery = await adminDb.product.create({
      data: { organizationId: orgId, sku: "BAT", name: "Batterie" },
    });
    oil = await adminDb.product.create({
      data: {
        organizationId: orgId,
        sku: "HU",
        name: "Huile 5W30",
        unit: "litre",
        quantityScale: 10,
      },
    });
    for (const [productId, quantity] of [
      [pads.id, 4],
      [oil.id, 100],
    ] as const) {
      await tenant().transaction((tx) =>
        applyMovement(
          tx,
          ctx,
          { siteId, productId, type: "PURCHASE_RECEIPT", quantity, unitCost: 1000 },
          now(),
        ),
      );
    }
    const customer = await adminDb.customer.create({
      data: { organizationId: orgId, displayName: "Kouassi" },
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
    roId = (
      await adminDb.repairOrder.create({
        data: {
          organizationId: orgId,
          siteId,
          number: "OR-YOP-2026-00042",
          customerId: customer.id,
          vehicleId: vehicle.id,
          status: "AWAITING_APPROVAL",
        },
      })
    ).id;
    const line = (productId: string | null, quantity: number, extra: object = {}) =>
      adminDb.repairOrderLine.create({
        data: {
          organizationId: orgId,
          repairOrderId: roId,
          type: "PART",
          productId,
          description: "Pièce",
          quantity,
          unitPrice: 10_000,
          vatRate: 18,
          approval: "PENDING",
          ...extra,
        },
      });
    padsLine = await line(pads.id, 1);
    batteryLine = await line(battery.id, 1);
    oilLine = await line(oil.id, 4.5);
    suppliedLine = await line(null, 1, { isCustomerSupplied: true, unitPrice: 0 });
  });

  afterAll(async () => {
    await adminDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET session_replication_role = replica");
      for (const table of [
        "Notification",
        "DomainEvent",
        "StockMovement",
        "StockReservation",
        "PurchaseOrderLine",
        "PurchaseOrder",
        "StockLevel",
        "RepairOrderLine",
        "RepairOrder",
        "Vehicle",
        "Customer",
        "Product",
        "Supplier",
        "Site",
      ]) {
        await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, orgId);
      }
      await tx.$executeRawUnsafe('DELETE FROM "Organization" WHERE id = $1', orgId);
      await tx.$executeRawUnsafe("SET session_replication_role = DEFAULT");
    });
  });

  it("avant accord : aucune réservation", async () => {
    expect(await sync()).toEqual({ reserved: 0, backordered: 0, released: 0 });
  });

  it("OR approuvé : pièces réservées, batterie manquante, pièce client ignorée", async () => {
    await adminDb.repairOrderLine.updateMany({
      where: { repairOrderId: roId },
      data: { approval: "APPROVED" },
    });
    await adminDb.repairOrder.update({ where: { id: roId }, data: { status: "APPROVED" } });
    expect(await sync()).toEqual({ reserved: 1 + 45, backordered: 1, released: 0 });
    const states = await state();
    expect(states.find((s) => s.lineId === padsLine.id)?.state).toBe("reserved");
    expect(states.find((s) => s.lineId === batteryLine.id)?.state).toBe("missing");
    expect(states.find((s) => s.lineId === oilLine.id)).toMatchObject({ target: 45, reserved: 45 });
    expect(states.find((s) => s.lineId === suppliedLine.id)).toBeUndefined();
    expect((await level(pads.id)).reserved).toBe(1);
    // Idempotent.
    expect(await sync()).toEqual({ reserved: 0, backordered: 0, released: 0 });
  });

  it("quantité modifiée : réservation ajustée", async () => {
    await adminDb.repairOrderLine.update({ where: { id: padsLine.id }, data: { quantity: 2 } });
    await sync();
    expect((await level(pads.id)).reserved).toBe(2);
    await adminDb.repairOrderLine.update({ where: { id: padsLine.id }, data: { quantity: 1 } });
    await sync();
    expect((await level(pads.id)).reserved).toBe(1);
  });

  it("réception de la batterie : la réservation manquante est servie", async () => {
    const supplier = await adminDb.supplier.create({
      data: { organizationId: orgId, name: "CFAO" },
    });
    const po = await adminDb.purchaseOrder.create({
      data: {
        organizationId: orgId,
        siteId,
        supplierId: supplier.id,
        number: "BC-YOP-2026-00001",
        status: "SENT",
        lines: {
          create: [{ organizationId: orgId, productId: battery.id, quantity: 1, unitCost: 40_000 }],
        },
      },
      include: { lines: true },
    });
    await tenant().transaction((tx) =>
      receivePurchaseOrder(
        tx,
        ctx,
        {
          purchaseOrderId: po.id,
          lines: [{ lineId: po.lines[0]!.id, quantity: 1, unitCost: 40_000 }],
        },
        now(),
      ),
    );
    expect((await state()).find((s) => s.lineId === batteryLine.id)?.state).toBe("reserved");
  });

  it("ligne terminée : sortie des pièces réservées au CMP", async () => {
    const movements = await tenant().transaction((tx) =>
      issueReservedForLine(tx, ctx, padsLine.id, now()),
    );
    expect(movements.map((m) => [m.type, m.quantity, m.repairOrderLineId])).toEqual([
      ["ISSUE_TO_RO", -1, padsLine.id],
    ]);
    expect(await level(pads.id)).toMatchObject({ onHand: 3, reserved: 0 });
    expect((await state()).find((s) => s.lineId === padsLine.id)?.state).toBe("issued");
    // Déjà sortie : le sync ne réserve pas une seconde fois.
    await sync();
    expect((await level(pads.id)).reserved).toBe(0);
  });

  it("ligne refusée puis OR annulé : réservations libérées", async () => {
    await adminDb.repairOrderLine.update({
      where: { id: oilLine.id },
      data: { approval: "DECLINED" },
    });
    await sync();
    expect((await level(oil.id)).reserved).toBe(0);
    await adminDb.repairOrder.update({ where: { id: roId }, data: { status: "CANCELLED" } });
    const r = await sync();
    expect(r.released).toBeGreaterThanOrEqual(1);
    expect((await level(battery.id)).reserved).toBe(0);
    const open = await adminDb.stockReservation.count({
      where: { repairOrderId: roId, status: { in: ["RESERVED", "BACKORDERED"] } },
    });
    expect(open).toBe(0);
  });
});
