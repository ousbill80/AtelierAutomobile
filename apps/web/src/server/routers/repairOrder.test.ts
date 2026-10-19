import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeSessionAbsoluteExpiry, fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createContext } from "../context";
import { setRepairOrdersClock } from "../repairOrders/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// Pas de Redis dans les tests : le job d'envoi (après commit) est simulé.
vi.mock("../messaging/queue", () => ({ enqueueMessageSendJob: vi.fn(async () => undefined) }));

const callerFactory = createCallerFactory(appRouter);
type Caller = ReturnType<typeof callerFactory>;
type Role = "OWNER" | "MANAGER" | "ADVISOR" | "MECHANIC";

async function contextFor(token: string | null) {
  const req = new Request("http://localhost/api/trpc", {
    headers: token ? { cookie: `atelieros_session=${token}` } : {},
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function member(organizationId: string, name: string, role: Role) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds: [] },
  });
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
  return {
    userId: user.id,
    membershipId: membership.id,
    caller: callerFactory(await contextFor(token)),
  };
}

const NOW = new Date("2026-10-19T09:00:00.000Z");
const PHOTO = Buffer.from("fake-webp-bytes").toString("base64");
const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("repairOrder routers (M04)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  const users: string[] = [];
  let owner: Caller;
  let advisor: Caller;
  let mechanic: Caller;
  let mechanicMembershipId: string;
  let callerB: Caller;
  let customer: { id: string };
  let vehicle: { id: string };
  let vehicle2: { id: string };
  let vidange: { id: string };
  let huile: { id: string };

  async function photos(caller: Caller, draftKey: string, n = 4): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const res = await caller.repairOrder.uploadAttachment({
        draftKey,
        kind: "photo_checkin",
        mimeType: "image/webp",
        dataBase64: PHOTO,
      });
      ids.push(res.attachmentId);
    }
    return ids;
  }

  async function checkIn(
    caller: Caller,
    overrides: Partial<Parameters<Caller["repairOrder"]["checkIn"]>[0]> = {},
  ) {
    const clientRequestId = overrides.clientRequestId ?? `req-${randomBytes(6).toString("hex")}`;
    const photoIds = await photos(caller, clientRequestId);
    return caller.repairOrder.checkIn({
      customerId: customer.id,
      vehicleId: vehicle.id,
      mileageIn: 48_200,
      fuelLevel: 3,
      complaint: "Bruit au freinage à l'avant + vidange",
      checkIn: {
        damages: [
          {
            n: 1,
            view: "LEFT",
            x: 0.2,
            y: 0.4,
            zone: "Aile AVG",
            type: "SCRATCH",
            severity: "LIGHT",
            attachmentIds: [],
          },
        ],
        items: [{ key: "spare_wheel", present: true }],
        keysCount: 2,
        belongings: "Sac noir dans le coffre — client informé",
        authorizationCeiling: 50_000,
        photoAttachmentIds: photoIds,
      },
      initialLines: [
        {
          type: "LABOR",
          laborOperationId: vidange.id,
          description: "Vidange moteur + filtre",
          quantity: 0.5,
        },
        { type: "PART", productId: huile.id, description: "Huile 5W30", quantity: 4 },
        { type: "PART", description: "Filtre à huile Toyota", quantity: 1, unitPrice: 5_500 },
      ],
      signature: { dataUrl: SIGNATURE, signerName: "Kouassi Jean-Marc" },
      clientRequestId,
      ...overrides,
    });
  }

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = "local";
    process.env.LOCAL_STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "atelieros-ro-"));
    setRepairOrdersClock(fixedClock(NOW));
    orgA = await adminDb.organization.create({
      data: { name: "Garage OR Test A", onboardingCompletedAt: NOW },
    });
    orgB = await adminDb.organization.create({
      data: { name: "Garage OR Test B", onboardingCompletedAt: NOW },
    });
    await adminDb.site.create({ data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" } });
    await adminDb.site.create({ data: { organizationId: orgB.id, name: "Cocody", code: "COC" } });
    const o = await member(orgA.id, "Owner OR A", "OWNER");
    const a = await member(orgA.id, "Bamba Aminata", "ADVISOR");
    const m = await member(orgA.id, "Coulibaly Drissa", "MECHANIC");
    const b = await member(orgB.id, "Owner OR B", "OWNER");
    users.push(o.userId, a.userId, m.userId, b.userId);
    owner = o.caller;
    advisor = a.caller;
    mechanic = m.caller;
    mechanicMembershipId = m.membershipId;
    callerB = b.caller;
    customer = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Kouassi Jean-Marc", phone: "+2250707070707" },
    });
    vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: customer.id,
        plate: "2547 GH 01",
        plateCompact: "2547GH01",
        make: "Toyota",
        model: "Corolla",
      },
    });
    vehicle2 = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: customer.id,
        plate: "1111 AB 01",
        plateCompact: "1111AB01",
        make: "Kia",
        model: "Picanto",
      },
    });
    vidange = await adminDb.laborOperation.create({
      data: {
        organizationId: orgA.id,
        code: "VID",
        name: "Vidange moteur + filtre",
        standardHours: 0.5,
      },
    });
    huile = await adminDb.product.create({
      data: { organizationId: orgA.id, sku: "HU-5W30", name: "Huile 5W30", salePrice: 4_500 },
    });
    await adminDb.inspectionTemplate.create({
      data: {
        organizationId: orgA.id,
        name: "Inspection 30 points",
        isDefault: true,
        items: [
          { category: "Freinage", label: "Plaquettes avant" },
          { category: "Freinage", label: "Disques avant" },
          { category: "Pneumatiques", label: "Pneu avant gauche" },
        ],
      },
    });
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    const where = { organizationId: { in: orgIds } };
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.message.deleteMany({ where });
    await adminDb.vehicleRecommendation.deleteMany({ where });
    await adminDb.creditOverride.deleteMany({ where });
    await adminDb.inspectionItem.deleteMany({ where });
    await adminDb.inspection.deleteMany({ where });
    await adminDb.inspectionTemplate.deleteMany({ where });
    await adminDb.repairOrderStatusHistory.deleteMany({ where });
    await adminDb.repairOrderLine.deleteMany({ where });
    await adminDb.mileageReading.deleteMany({ where });
    await adminDb.portalToken.deleteMany({ where });
    await adminDb.attachment.deleteMany({ where });
    await adminDb.repairOrder.deleteMany({ where });
    await adminDb.documentSequence.deleteMany({ where });
    await adminDb.laborOperation.deleteMany({ where });
    await adminDb.product.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  let orderId: string;

  it("US-M04-01 : réception complète → OR CHECKED_IN numéroté, relevé km, totaux, idempotence", async () => {
    const clientRequestId = `req-${randomBytes(6).toString("hex")}`;
    const created = await checkIn(advisor, { clientRequestId });
    orderId = created.id;
    expect(created).toMatchObject({
      number: "OR-YOP-2026-00001",
      status: "CHECKED_IN",
      replayed: false,
    });
    expect(created.trackingUrl).toMatch(/\/p\/.+\/suivi$/);

    const replay = await checkIn(advisor, { clientRequestId });
    expect(replay).toMatchObject({ id: orderId, replayed: true });
    expect(await adminDb.repairOrder.count({ where: { organizationId: orgA.id } })).toBe(1);

    const order = await advisor.repairOrder.get({ id: orderId });
    expect(order.lines.map((l) => [l.description, l.approval, l.approvalSource])).toEqual([
      ["Vidange moteur + filtre", "APPROVED", "CHECK_IN"],
      ["Huile 5W30", "APPROVED", "CHECK_IN"],
      ["Filtre à huile Toyota", "APPROVED", "CHECK_IN"],
    ]);
    // US-M04-09 : 31 000 HT, 5 580 TVA, 36 580 TTC.
    expect(order.totals).toMatchObject({ subtotal: 31_000, vatTotal: 5_580, total: 36_580 });
    expect(order.totalEstimate).toBe(36_580);
    expect(order.attachments.filter((a) => a.kind === "photo_checkin")).toHaveLength(4);
    expect(order.customerSignatureUrl).toMatch(/^\/api\/attachments\//);
    expect(order.history.map((h) => h.toStatus)).toEqual(["CHECKED_IN"]);

    const reading = await adminDb.mileageReading.findFirstOrThrow({
      where: { repairOrderId: orderId },
    });
    expect(reading).toMatchObject({ mileage: 48_200, source: "RECEPTION" });
    const v = await adminDb.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(v.currentMileage).toBe(48_200);
    expect(
      await adminDb.domainEvent.count({
        where: { organizationId: orgA.id, type: "repair_order.created" },
      }),
    ).toBe(1);
    expect(await adminDb.portalToken.count({ where: { targetId: orderId } })).toBe(1);
  });

  it("RG-M04-03 / RG-M04-02 : réception incomplète refusée, un seul OR actif par véhicule", async () => {
    await expect(
      advisor.repairOrder.checkIn({
        customerId: customer.id,
        vehicleId: vehicle2.id,
        fuelLevel: 3,
        complaint: "",
        checkIn: {},
        clientRequestId: `req-${randomBytes(6).toString("hex")}`,
      }),
    ).rejects.toThrow(/kilométrage[\s\S]*photos[\s\S]*Aucun dommage[\s\S]*doléances[\s\S]*signer/);

    await expect(checkIn(advisor)).rejects.toThrow(
      "Ce véhicule a déjà un OR ouvert (OR-YOP-2026-00001). Ajoutez-y les travaux.",
    );
  });

  it("US-M04-05 : plafond d'autorisation 50 000 → pré-autorisé puis en attente", async () => {
    const first = await advisor.repairOrderLine.add({
      repairOrderId: orderId,
      type: "PART",
      description: "Plaquettes AV",
      quantity: 1,
      unitPrice: 33_898, // 40 000 TTC
    });
    expect(first.line).toMatchObject({ approval: "APPROVED", approvalSource: "PRE_AUTHORIZED" });
    const second = await advisor.repairOrderLine.add({
      repairOrderId: orderId,
      type: "LABOR",
      description: "Remplacement plaquettes AV",
      quantity: 1,
      unitPrice: 15_000,
    });
    expect(second.line.approval).toBe("PENDING");
    expect(second.totals.pendingTotal).toBe(17_700);

    // Approbation directe refusée tant qu'une ligne attend l'accord du client.
    await expect(
      owner.repairOrder.transition({ id: orderId, transition: "approve" }),
    ).rejects.toThrow("1 ligne attend l'accord du client.");
    // Accord tracé par téléphone (RG-M04-08).
    await advisor.repairOrderLine.update({
      id: second.line.id,
      patch: { approval: "APPROVED", approvalSource: "PHONE" },
    });
    const approved = await advisor.repairOrder.transition({ id: orderId, transition: "approve" });
    expect(approved.status).toBe("APPROVED");
  });

  it("verrou optimiste : une ligne modifiée entre-temps est refusée", async () => {
    const order = await advisor.repairOrder.get({ id: orderId });
    const line = order.lines[0]!;
    await advisor.repairOrderLine.update({ id: line.id, patch: { discountRate: 0 } });
    await expect(
      advisor.repairOrderLine.update({
        id: line.id,
        expectedUpdatedAt: new Date(line.updatedAt.getTime() - 1000),
        patch: { discountRate: 5 },
      }),
    ).rejects.toThrow("Cette ligne a été modifiée par un autre utilisateur. Rechargez.");
  });

  it("travaux → contrôle qualité automatique → QC NOK refusé → QC OK → READY", async () => {
    const order = await owner.repairOrder.get({ id: orderId });
    for (const line of order.lines) {
      await owner.repairOrderLine.assign({ id: line.id, membershipId: mechanicMembershipId });
    }
    // Le mécanicien voit l'OR (ses lignes) et termine ses lignes ; il ne fait pas le QC.
    const list = await mechanic.repairOrder.list({});
    expect(list.items.map((i) => i.id)).toContain(orderId);
    for (const line of order.lines) {
      await mechanic.repairOrderLine.setStatus({ id: line.id, status: "DONE" });
    }
    const afterWork = await owner.repairOrder.get({ id: orderId });
    expect(afterWork.status).toBe("QUALITY_CHECK");
    expect(afterWork.history.map((h) => h.toStatus)).toEqual([
      "CHECKED_IN",
      "APPROVED",
      "IN_PROGRESS",
      "QUALITY_CHECK",
    ]);
    await expect(mechanic.repairOrder.qc({ id: orderId, checklist: [] })).rejects.toThrow(
      /Permission manquante/,
    );

    const keys = afterWork.settings.qcChecklist.map((i) => i.key);
    await expect(
      owner.repairOrder.qc({
        id: orderId,
        checklist: keys.map((key, i) => ({ key, result: i === 0 ? "NOK" : "OK" })),
      }),
    ).rejects.toThrow("Le contrôle qualité comporte un point non conforme ou non renseigné.");
    const ready = await owner.repairOrder.qc({
      id: orderId,
      checklist: keys.map((key) => ({ key, result: "OK" })),
    });
    expect(ready.status).toBe("READY");
    expect(ready.readyAt).toEqual(NOW);
    expect(ready.qcAt).toEqual(NOW);
  });

  it("RG-M04-14 : restitution bloquée sur solde (client comptant), forçage avec motif audité", async () => {
    const checkOut = {
      mileage: 48_210,
      fuelLevel: 3,
      itemsConfirmed: true,
      oldPartsReturned: false,
      collectedBy: { name: "Kouassi Jean-Marc" },
    };
    await expect(advisor.repairOrder.deliver({ id: orderId, checkOut })).rejects.toThrow(
      "Solde à régler : 94 280 FCFA. Encaissez ou demandez l'autorisation du gérant.",
    );
    // L'ADVISOR n'a pas `repair_order:deliver_unpaid` : son motif ne suffit pas.
    await expect(
      advisor.repairOrder.deliver({ id: orderId, checkOut, forceUnpaidReason: "Client connu" }),
    ).rejects.toThrow(/Solde à régler/);
    const delivered = await owner.repairOrder.deliver({
      id: orderId,
      checkOut,
      signature: { dataUrl: SIGNATURE, signerName: "Kouassi Jean-Marc" },
      forceUnpaidReason: "Client fidèle, paiement Wave demain",
    });
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.deliveredAt).toEqual(NOW);
    const audit = await adminDb.auditLog.findFirstOrThrow({
      where: { organizationId: orgA.id, action: "repair_order.deliver_unpaid" },
    });
    expect(audit.reason).toBe("Client fidèle, paiement Wave demain");
    const lines = await adminDb.repairOrderLine.findMany({ where: { repairOrderId: orderId } });
    const labor = lines.find((l) => l.description === "Vidange moteur + filtre")!;
    expect(labor.warrantyUntilDate).toEqual(new Date("2027-01-19T00:00:00.000Z"));
    expect(labor.warrantyUntilMileage).toBe(53_200);
    // Lignes verrouillées après livraison.
    await expect(
      owner.repairOrderLine.update({ id: labor.id, patch: { quantity: 1 } }),
    ).rejects.toThrow(/LINE_LOCKED/);
    // Réouverture tracée (aucune facture émise).
    const reopened = await owner.repairOrder.transition({
      id: orderId,
      transition: "reopen",
      reason: "Client revenu pour un oubli",
    });
    expect(reopened.status).toBe("READY");
  });

  it("US-M04-06 : inspection → AWAITING_APPROVAL, recommandations ajoutées en attente d'accord", async () => {
    const order = await checkIn(advisor, {
      vehicleId: vehicle2.id,
      mileageIn: 12_000,
      initialLines: [],
    });
    const { id: inspectionId } = await mechanic.inspection.start({ repairOrderId: order.id });
    expect((await owner.repairOrder.get({ id: order.id })).status).toBe("DIAGNOSING");
    const inspection = await mechanic.inspection.get({ inspectionId });
    const [pads, discs] = inspection.items;
    await mechanic.inspection.saveItem({
      itemId: pads!.id,
      result: "URGENT",
      measurement: "2 mm",
      recommendedLaborIds: [vidange.id],
      recommendedProductIds: [huile.id],
    });
    await mechanic.inspection.saveItem({ itemId: discs!.id, result: "WATCH" });
    await mechanic.inspection.bulkOk({ inspectionId, category: "Pneumatiques" });
    const done = await mechanic.inspection.complete({ inspectionId });
    expect(done.summary).toMatchObject({ urgent: 1, watch: 1, ok: 1, withoutRecommendation: 1 });
    expect(done.orStatus).toBe("AWAITING_APPROVAL");

    const added = await advisor.inspection.addRecommendationsToOrder({ inspectionId });
    expect(added.created).toBe(2);
    const detail = await advisor.repairOrder.get({ id: order.id });
    // Plafond 50 000 : 8 850 + 5 310 TTC restent sous le plafond → pré-autorisées.
    expect(detail.lines.map((l) => l.approval)).toEqual(["APPROVED", "APPROVED"]);
    expect(detail.lines.every((l) => l.inspectionItemId === pads!.id)).toBe(true);

    // Annulation : motif obligatoire, puis OR annulé (aucune pièce sortie, aucun pointage).
    await expect(
      owner.repairOrder.transition({ id: order.id, transition: "cancel" }),
    ).rejects.toThrow("Indiquez le motif de l'annulation.");
    const cancelled = await owner.repairOrder.transition({
      id: order.id,
      transition: "cancel",
      reason: "Client a repris son véhicule sans travaux",
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(
      await adminDb.auditLog.count({
        where: { organizationId: orgA.id, action: "repair_order.cancel" },
      }),
    ).toBe(1);
  });

  it("US-M04-04 / US-M04-16 : signature à distance et suivi public sans données internes", async () => {
    const created = await checkIn(advisor, {
      vehicleId: vehicle2.id,
      mileageIn: 12_100,
      signature: { remote: true },
      initialLines: [{ type: "LABOR", description: "Diagnostic", quantity: 1, unitPrice: 20_000 }],
    });
    await owner.repairOrder.update({
      id: created.id,
      internalNotes: "Client difficile — ne pas montrer",
    });
    const token = created.trackingUrl!.split("/p/")[1]!.split("/")[0]!;
    const anonymous = callerFactory(await contextFor(null));
    const before = await anonymous.portal.repairOrder.tracking({ token });
    expect(before).toMatchObject({
      number: created.number,
      status: "RECEIVED",
      signaturePending: true,
    });
    expect(before.pendingLines).toHaveLength(1);
    expect(JSON.stringify(before)).not.toMatch(
      /Client difficile|Coulibaly|costPrice|internalNotes/,
    );

    await anonymous.portal.repairOrder.signReception({
      token,
      signatureDataUrl: SIGNATURE,
      signerName: "Chauffeur SOTRA",
    });
    const after = await anonymous.portal.repairOrder.tracking({ token });
    expect(after.signaturePending).toBe(false);
    expect(after.lines.map((l) => l.description)).toEqual(["Diagnostic"]);
    expect(after.total).toBe(23_600);
    await expect(anonymous.portal.repairOrder.tracking({ token: "x".repeat(32) })).rejects.toThrow(
      "Lien expiré ou invalide.",
    );
  });

  it("isolation multi-locataire : l'organisation B ne voit ni ne modifie les OR de A", async () => {
    await expect(callerB.repairOrder.get({ id: orderId })).rejects.toThrow(
      "Ordre de réparation introuvable.",
    );
    expect((await callerB.repairOrder.list({})).items).toHaveLength(0);
    const line = await adminDb.repairOrderLine.findFirstOrThrow({
      where: { repairOrderId: orderId },
    });
    await expect(
      callerB.repairOrderLine.update({ id: line.id, patch: { quantity: 9 } }),
    ).rejects.toThrow("Ligne introuvable.");
    await expect(
      callerB.repairOrder.transition({ id: orderId, transition: "cancel", reason: "piratage" }),
    ).rejects.toThrow("Ordre de réparation introuvable.");
  });

  it("mode REMINDERS_ONLY : MODULE_DISABLED", async () => {
    await adminDb.organization.update({
      where: { id: orgA.id },
      data: { operatingMode: "REMINDERS_ONLY" },
    });
    try {
      await expect(owner.repairOrder.list({})).rejects.toThrow(/MODULE_DISABLED/);
    } finally {
      await adminDb.organization.update({
        where: { id: orgA.id },
        data: { operatingMode: "FULL" },
      });
    }
  });
});
