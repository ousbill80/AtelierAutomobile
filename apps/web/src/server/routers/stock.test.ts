import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// M07 — routeurs product / stock / supplier / purchaseOrder / stockCount / stockTransfer :
// parcours réception → réservation → sortie → inventaire, permissions et isolation A/B.

const callerFactory = createCallerFactory(appRouter);
type Caller = ReturnType<typeof callerFactory>;
type Role = "OWNER" | "MANAGER" | "ADVISOR" | "MECHANIC" | "STOREKEEPER" | "CASHIER";

async function callerFor(organizationId: string, role: Role, users: string[]): Promise<Caller> {
  const user = await adminDb.user.create({
    data: { name: `${role} test`, email: `${randomBytes(5).toString("hex")}@example.com` },
  });
  users.push(user.id);
  await adminDb.membership.create({ data: { organizationId, userId: user.id, role, siteIds: [] } });
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

const TABLES = [
  "AuditLog",
  "Notification",
  "DomainEvent",
  "Message",
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
  "Membership",
  "Site",
];

describe("routeurs stock et achats (M07)", () => {
  const users: string[] = [];
  let orgA: string;
  let orgB: string;
  let yop: string;
  let coc: string;
  let owner: Caller;
  let storekeeper: Caller;
  let advisor: Caller;
  let mechanic: Caller;
  let cashier: Caller;
  let ownerB: Caller;
  let filterId: string;
  let padsId: string;
  let vehicleId: string;
  let roId: string;
  let countId: string;
  let transferId: string;

  beforeAll(async () => {
    orgA = (await adminDb.organization.create({ data: { name: "Garage Stock A" } })).id;
    orgB = (await adminDb.organization.create({ data: { name: "Garage Stock B" } })).id;
    yop = (
      await adminDb.site.create({ data: { organizationId: orgA, name: "Yopougon", code: "YOP" } })
    ).id;
    coc = (
      await adminDb.site.create({ data: { organizationId: orgA, name: "Cocody", code: "COC" } })
    ).id;
    await adminDb.site.create({ data: { organizationId: orgB, name: "Plateau", code: "PLA" } });
    owner = await callerFor(orgA, "OWNER", users);
    storekeeper = await callerFor(orgA, "STOREKEEPER", users);
    advisor = await callerFor(orgA, "ADVISOR", users);
    mechanic = await callerFor(orgA, "MECHANIC", users);
    cashier = await callerFor(orgA, "CASHIER", users);
    ownerB = await callerFor(orgB, "OWNER", users);
    const customer = await adminDb.customer.create({
      data: { organizationId: orgA, displayName: "Kouassi Jean-Marc" },
    });
    vehicleId = (
      await adminDb.vehicle.create({
        data: {
          organizationId: orgA,
          customerId: customer.id,
          plate: "2547 GH 01",
          plateCompact: "2547GH01",
          make: "Toyota",
          model: "Corolla",
          year: 2016,
        },
      })
    ).id;
    roId = (
      await adminDb.repairOrder.create({
        data: {
          organizationId: orgA,
          siteId: yop,
          number: "OR-YOP-2026-00042",
          customerId: customer.id,
          vehicleId,
          status: "APPROVED",
        },
      })
    ).id;
  });

  afterAll(async () => {
    for (const id of [orgA, orgB]) {
      await adminDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET session_replication_role = replica");
        for (const table of TABLES) {
          await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, id);
        }
        await tx.$executeRawUnsafe('DELETE FROM "Organization" WHERE id = $1', id);
        await tx.$executeRawUnsafe("SET session_replication_role = DEFAULT");
      });
    }
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
  });

  it("catalogue : création, SKU et code-barres uniques", async () => {
    const filter = await storekeeper.product.create({
      sku: "FH-TOY-001",
      name: "Filtre à huile",
      brand: "Toyota",
      oemReference: "04152-YZZA1",
      barcode: "4987654321098",
      category: "Filtration",
      salePrice: 6000,
      minSalePrice: 4500,
      minStock: 10,
      compatibleWith: ["TOYOTA|COROLLA|2014-2019"],
      crossReferences: ["w 712/75"],
    });
    filterId = filter.id;
    expect(filter.quantityScale).toBe(1);
    expect(filter.crossReferences).toEqual(["W712/75"]);
    padsId = (
      await storekeeper.product.create({
        sku: "PLQ-AV-01",
        name: "Plaquettes avant",
        salePrice: 25000,
      })
    ).id;
    const oil = await storekeeper.product.create({
      sku: "HU-5W30",
      name: "Huile 5W30",
      unit: "litre",
    });
    expect(oil.quantityScale).toBe(10);

    await expect(
      storekeeper.product.create({ sku: "FH-TOY-001", name: "Doublon" }),
    ).rejects.toThrow("Le SKU FH-TOY-001 existe déjà.");
    await expect(
      storekeeper.product.create({ sku: "FH-2", name: "Autre", barcode: "4987654321098" }),
    ).rejects.toThrow("Ce code-barres est déjà affecté au produit « Filtre à huile ».");
    await expect(mechanic.product.create({ sku: "X", name: "Interdit" })).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("recherche : référence OEM, mots libres, code-barres, compatibles d'abord", async () => {
    const byOem = await advisor.product.search({ q: "04152-YZZA1" });
    expect(byOem.items.map((p) => p.sku)).toEqual(["FH-TOY-001"]);
    const words = await advisor.product.search({ q: "filtre huile corolla" });
    expect(words.items.map((p) => p.sku)).toEqual(["FH-TOY-001"]);
    const scan = await advisor.product.search({ q: "4987654321098" });
    expect(scan.items.map((p) => p.sku)).toEqual(["FH-TOY-001"]);
    const crossRef = await advisor.product.search({ q: "W712/75" });
    expect(crossRef.items).toHaveLength(1);
    const forVehicle = await advisor.product.search({ vehicleId });
    expect(forVehicle.items[0]).toMatchObject({ sku: "FH-TOY-001", compatible: true });
    expect(forVehicle.items.find((p) => p.sku === "PLQ-AV-01")?.compatible).toBe(false);
    await expect(cashier.product.search({})).rejects.toThrow("Permission manquante");
  });

  it("achat : BC, envoi manuel, réception partielle puis totale → CMP 3 688", async () => {
    const supplier = await storekeeper.supplier.create({
      name: "CFAO Motors",
      whatsappPhone: "07 47 21 88 90",
      paymentTermsDays: 30,
    });
    expect(supplier.whatsappPhone).toBe("+2250747218890");
    // Stock initial : 12 filtres à 3 500.
    const opening = await storekeeper.purchaseOrder.create({
      supplierId: supplier.id,
      siteId: yop,
      lines: [{ productId: filterId, quantity: 12, unitCost: 3500 }],
    });
    expect(opening.number).toMatch(/^BC-YOP-\d{4}-00001$/);
    await storekeeper.purchaseOrder.send({ id: opening.id, channel: "MANUAL" });
    const openingLines = (await storekeeper.purchaseOrder.get({ id: opening.id })).lines;
    await storekeeper.purchaseOrder.receive({
      id: opening.id,
      lines: [{ lineId: openingLines[0]!.id, quantity: 12, unitCost: 3500 }],
    });

    const po = await storekeeper.purchaseOrder.create({
      supplierId: supplier.id,
      siteId: yop,
      expectedAt: "2026-10-25",
      lines: [
        { productId: filterId, quantity: 20, unitCost: 3600 },
        { productId: padsId, quantity: 10, unitCost: 18000 },
      ],
    });
    expect(po.total).toBe(252_000);
    const link = await storekeeper.purchaseOrder.send({ id: po.id, channel: "LINK" });
    expect(link.purchaseOrder.status).toBe("SENT");
    expect(link.waLink).toMatch(/^https:\/\/wa\.me\/2250747218890\?text=/);

    const detail = await storekeeper.purchaseOrder.get({ id: po.id });
    const filterLine = detail.lines.find((l) => l.productId === filterId)!;
    const padsLine = detail.lines.find((l) => l.productId === padsId)!;
    const received = await storekeeper.purchaseOrder.receive({
      id: po.id,
      lines: [
        { lineId: filterLine.id, quantity: 20, unitCost: 3800 },
        { lineId: padsLine.id, quantity: 6, unitCost: 18000 },
      ],
    });
    expect(received.purchaseOrder.status).toBe("PARTIALLY_RECEIVED");
    expect(received.priceVariances).toHaveLength(1);
    const product = await storekeeper.product.get({ id: filterId });
    expect(product.product.averageCost).toBe(3688);
    expect(product.product.levels.find((l) => l.siteCode === "YOP")).toMatchObject({ onHand: 32 });

    await expect(owner.purchaseOrder.cancel({ id: po.id, reason: "plus besoin" })).rejects.toThrow(
      "soldez le reliquat",
    );
    await storekeeper.purchaseOrder.receive({
      id: po.id,
      lines: [{ lineId: padsLine.id, quantity: 4, unitCost: 18000 }],
    });
    expect((await storekeeper.purchaseOrder.get({ id: po.id })).status).toBe("RECEIVED");
  });

  it("coûts masqués sans product:view_cost", async () => {
    const asMechanic = await mechanic.product.get({ id: filterId });
    expect(asMechanic.product.averageCost).toBeNull();
    expect(asMechanic.movements.every((m) => m.unitCost === null)).toBe(true);
    const check = await advisor.product.checkPrice({
      productId: filterId,
      unitPrice: 3000,
      discountRate: 0,
    });
    expect(check).toMatchObject({
      belowMin: true,
      belowCost: true,
      averageCost: null,
      canOverride: false,
    });
  });

  it("réservation par numéro d'OR, file magasin, sortie, retour", async () => {
    const reserved = await advisor.stock.reserve({
      productId: filterId,
      siteId: yop,
      quantity: 1,
      repairOrderNumber: "OR-YOP-2026-00042",
    });
    expect(reserved).toMatchObject({ reserved: 1, backordered: 0 });
    await expect(
      advisor.stock.issue({ productId: filterId, siteId: yop, quantity: 1, repairOrderId: roId }),
    ).rejects.toThrow("Permission manquante");

    const queue = await storekeeper.stock.queue({ siteId: yop });
    const item = queue.find((q) => q.product.id === filterId)!;
    expect(item).toMatchObject({
      status: "RESERVED",
      repairOrder: { number: "OR-YOP-2026-00042", plate: "2547 GH 01" },
    });

    const { movement } = await storekeeper.stock.issue({
      reservationId: item.id,
      productId: filterId,
      siteId: yop,
      quantity: 1,
    });
    expect(movement).toMatchObject({
      type: "ISSUE_TO_RO",
      quantity: -1,
      unitCost: 3688,
      repairOrderId: roId,
    });
    expect(
      (await storekeeper.stock.queue({ siteId: yop })).find((q) => q.id === item.id),
    ).toBeUndefined();

    const back = await storekeeper.stock.returnFromRo({
      repairOrderId: roId,
      productId: filterId,
      siteId: yop,
      quantity: 1,
      resellable: true,
    });
    expect(back.movements[0]).toMatchObject({
      type: "RETURN_FROM_RO",
      quantity: 1,
      unitCost: 3688,
    });

    await expect(
      storekeeper.stock.issue({
        productId: filterId,
        siteId: yop,
        quantity: 100,
        repairOrderId: roId,
      }),
    ).rejects.toThrow("Stock insuffisant : 32 disponibles à YOP");
  });

  it("ajustement : permission stock:adjust, motif et audit", async () => {
    await expect(
      storekeeper.stock.adjust({
        siteId: yop,
        productId: padsId,
        quantity: -1,
        reasonCode: "casse",
        reason: "Tombé",
      }),
    ).rejects.toThrow("Permission manquante");
    await owner.stock.adjust({
      siteId: yop,
      productId: padsId,
      quantity: -1,
      reasonCode: "casse",
      reason: "Tombé au sol",
    });
    const audit = await adminDb.auditLog.findFirstOrThrow({
      where: { organizationId: orgA, action: "stock.adjust", entityId: padsId },
    });
    expect(audit.reason).toBe("Tombé au sol");
    const movements = await owner.stock.movements({ productId: padsId, type: "ADJUSTMENT" });
    expect(movements.items[0]).toMatchObject({ quantity: -1, reasonCode: "casse", value: -18000 });
    const csv = await owner.stock.movementsCsv({ productId: padsId });
    expect(csv.content.split("\n")[0]).toContain("Date;Site;Type;SKU");
  });

  it("inventaire : écart −1 validé, valorisation et transfert", async () => {
    const count = await storekeeper.stockCount.create({
      siteId: yop,
      scope: { categories: ["Filtration"] },
    });
    countId = count.id;
    await storekeeper.stockCount.start({ id: count.id });
    const sheet = await storekeeper.stockCount.get({ id: count.id });
    expect(sheet.lines.map((l) => [l.product.sku, l.expectedQty])).toEqual([["FH-TOY-001", 32]]);
    await storekeeper.stockCount.setLine({
      countId: count.id,
      productId: filterId,
      countedQty: 31,
    });
    await storekeeper.stockCount.submit({ id: count.id });
    await expect(storekeeper.stockCount.validate({ id: count.id })).rejects.toThrow(
      "Permission manquante",
    );
    const validated = await owner.stockCount.validate({ id: count.id });
    expect(validated).toMatchObject({
      corrections: 1,
      count: { status: "VALIDATED", varianceValue: -3688 },
    });

    const valuation = await owner.stock.valuation({ groupBy: "category" });
    expect(valuation.groups.find((g) => g.label === "Filtration")?.value).toBe(31 * 3688);

    const transfer = await storekeeper.stockTransfer.create({
      fromSiteId: yop,
      toSiteId: coc,
      lines: [{ productId: filterId, quantity: 5 }],
    });
    transferId = transfer.id;
    await storekeeper.stockTransfer.ship({ id: transfer.id });
    const t = await storekeeper.stockTransfer.get({ id: transfer.id });
    const received = await storekeeper.stockTransfer.receive({
      id: transfer.id,
      lines: [{ lineId: t.lines[0]!.id, receivedQty: 4 }],
    });
    expect(received.shortfalls).toHaveLength(1);
    const levels = (await owner.product.get({ id: filterId })).product.levels;
    expect(levels.map((l) => [l.siteCode, l.onHand])).toEqual([
      ["COC", 4],
      ["YOP", 26],
    ]);
  });

  it("suggestions de réapprovisionnement → BC en un clic", async () => {
    const groups = await storekeeper.purchaseOrder.suggestions({ siteId: coc });
    const line = groups.flatMap((g) => g.lines).find((l) => l.productId === filterId);
    // min 10, prévisionnel 4 → max (2 × 10) − 4 = 16.
    expect(line).toMatchObject({ projected: 4, suggestedQty: 16 });
  });

  it("isolation : l'organisation B ne voit ni ne modifie rien de A", async () => {
    expect((await ownerB.product.search({})).items).toEqual([]);
    await expect(ownerB.product.get({ id: filterId })).rejects.toThrow("Produit introuvable.");
    expect(await ownerB.purchaseOrder.list({})).toEqual([]);
    expect(await ownerB.supplier.list({})).toEqual([]);
    expect((await ownerB.stock.movements({})).items).toEqual([]);
    await expect(
      ownerB.stock.reserve({ productId: filterId, siteId: yop, quantity: 1 }),
    ).rejects.toThrow();
    await expect(ownerB.product.update({ id: filterId, name: "Piraté" })).rejects.toThrow(
      "Produit introuvable.",
    );
    expect((await owner.product.get({ id: filterId })).product.name).toBe("Filtre à huile");
    expect(await ownerB.stockCount.list({})).toEqual([]);
    await expect(ownerB.stockCount.get({ id: countId })).rejects.toThrow("Inventaire introuvable.");
    expect(await ownerB.stockTransfer.list({})).toEqual([]);
    await expect(ownerB.stockTransfer.get({ id: transferId })).rejects.toThrow(
      "Transfert introuvable.",
    );
    await expect(ownerB.stockTransfer.ship({ id: transferId })).rejects.toThrow();
    await expect(ownerB.purchaseOrder.get({ id: "x" })).rejects.toThrow(
      "Bon de commande introuvable.",
    );
  });
});
