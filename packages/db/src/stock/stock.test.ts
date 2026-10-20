// M07 §12 — tests d'intégration des services de stock sur une vraie base Postgres :
// réservations concurrentes, réception partielle puis totale (statuts, CMP, backorders),
// refus du stock négatif, intégrité onHand = Σ mouvements, inventaire, transfert, isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../client";
import { db } from "../tenant";
import { loadStockContext, type StockContext } from "./context";
import { validateCount, createCount, setCountLine, startCount, submitCount } from "./counts";
import { runIntegrityCheck } from "./jobs";
import { applyMovement } from "./movements";
import { computeReorderSuggestions, receivePurchaseOrder } from "./purchase";
import {
  consumeForRepairOrder,
  issueStock,
  releaseForRepairOrder,
  reserveStock,
  returnFromRepairOrder,
} from "./reservations";
import { createTransfer, receiveTransfer, shipTransfer } from "./transfers";

const now = () => new Date();

describe("services de stock M07", () => {
  let orgId: string;
  let otherOrgId: string;
  let yop: { id: string };
  let coc: { id: string };
  let filter: { id: string };
  let pads: { id: string };
  let oil: { id: string };
  let supplier: { id: string };
  let ro1: { id: string };
  let ro2: { id: string };
  let ctx: StockContext;

  beforeAll(async () => {
    const org = await adminDb.organization.create({ data: { name: "Test Stock M07" } });
    const other = await adminDb.organization.create({ data: { name: "Test Stock M07 B" } });
    orgId = org.id;
    otherOrgId = other.id;
    yop = await adminDb.site.create({
      data: { organizationId: orgId, name: "Yopougon", code: "YOP" },
    });
    coc = await adminDb.site.create({
      data: { organizationId: orgId, name: "Cocody", code: "COC" },
    });
    supplier = await adminDb.supplier.create({ data: { organizationId: orgId, name: "CFAO" } });
    filter = await adminDb.product.create({
      data: {
        organizationId: orgId,
        sku: "FH-TOY-001",
        name: "Filtre à huile Corolla",
        salePrice: 6000,
        minStock: 10,
        defaultSupplierId: supplier.id,
      },
    });
    pads = await adminDb.product.create({
      data: { organizationId: orgId, sku: "PLQ-AV-01", name: "Plaquettes AV", salePrice: 25000 },
    });
    oil = await adminDb.product.create({
      data: {
        organizationId: orgId,
        sku: "HU-5W30",
        name: "Huile 5W30",
        unit: "litre",
        quantityScale: 10,
      },
    });
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
    ro1 = await adminDb.repairOrder.create({
      data: {
        organizationId: orgId,
        siteId: yop.id,
        number: "OR-YOP-2026-00041",
        customerId: customer.id,
        vehicleId: vehicle.id,
      },
    });
    ro2 = await adminDb.repairOrder.create({
      data: {
        organizationId: orgId,
        siteId: yop.id,
        number: "OR-YOP-2026-00042",
        customerId: customer.id,
        vehicleId: vehicle.id,
      },
    });
    ctx = await loadStockContext(orgId);
    // Stock initial : 12 filtres à 3 500 (CMP).
    await db.forTenant({ organizationId: orgId }).transaction((tx) =>
      applyMovement(
        tx,
        ctx,
        {
          siteId: yop.id,
          productId: filter.id,
          type: "PURCHASE_RECEIPT",
          quantity: 12,
          unitCost: 3500,
        },
        now(),
      ),
    );
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      await adminDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET session_replication_role = replica");
        for (const table of [
          "Notification",
          "DomainEvent",
          "StockMovement",
          "StockReservation",
          "StockCountLine",
          "StockCount",
          "StockTransferLine",
          "StockTransfer",
          "PurchaseOrderLine",
          "PurchaseOrder",
          "StockLevel",
          "Product",
          "Supplier",
          "RepairOrder",
          "Vehicle",
          "Customer",
          "DocumentSequence",
          "Site",
        ]) {
          await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, id);
        }
        await tx.$executeRawUnsafe('DELETE FROM "Organization" WHERE id = $1', id);
        await tx.$executeRawUnsafe("SET session_replication_role = DEFAULT");
      });
    }
  });

  const tenant = () => db.forTenant({ organizationId: orgId });

  it("refuse une sortie supérieure au stock (stock négatif interdit)", async () => {
    await expect(
      tenant().transaction((tx) =>
        issueStock(tx, ctx, { productId: filter.id, siteId: yop.id, quantity: 13 }, now()),
      ),
    ).rejects.toThrow("Stock insuffisant : 12 disponibles à YOP");
    const level = await adminDb.stockLevel.findFirstOrThrow({
      where: { siteId: yop.id, productId: filter.id },
    });
    expect(level.onHand).toBe(12);
  });

  it("réception partielle puis totale : CMP 3 688, statuts, écart de prix", async () => {
    const po = await adminDb.purchaseOrder.create({
      data: {
        organizationId: orgId,
        siteId: yop.id,
        supplierId: supplier.id,
        number: "BC-YOP-2026-00008",
        status: "SENT",
        lines: {
          create: [
            { organizationId: orgId, productId: filter.id, quantity: 20, unitCost: 3600 },
            { organizationId: orgId, productId: pads.id, quantity: 10, unitCost: 18000 },
          ],
        },
      },
      include: { lines: true },
    });
    const filterLine = po.lines.find((l) => l.productId === filter.id)!;
    const padsLine = po.lines.find((l) => l.productId === pads.id)!;

    // Une réservation BACKORDERED de plaquettes attend cette commande.
    const reserved = await tenant().transaction((tx) =>
      reserveStock(
        tx,
        ctx,
        { siteId: yop.id, productId: pads.id, quantity: 1, repairOrderId: ro2.id },
        now(),
      ),
    );
    expect(reserved).toMatchObject({ reserved: 0, backordered: 1 });

    const first = await tenant().transaction((tx) =>
      receivePurchaseOrder(
        tx,
        ctx,
        {
          purchaseOrderId: po.id,
          lines: [
            { lineId: filterLine.id, quantity: 20, unitCost: 3800 },
            { lineId: padsLine.id, quantity: 6, unitCost: 18000 },
          ],
        },
        now(),
      ),
    );
    expect(first.purchaseOrder.status).toBe("PARTIALLY_RECEIVED");
    expect(first.movements).toHaveLength(2);
    expect(first.priceVariances).toEqual([
      expect.objectContaining({ productId: filter.id, expected: 3600, actual: 3800, diff: 200 }),
    ]);
    expect(first.promoted).toEqual([
      expect.objectContaining({ repairOrderId: ro2.id, quantity: 1 }),
    ]);
    const product = await adminDb.product.findUniqueOrThrow({ where: { id: filter.id } });
    expect(product).toMatchObject({ averageCost: 3688, purchasePrice: 3800 });
    const padsLevel = await adminDb.stockLevel.findFirstOrThrow({
      where: { siteId: yop.id, productId: pads.id },
    });
    expect(padsLevel).toMatchObject({ onHand: 6, reserved: 1 });

    await expect(
      tenant().transaction((tx) =>
        receivePurchaseOrder(
          tx,
          ctx,
          {
            purchaseOrderId: po.id,
            lines: [{ lineId: padsLine.id, quantity: 4, unitCost: 180000 }],
          },
          now(),
        ),
      ),
    ).rejects.toThrow("Prix 180");

    const second = await tenant().transaction((tx) =>
      receivePurchaseOrder(
        tx,
        ctx,
        { purchaseOrderId: po.id, lines: [{ lineId: padsLine.id, quantity: 4, unitCost: 18000 }] },
        now(),
      ),
    );
    expect(second.purchaseOrder.status).toBe("RECEIVED");
    expect(second.purchaseOrder.receivedAt).not.toBeNull();
  });

  it("réservations concurrentes de la dernière unité : une RESERVED, une BACKORDERED", async () => {
    const battery = await adminDb.product.create({
      data: { organizationId: orgId, sku: "BAT-01", name: "Batterie 12V" },
    });
    await tenant().transaction((tx) =>
      applyMovement(
        tx,
        ctx,
        {
          siteId: yop.id,
          productId: battery.id,
          type: "PURCHASE_RECEIPT",
          quantity: 1,
          unitCost: 40000,
        },
        now(),
      ),
    );
    const results = await Promise.all(
      [ro1.id, ro2.id].map((repairOrderId) =>
        tenant().transaction((tx) =>
          reserveStock(
            tx,
            ctx,
            { siteId: yop.id, productId: battery.id, quantity: 1, repairOrderId },
            now(),
          ),
        ),
      ),
    );
    expect(results.map((r) => r.reserved).sort()).toEqual([0, 1]);
    const loser = results.find((r) => r.backordered === 1)!;
    expect(loser.lastReservedBy).toMatch(/^OR-YOP-2026-0004[12]$/);
    const level = await adminDb.stockLevel.findFirstOrThrow({
      where: { siteId: yop.id, productId: battery.id },
    });
    expect(level).toMatchObject({ onHand: 1, reserved: 1 });
  });

  it("réserve, sort vers l'OR (au CMP), retourne et libère", async () => {
    const r = await tenant().transaction((tx) =>
      reserveStock(
        tx,
        ctx,
        { siteId: yop.id, productId: filter.id, quantity: 2, repairOrderId: ro1.id },
        now(),
      ),
    );
    expect(r.reserved).toBe(2);
    const movements = await tenant().transaction((tx) =>
      consumeForRepairOrder(
        tx,
        ctx,
        { productId: filter.id, quantity: 3, repairOrderId: ro1.id },
        now(),
      ),
    );
    expect(movements.map((m) => [m.type, m.quantity, m.unitCost])).toEqual([
      ["ISSUE_TO_RO", -2, 3688],
      ["ISSUE_TO_RO", -1, 3688],
    ]);
    let level = await adminDb.stockLevel.findFirstOrThrow({
      where: { siteId: yop.id, productId: filter.id },
    });
    expect(level).toMatchObject({ onHand: 29, reserved: 0 });
    const issued = await adminDb.stockReservation.findUniqueOrThrow({
      where: { id: r.reservations[0]!.id },
    });
    expect(issued.status).toBe("ISSUED");

    const back = await tenant().transaction((tx) =>
      returnFromRepairOrder(
        tx,
        ctx,
        {
          repairOrderId: ro1.id,
          productId: filter.id,
          siteId: yop.id,
          quantity: 1,
          resellable: true,
        },
        now(),
      ),
    );
    expect(back.map((m) => [m.type, m.quantity, m.unitCost])).toEqual([
      ["RETURN_FROM_RO", 1, 3688],
    ]);
    await expect(
      tenant().transaction((tx) =>
        returnFromRepairOrder(
          tx,
          ctx,
          {
            repairOrderId: ro1.id,
            productId: filter.id,
            siteId: yop.id,
            quantity: 5,
            resellable: true,
          },
          now(),
        ),
      ),
    ).rejects.toThrow("dépasse la quantité sortie");

    await tenant().transaction((tx) =>
      reserveStock(
        tx,
        ctx,
        { siteId: yop.id, productId: filter.id, quantity: 4, repairOrderId: ro2.id },
        now(),
      ),
    );
    const released = await tenant().transaction((tx) =>
      releaseForRepairOrder(tx, ctx, ro2.id, now()),
    );
    expect(released).toBeGreaterThanOrEqual(1);
    level = await adminDb.stockLevel.findFirstOrThrow({
      where: { siteId: yop.id, productId: filter.id },
    });
    expect(level.reserved).toBe(0);
  });

  it("unités fractionnaires : sortie de 4,5 L = −45", async () => {
    await tenant().transaction((tx) =>
      applyMovement(
        tx,
        ctx,
        {
          siteId: yop.id,
          productId: oil.id,
          type: "PURCHASE_RECEIPT",
          quantity: 2080,
          unitCost: 4000,
        },
        now(),
      ),
    );
    const [m] = await tenant().transaction((tx) =>
      consumeForRepairOrder(
        tx,
        ctx,
        { productId: oil.id, quantity: 45, repairOrderId: ro1.id },
        now(),
      ),
    );
    expect(m!.quantity).toBe(-45);
    const level = await adminDb.stockLevel.findFirstOrThrow({
      where: { siteId: yop.id, productId: oil.id },
    });
    expect(level.onHand).toBe(2035);
  });

  it("transfert 5 envoyés, 4 reçus : TRANSFER_OUT/IN et écart signalé", async () => {
    const transfer = await tenant().transaction((tx) =>
      createTransfer(
        tx,
        ctx,
        { fromSiteId: yop.id, toSiteId: coc.id, lines: [{ productId: filter.id, quantity: 5 }] },
        now(),
      ),
    );
    expect(transfer.number).toMatch(/^TR-YOP-\d{4}-00001$/);
    await tenant().transaction((tx) => shipTransfer(tx, ctx, transfer.id, null, now()));
    const line = await adminDb.stockTransferLine.findFirstOrThrow({
      where: { stockTransferId: transfer.id },
    });
    const { shortfalls } = await tenant().transaction((tx) =>
      receiveTransfer(
        tx,
        ctx,
        {
          transferId: transfer.id,
          lines: [{ lineId: line.id, receivedQty: 4 }],
          createdById: null,
        },
        now(),
      ),
    );
    expect(shortfalls).toEqual([{ lineId: line.id, shortfall: 1 }]);
    const cocLevel = await adminDb.stockLevel.findFirstOrThrow({
      where: { siteId: coc.id, productId: filter.id },
    });
    expect(cocLevel.onHand).toBe(4);
  });

  it("inventaire : théorique figé, écart −1 validé en COUNT_CORRECTION", async () => {
    const count = await tenant().transaction((tx) =>
      createCount(tx, ctx, { siteId: yop.id, scope: {} }, now()),
    );
    expect(count.number).toMatch(/^INV-YOP-\d{4}-00001$/);
    await tenant().transaction((tx) => startCount(tx, count.id, now()));
    const line = await adminDb.stockCountLine.findFirstOrThrow({
      where: { stockCountId: count.id, productId: filter.id },
    });
    expect(line.expectedQty).toBe(25);
    // Mouvement pendant le comptage, ligne non comptée : ajouté au théorique.
    await tenant().transaction((tx) =>
      consumeForRepairOrder(
        tx,
        ctx,
        { productId: filter.id, quantity: 1, repairOrderId: ro1.id },
        now(),
      ),
    );
    expect(
      (await adminDb.stockCountLine.findUniqueOrThrow({ where: { id: line.id } })).expectedQty,
    ).toBe(24);
    await tenant().transaction((tx) =>
      setCountLine(tx, { countId: count.id, productId: filter.id, countedQty: 23 }, now()),
    );
    await tenant().transaction((tx) => submitCount(tx, count.id, now()));
    const membership = await adminDb.user
      .create({ data: { name: "Gérant", email: `gerant-${Date.now()}@example.com` } })
      .then((u) =>
        adminDb.membership.create({
          data: { organizationId: orgId, userId: u.id, role: "MANAGER" },
        }),
      );
    const { corrections, summary } = await tenant().transaction((tx) =>
      validateCount(
        tx,
        ctx,
        { countId: count.id, validatedById: membership.id, validatorRole: "MANAGER" },
        now(),
      ),
    );
    expect(corrections).toBe(1);
    expect(summary.netValue).toBe(-3688);
    const correction = await adminDb.stockMovement.findFirstOrThrow({
      where: { countId: count.id },
    });
    expect(correction).toMatchObject({ type: "COUNT_CORRECTION", quantity: -1 });
  });

  it("suggestions de réapprovisionnement groupées par fournisseur", async () => {
    // Filtre : min 10 ; on vide le stock YOP par un ajustement.
    const level = await adminDb.stockLevel.findFirstOrThrow({
      where: { siteId: yop.id, productId: filter.id },
    });
    await tenant().transaction((tx) =>
      applyMovement(
        tx,
        ctx,
        {
          siteId: yop.id,
          productId: filter.id,
          type: "ADJUSTMENT",
          quantity: -(level.onHand - 6),
          reasonCode: "perte",
        },
        now(),
      ),
    );
    const groups = await tenant().transaction((tx) => computeReorderSuggestions(tx, yop.id));
    const group = groups.find((g) => g.supplierId === supplier.id)!;
    expect(group.lines.find((l) => l.productId === filter.id)).toMatchObject({
      projected: 6,
      suggestedQty: 14,
      reason: "below_min",
    });
    const events = await adminDb.domainEvent.findMany({
      where: { organizationId: orgId, type: "stock.below_minimum" },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("intégrité : onHand = Σ mouvements, écart détecté sinon", async () => {
    expect(await runIntegrityCheck(orgId, now())).toEqual([]);
    await adminDb.stockLevel.updateMany({
      where: { siteId: yop.id, productId: pads.id },
      data: { onHand: { increment: 1 } },
    });
    const mismatches = await runIntegrityCheck(orgId, now());
    expect(mismatches).toEqual([
      expect.objectContaining({ productId: pads.id, onHand: 11, movementsSum: 10 }),
    ]);
    await adminDb.stockLevel.updateMany({
      where: { siteId: yop.id, productId: pads.id },
      data: { onHand: { decrement: 1 } },
    });
  });

  it("isolation : une autre organisation ne voit ni ne réserve les produits de A", async () => {
    const otherCtx = await loadStockContext(otherOrgId);
    const other = db.forTenant({ organizationId: otherOrgId });
    expect(await other.product.findMany({})).toEqual([]);
    expect(await other.stockMovement.findMany({})).toEqual([]);
    await expect(
      other.transaction((tx) =>
        reserveStock(tx, otherCtx, { siteId: yop.id, productId: filter.id, quantity: 1 }, now()),
      ),
    ).rejects.toThrow();
  });
});
