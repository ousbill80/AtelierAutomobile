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
type Role = "OWNER" | "MANAGER" | "ADVISOR";

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/118 Mobile";

async function contextFor(token: string | null, userAgent = MOBILE_UA) {
  const req = new Request("http://localhost/api/trpc", {
    headers: {
      ...(token ? { cookie: `atelieros_session=${token}` } : {}),
      "user-agent": userAgent,
      "x-forwarded-for": "41.202.10.77",
    },
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
const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tokenOf(url: string): string {
  return url.split("/p/")[1]!.split("/")[0]!;
}

describe("quote routers (M05)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  const users: string[] = [];
  let owner: Caller;
  let manager: Caller;
  let advisor: Caller;
  let callerB: Caller;
  let anonymous: Caller;
  let previewBot: Caller;
  let customer: { id: string };
  let vehicle: { id: string };
  let order: { id: string };
  let inspection: { id: string };

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = "local";
    process.env.LOCAL_STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "atelieros-quote-"));
    setRepairOrdersClock(fixedClock(NOW));
    orgA = await adminDb.organization.create({
      data: { name: "Garage Devis A", onboardingCompletedAt: NOW },
    });
    orgB = await adminDb.organization.create({
      data: { name: "Garage Devis B", onboardingCompletedAt: NOW },
    });
    const siteA = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" },
    });
    await adminDb.site.create({ data: { organizationId: orgB.id, name: "Cocody", code: "COC" } });
    const o = await member(orgA.id, "Owner Devis", "OWNER");
    const m = await member(orgA.id, "Chef d'atelier", "MANAGER");
    const a = await member(orgA.id, "Bamba Aminata", "ADVISOR");
    const b = await member(orgB.id, "Owner B", "OWNER");
    users.push(o.userId, m.userId, a.userId, b.userId);
    owner = o.caller;
    manager = m.caller;
    advisor = a.caller;
    callerB = b.caller;
    anonymous = callerFactory(await contextFor(null));
    previewBot = callerFactory(await contextFor(null, "WhatsApp/2.23.20.0 A"));
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgA.id,
        channel: "SMS",
        provider: "console",
        isActive: true,
        credentials: "{}",
      },
    });
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
    const [padsLabor, shocksLabor] = await Promise.all([
      adminDb.laborOperation.create({
        data: {
          organizationId: orgA.id,
          code: "PLQ-AV",
          name: "Remplacement plaquettes AV",
          standardHours: 1,
        },
      }),
      adminDb.laborOperation.create({
        data: {
          organizationId: orgA.id,
          code: "AMO-AR",
          name: "Remplacement amortisseurs AR",
          standardHours: 2,
        },
      }),
    ]);
    const [pads, shocks, wipers] = await Promise.all([
      adminDb.product.create({
        data: {
          organizationId: orgA.id,
          sku: "PLQ-COR",
          name: "Jeu de plaquettes AV Toyota Corolla",
          salePrice: 28_000,
          minSalePrice: 25_000,
        },
      }),
      adminDb.product.create({
        data: {
          organizationId: orgA.id,
          sku: "AMO-COR",
          name: "Amortisseur AR",
          salePrice: 45_000,
        },
      }),
      adminDb.product.create({
        data: {
          organizationId: orgA.id,
          sku: "BAL",
          name: "Jeu de balais d'essuie-glace",
          salePrice: 8_000,
        },
      }),
    ]);
    await adminDb.stockLevel.create({
      data: {
        organizationId: orgA.id,
        siteId: siteA.id,
        productId: pads.id,
        onHand: 3,
        reserved: 1,
      },
    });
    order = await adminDb.repairOrder.create({
      data: {
        organizationId: orgA.id,
        siteId: siteA.id,
        number: "OR-YOP-2026-00042",
        customerId: customer.id,
        vehicleId: vehicle.id,
        status: "DIAGNOSING",
        advisorId: a.membershipId,
      },
    });
    // Vidange déjà approuvée à la réception (US-M05-01 : non reprise dans le devis).
    await adminDb.repairOrderLine.create({
      data: {
        organizationId: orgA.id,
        repairOrderId: order.id,
        type: "LABOR",
        description: "Vidange",
        quantity: 1,
        unitPrice: 26_271,
        vatRate: 18,
        approval: "APPROVED",
        approvalSource: "CHECK_IN",
      },
    });
    inspection = await adminDb.inspection.create({
      data: { organizationId: orgA.id, repairOrderId: order.id, completedAt: NOW },
    });
    await adminDb.inspectionItem.createMany({
      data: [
        {
          organizationId: orgA.id,
          inspectionId: inspection.id,
          category: "Freinage",
          label: "Plaquettes avant",
          result: "URGENT",
          recommendedLaborIds: [padsLabor.id],
          recommendedProductIds: [pads.id],
          sortOrder: 0,
        },
        {
          organizationId: orgA.id,
          inspectionId: inspection.id,
          category: "Suspension",
          label: "Amortisseurs arrière",
          result: "WATCH",
          recommendedLaborIds: [shocksLabor.id],
          recommendedProductIds: [shocks.id],
          sortOrder: 1,
        },
        {
          organizationId: orgA.id,
          inspectionId: inspection.id,
          category: "Visibilité",
          label: "Balais d'essuie-glace",
          result: "WATCH",
          recommendedProductIds: [wipers.id],
          sortOrder: 2,
        },
        {
          organizationId: orgA.id,
          inspectionId: inspection.id,
          category: "Pneus",
          label: "Pneu AVG",
          result: "WATCH",
          sortOrder: 3,
        },
        {
          organizationId: orgA.id,
          inspectionId: inspection.id,
          category: "Niveaux",
          label: "Huile",
          result: "OK",
          sortOrder: 4,
        },
      ],
    });
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    const where = { organizationId: { in: orgIds } };
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.message.deleteMany({ where });
    await adminDb.conversation.deleteMany({ where });
    await adminDb.vehicleRecommendation.deleteMany({ where });
    await adminDb.invoiceLine.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.repairOrderStatusHistory.deleteMany({ where });
    // M07 (PR #10) : l'accord sur les lignes d'OR réserve le stock.
    await adminDb.stockMovement.deleteMany({ where });
    await adminDb.stockReservation.deleteMany({ where });
    await adminDb.repairOrderLine.deleteMany({ where });
    await adminDb.quoteLine.deleteMany({ where });
    await adminDb.quote.deleteMany({ where });
    await adminDb.inspectionItem.deleteMany({ where });
    await adminDb.inspection.deleteMany({ where });
    await adminDb.portalToken.deleteMany({ where });
    await adminDb.attachment.deleteMany({ where });
    await adminDb.repairOrder.deleteMany({ where });
    await adminDb.documentSequence.deleteMany({ where });
    await adminDb.stockLevel.deleteMany({ where });
    await adminDb.laborOperation.deleteMany({ where });
    await adminDb.product.deleteMany({ where });
    await adminDb.channelConfig.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  let quoteId: string;
  let publicToken: string;

  it("US-M05-01 : création depuis l'inspection — groupes, priorités, optionnels, totaux", async () => {
    const res = await advisor.quote.createFromInspection({ inspectionId: inspection.id });
    quoteId = res.id;
    expect(res.number).toBe("DEV-YOP-2026-00001");
    expect(res.skipped).toEqual(["Pneu AVG"]);
    const q = await advisor.quote.get({ id: quoteId });
    expect(q).toMatchObject({
      status: "DRAFT",
      version: 1,
      origin: "INSPECTION",
      repairOrderId: order.id,
    });
    expect(q.groups.map((g) => [g.label, g.priority, g.isOptional, g.total])).toEqual([
      ["Plaquettes avant", "URGENT", false, 50_740],
      ["Amortisseurs arrière", "WATCH", true, 88_500],
      ["Balais d'essuie-glace", "WATCH", true, 9_440],
    ]);
    expect(q.alreadyApproved.map((l) => l.description)).toEqual(["Vidange"]);
    expect(
      q.lines.find((l) => l.productId && l.description.startsWith("Jeu de plaquettes"))?.available,
    ).toBe(2);
    const items = await adminDb.inspectionItem.findMany({
      where: { inspectionId: inspection.id, addedToQuote: true },
    });
    expect(items).toHaveLength(3);
  });

  it("le catalogue MO s'applique et les quantités se modifient (2 amortisseurs)", async () => {
    const q = await advisor.quote.get({ id: quoteId });
    const shock = q.lines.find((l) => l.description === "Amortisseur AR")!;
    await advisor.quoteLine.update({ id: shock.id, patch: { quantity: 2 } });
    const after = await advisor.quote.get({ id: quoteId });
    expect(after.total).toBe(201_780);
    expect(after.groups[1]!.total).toBe(141_600);
  });

  it("US-M05-03 : remise de 15 % par l'advisor → validation requise, envoi bloqué", async () => {
    const q = await advisor.quote.get({ id: quoteId });
    const mo = q.lines.find((l) => l.description === "Remplacement amortisseurs AR")!;
    const res = await advisor.quoteLine.update({ id: mo.id, patch: { discountRate: 15 } });
    expect(res.discount.status).toBe("PENDING");
    await advisor.quote.update({ id: quoteId, patch: { discountReason: "Client fidèle" } });
    await expect(
      advisor.quote.send({ id: quoteId, channel: "SMS", recipient: { type: "CUSTOMER" } }),
    ).rejects.toThrow(/validation/);
    const notif = await adminDb.notification.findMany({
      where: { organizationId: orgA.id, type: "quote.discount_approval_requested" },
    });
    expect(notif.length).toBeGreaterThanOrEqual(2);
    await expect(
      advisor.quote.decideDiscount({ id: quoteId, decision: "APPROVE" }),
    ).rejects.toThrow(/Permission/);
  });

  it("prix sous le minimum : bloquant sans invoice:price_below_min", async () => {
    const q = await advisor.quote.get({ id: quoteId });
    const pads = q.lines.find((l) => l.description.startsWith("Jeu de plaquettes"))!;
    await expect(
      advisor.quoteLine.update({ id: pads.id, patch: { discountRate: 20 } }),
    ).rejects.toThrow(/minimum/);
  });

  it("le chef d'atelier valide la remise (« Approuver à 10 % »), l'envoi devient possible", async () => {
    const updated = await manager.quote.decideDiscount({
      id: quoteId,
      decision: "APPROVE_PARTIAL",
      maxRate: 10,
    });
    expect(updated.discountApprovalStatus).toBe("APPROVED");
    const q = await advisor.quote.get({ id: quoteId });
    expect(
      q.lines.find((l) => l.description === "Remplacement amortisseurs AR")!.discountRate,
    ).toBe(10);
    expect(q.sendBlockers).toEqual([]);
    const audit = await adminDb.auditLog.findFirst({
      where: { entityId: quoteId, action: "quote.discount_approved" },
    });
    expect(audit).not.toBeNull();
    // Remise ramenée à 0 pour retomber sur l'exemple du PRD.
    await manager.quoteLine.update({
      id: q.lines.find((l) => l.description === "Remplacement amortisseurs AR")!.id,
      patch: { discountRate: 0 },
    });
  });

  it("US-M05-04 : envoi SMS → SENT, lien public, OR en attente d'accord avec lignes miroirs", async () => {
    const res = await advisor.quote.send({
      id: quoteId,
      channel: "SMS",
      recipient: { type: "CUSTOMER" },
    });
    expect(res.quote.status).toBe("SENT");
    expect(res.messageId).toBeTruthy();
    expect(res.body).toContain("201 780 FCFA TTC (dont 50 740 FCFA urgents)");
    publicToken = tokenOf(res.publicUrl);
    const message = await adminDb.message.findUniqueOrThrow({ where: { id: res.messageId! } });
    expect(message).toMatchObject({ channel: "SMS", to: "+2250707070707" });
    const ro = await adminDb.repairOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { lines: true },
    });
    expect(ro.status).toBe("AWAITING_APPROVAL");
    expect(ro.lines.filter((l) => l.approval === "PENDING" && l.quoteLineId)).toHaveLength(5);
    const token = await adminDb.portalToken.findFirstOrThrow({ where: { targetId: quoteId } });
    expect(token.scope).toBe("QUOTE");
    expect(token.tokenHash).not.toBe(publicToken);
    await expect(
      advisor.quoteLine.add({ quoteId, type: "FEE", description: "x", quantity: 1, unitPrice: 1 }),
    ).rejects.toThrow(/nouvelle version/);
  });

  it("aperçu de lien WhatsApp (robot) : pas de VIEWED ; ouverture client : VIEWED", async () => {
    await previewBot.portal.quote.get({ token: publicToken });
    expect((await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("SENT");
    const view = await anonymous.portal.quote.get({ token: publicToken });
    expect(view.status).toBe("VIEWED");
    expect(view.groups.map((g) => g.priority)).toEqual(["URGENT", "WATCH", "WATCH"]);
    expect(view.decidable).toBe(true);
    expect(JSON.stringify(view)).not.toContain("costPrice");
  });

  it("QUOTE_CHANGED si l'empreinte ne correspond plus", async () => {
    const view = await anonymous.portal.quote.get({ token: publicToken });
    await expect(
      anonymous.portal.quote.decide({
        token: publicToken,
        quoteId: view.quoteId,
        decisions: view.groups.map((g) => ({ groupKey: g.key, accepted: true })),
        signerName: "Kouassi Jean-Marc",
        signatureDataUrl: SIGNATURE,
        contentHash: "0".repeat(64),
      }),
    ).rejects.toThrow(/QUOTE_CHANGED/);
  });

  it("US-M05-05 : décision portail partielle signée → PARTIALLY_ACCEPTED, OR approuvé, recommandation", async () => {
    const view = await anonymous.portal.quote.get({ token: publicToken });
    const [padsGroup, shocksGroup, wipersGroup] = view.groups;
    const res = await anonymous.portal.quote.decide({
      token: publicToken,
      quoteId: view.quoteId,
      decisions: [
        { groupKey: padsGroup!.key, accepted: true },
        { groupKey: shocksGroup!.key, accepted: false },
        { groupKey: wipersGroup!.key, accepted: true },
      ],
      signerName: "Kouassi Jean-Marc",
      signatureDataUrl: SIGNATURE,
      declineReason: "later",
      contentHash: view.contentHash,
    });
    expect(res).toMatchObject({
      status: "PARTIALLY_ACCEPTED",
      acceptedTotal: 60_180,
      alreadyDecided: false,
    });
    const q = await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(q).toMatchObject({
      decisionChannel: "portal",
      signerName: "Kouassi Jean-Marc",
      decisionIp: "41.202.10.0",
      acceptedTotal: 60_180,
    });
    expect(q.decisionHash).toHaveLength(64);
    expect(q.signatureUrl).toMatch(/^\/api\/attachments\//);
    const ro = await adminDb.repairOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { lines: true },
    });
    expect(ro.status).toBe("APPROVED");
    expect(
      ro.lines.filter((l) => l.approvalSource === "QUOTE" && l.approval === "APPROVED"),
    ).toHaveLength(3);
    expect(ro.lines.filter((l) => l.approval === "DECLINED")).toHaveLength(2);
    const recs = await adminDb.vehicleRecommendation.findMany({
      where: { repairOrderId: order.id },
    });
    expect(recs.map((r) => r.label)).toEqual(["Amortisseurs arrière"]);
    const events = await adminDb.domainEvent.findMany({
      where: {
        organizationId: orgA.id,
        type: { in: ["quote.sent", "quote.viewed", "quote.accepted"] },
      },
    });
    expect(events.map((e) => e.type).sort()).toEqual([
      "quote.accepted",
      "quote.sent",
      "quote.viewed",
    ]);
  });

  it("double soumission : renvoie la décision existante", async () => {
    const view = await anonymous.portal.quote.get({ token: publicToken });
    expect(view.decidable).toBe(false);
    const res = await anonymous.portal.quote.decide({
      token: publicToken,
      quoteId: view.quoteId,
      decisions: [{ groupKey: view.groups[0]!.key, accepted: true }],
      signerName: "Xavier",
      signatureDataUrl: SIGNATURE,
      contentHash: view.contentHash,
    });
    expect(res.alreadyDecided).toBe(true);
  });

  it("US-M05-07 : décision complémentaire (amendement) refusé → accepté", async () => {
    const q = await advisor.quote.get({ id: quoteId });
    const shocks = q.groups.find((g) => g.label === "Amortisseurs arrière")!;
    const res = await advisor.quote.recordDecision({
      id: quoteId,
      channel: "phone",
      amendment: true,
      decisions: [{ groupKey: shocks.key, accepted: true }],
      sendWrittenConfirmation: false,
    });
    expect(res.quote.status).toBe("ACCEPTED");
    expect(res.quote.acceptedTotal).toBe(201_780);
  });

  it("PDF signé", async () => {
    const quote = await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } });
    const { renderQuotePdfFor } = await import("../quotes/pdf");
    const { loadOrgQuoteContext } = await import("../quotes/service");
    const { db } = await import("@atelieros/db");
    const org = await loadOrgQuoteContext(orgA.id);
    const pdf = await db
      .forTenant({ organizationId: orgA.id })
      .transaction((tx) => renderQuotePdfFor(tx, org, quote, "signed"));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  let freeQuoteId: string;

  it("US-M05-02 : devis libre avec prospect (nom + téléphone), source = devis", async () => {
    const res = await advisor.quote.create({
      newCustomer: { name: "Bamba Mariam", phone: "07 47 21 88 90" },
      origin: "STANDALONE",
      lines: [{ type: "PART", description: "Kit distribution", quantity: 1, unitPrice: 120_000 }],
    });
    freeQuoteId = res.id;
    const quote = await adminDb.quote.findUniqueOrThrow({
      where: { id: res.id },
      include: { customer: true },
    });
    expect(quote.customer).toMatchObject({ source: "devis", phone: "+2250747218890" });
    expect(quote.total).toBe(141_600);
    expect(quote.validUntil.toISOString().slice(0, 10)).toBe("2026-11-03");
  });

  it("US-M05-08 : nouvelle version pendant la consultation → QUOTE_CHANGED sur la v1, redirection v2", async () => {
    const sent = await advisor.quote.send({
      id: freeQuoteId,
      channel: "LINK_ONLY",
      recipient: { type: "CUSTOMER" },
    });
    const token = tokenOf(sent.publicUrl);
    const v1View = await anonymous.portal.quote.get({ token });
    const v2 = await advisor.quote.createVersion({ id: freeQuoteId });
    expect(v2.version).toBe(2);
    const v1 = await adminDb.quote.findUniqueOrThrow({ where: { id: freeQuoteId } });
    expect(v1.supersededAt).not.toBeNull();
    await expect(
      anonymous.portal.quote.decide({
        token,
        quoteId: v1View.quoteId,
        decisions: v1View.groups.map((g) => ({ groupKey: g.key, accepted: true })),
        signerName: "Bamba Mariam",
        signatureDataUrl: SIGNATURE,
        contentHash: v1View.contentHash,
      }),
    ).rejects.toThrow(/QUOTE_CHANGED/);
    const redirected = await anonymous.portal.quote.get({ token });
    expect(redirected).toMatchObject({
      quoteId: v2.id,
      version: 2,
      updated: true,
      pendingUpdate: true,
      decidable: false,
    });
    // la v1 est en lecture seule
    await expect(advisor.quote.update({ id: freeQuoteId, patch: { notes: "x" } })).rejects.toThrow(
      /remplacée/,
    );
    const v2Lines = await adminDb.quoteLine.findMany({ where: { quoteId: v2.id } });
    await advisor.quoteLine.update({ id: v2Lines[0]!.id, patch: { unitPrice: 110_000 } });
    const detail = await advisor.quote.get({ id: v2.id });
    expect(detail.diff?.changed[0]?.fields).toEqual(["unitPrice"]);
    expect(detail.versions.map((v) => v.version)).toEqual([1, 2]);
    freeQuoteId = v2.id;
  });

  it("US-M05-07 : décision par téléphone avec confirmation écrite automatique", async () => {
    await advisor.quote.send({
      id: freeQuoteId,
      channel: "LINK_ONLY",
      recipient: { type: "CUSTOMER" },
    });
    const q = await advisor.quote.get({ id: freeQuoteId });
    const res = await advisor.quote.recordDecision({
      id: freeQuoteId,
      channel: "phone",
      counterpartName: "Mme Bamba elle-même",
      decidedAtTime: "10:15",
      decisions: [{ lineId: q.lines[0]!.id, accepted: true }],
    });
    expect(res.quote).toMatchObject({
      status: "ACCEPTED",
      decisionChannel: "phone",
      decisionCounterpart: "Mme Bamba elle-même",
    });
    const message = await adminDb.message.findUniqueOrThrow({ where: { id: res.confirmationId! } });
    expect(message.body).toContain(
      "Suite à notre appel de 10:15, vous avez accepté : Kit distribution (129 800 FCFA TTC).",
    );
  });

  it("US-M05-11 : conversion du devis libre accepté → facture brouillon ; OR impossible sans véhicule", async () => {
    await expect(advisor.quote.convertToRepairOrder({ id: freeQuoteId })).rejects.toThrow(
      /véhicule/,
    );
    const res = await advisor.quote.convertToInvoice({ id: freeQuoteId });
    const invoice = await adminDb.invoice.findUniqueOrThrow({
      where: { id: res.invoiceId },
      include: { lines: true },
    });
    expect(invoice).toMatchObject({ status: "DRAFT", total: 129_800, quoteId: freeQuoteId });
    expect(invoice.lines).toHaveLength(1);
    expect((await adminDb.quote.findUniqueOrThrow({ where: { id: freeQuoteId } })).status).toBe(
      "CONVERTED",
    );
  });

  it("US-M05-11 : devis libre accepté avec véhicule → OR DRAFT avec lignes approuvées (QUOTE)", async () => {
    const vehicle2 = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: customer.id,
        plate: "9999 AA 01",
        plateCompact: "9999AA01",
        make: "Hyundai",
        model: "Tucson",
      },
    });
    const created = await advisor.quote.create({
      customerId: customer.id,
      vehicleId: vehicle2.id,
      origin: "STANDALONE",
      lines: [{ type: "LABOR", description: "Kit distribution", quantity: 3, unitPrice: 15_000 }],
    });
    await advisor.quote.recordDecision({
      id: created.id,
      channel: "in_person",
      signature: { dataUrl: SIGNATURE, signerName: "Kouassi Jean-Marc" },
      decisions: (await advisor.quote.get({ id: created.id })).groups.map((g) => ({
        groupKey: g.key,
        accepted: true,
      })),
    });
    const res = await advisor.quote.convertToRepairOrder({ id: created.id });
    expect(res.suggestedHours).toBe(3);
    const ro = await adminDb.repairOrder.findUniqueOrThrow({
      where: { id: res.repairOrderId },
      include: { lines: true },
    });
    expect(ro.status).toBe("DRAFT");
    expect(ro.lines[0]).toMatchObject({ approval: "APPROVED", approvalSource: "QUOTE" });
  });

  it("US-M05-10 : expiration par le job puis réactivation (nouvelle version)", async () => {
    const created = await advisor.quote.create({
      customerId: customer.id,
      origin: "STANDALONE",
      validUntil: new Date("2026-10-20T00:00:00Z"),
      lines: [{ type: "PART", description: "Batterie", quantity: 1, unitPrice: 60_000 }],
    });
    await advisor.quote.send({
      id: created.id,
      channel: "LINK_ONLY",
      recipient: { type: "CUSTOMER" },
    });
    const { expireQuotesForOrganization } = await import("../../../../worker/src/jobs/quotes");
    expect(await expireQuotesForOrganization(orgA.id, new Date("2026-10-21T00:30:00Z"))).toBe(1);
    const expired = await adminDb.quote.findUniqueOrThrow({ where: { id: created.id } });
    expect(expired.status).toBe("EXPIRED");
    expect(
      await adminDb.domainEvent.count({
        where: { organizationId: orgA.id, type: "quote.expired" },
      }),
    ).toBe(1);
    const reactivated = await advisor.quote.createVersion({ id: created.id });
    const v2 = await adminDb.quote.findUniqueOrThrow({ where: { id: reactivated.id } });
    expect(v2).toMatchObject({ status: "DRAFT", version: 2 });
    expect(v2.validUntil.toISOString().slice(0, 10)).toBe("2026-11-03");
  });

  it("suppression : brouillon jamais envoyé seulement (quote:delete)", async () => {
    const created = await advisor.quote.create({ customerId: customer.id, origin: "STANDALONE" });
    await expect(advisor.quote.delete({ id: created.id, reason: "Doublon" })).rejects.toThrow(
      /Permission/,
    );
    await manager.quote.delete({ id: created.id, reason: "Doublon" });
    await expect(advisor.quote.get({ id: created.id })).rejects.toThrow(/introuvable/);
    await expect(manager.quote.delete({ id: quoteId, reason: "Essai" })).rejects.toThrow();
  });

  it("statistiques d'acceptation (RG-M05-16)", async () => {
    const stats = await owner.quote.stats({
      from: new Date("2026-10-01"),
      to: new Date("2026-10-31"),
    });
    expect(stats.sent).toBeGreaterThanOrEqual(2);
    expect(stats.closed).toBeGreaterThanOrEqual(2);
    expect(stats.rateCount).not.toBeNull();
    await expect(
      advisor.quote.stats({ from: new Date("2026-10-01"), to: new Date("2026-10-31") }),
    ).rejects.toThrow(/Permission/);
  });

  it("question et rappel depuis le portail (US-M05-06)", async () => {
    await anonymous.portal.quote.ask({
      token: publicToken,
      message: "Les plaquettes sont d'origine ?",
    });
    await anonymous.portal.quote.ask({ token: publicToken, callback: true });
    const inbound = await adminDb.message.findFirst({
      where: { organizationId: orgA.id, direction: "INBOUND" },
    });
    expect(inbound?.body).toContain("[Devis DEV-YOP-2026-00001]");
    const callback = await adminDb.notification.findFirst({
      where: { organizationId: orgA.id, type: "quote.callback_requested" },
    });
    expect(callback?.title).toContain("Rappeler Kouassi Jean-Marc");
  });

  it("isolation multi-locataire et portée du jeton", async () => {
    await expect(callerB.quote.get({ id: quoteId })).rejects.toThrow(/introuvable/);
    const listB = await callerB.quote.list({ tab: "all" });
    expect(listB.items).toHaveLength(0);
    await expect(
      callerB.quote.send({ id: quoteId, channel: "LINK_ONLY", recipient: { type: "CUSTOMER" } }),
    ).rejects.toThrow();
    // un jeton REPAIR_ORDER ne lit pas un devis, un jeton QUOTE ne lit pas un OR
    const { createTrackingToken } = await import("../repairOrders/helpers");
    const { db } = await import("@atelieros/db");
    const tracking = await db.forTenant({ organizationId: orgA.id }).transaction((tx) =>
      createTrackingToken(tx, {
        organizationId: orgA.id,
        repairOrderId: order.id,
        customerId: customer.id,
        createdById: null,
        now: NOW,
      }),
    );
    await expect(anonymous.portal.quote.get({ token: tracking.token })).rejects.toThrow(/Lien/);
    await expect(anonymous.portal.repairOrder.tracking({ token: publicToken })).rejects.toThrow(
      /Lien/,
    );
    await expect(anonymous.portal.quote.get({ token: "x".repeat(43) })).rejects.toThrow(/Lien/);
  });

  it("liste par onglets et paramètres", async () => {
    const list = await advisor.quote.list({ tab: "decided" });
    expect(
      list.items.every((i) =>
        ["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED", "CONVERTED"].includes(i.status),
      ),
    ).toBe(true);
    await expect(advisor.quote.updateSettings({ validityDays: 20 })).rejects.toThrow(/Permission/);
    const s = await owner.quote.updateSettings({
      validityDays: 20,
      discountCaps: { ADVISOR: { line: 12, global: 5 } },
    });
    expect(s.validityDays).toBe(20);
    expect(s.discountCaps.ADVISOR.line).toBe(12);
    expect(s.discountCaps.MANAGER.line).toBe(20);
  });

  it("catalogue MO : création, kit, import CSV", async () => {
    const op = await manager.laborOperation.create({
      code: "DIST",
      name: "Kit distribution + pompe à eau",
      standardHours: 3,
      rateType: "STANDARD",
      vehicleOverrides: [{ make: "Toyota", model: "Hilux", standardHours: 4.5 }],
      defaultParts: [{ category: "Distribution", quantity: 1 }],
    });
    await adminDb.product.create({
      data: {
        organizationId: orgA.id,
        sku: "KIT-DIST",
        name: "Kit distribution",
        category: "Distribution",
        salePrice: 85_000,
      },
    });
    const draft = await advisor.quote.create({
      customerId: customer.id,
      vehicleId: vehicle.id,
      origin: "STANDALONE",
    });
    const kit = await advisor.quote.addKit({ quoteId: draft.id, laborOperationId: op.id });
    expect(kit.added).toBe(2);
    const detail = await advisor.quote.get({ id: draft.id });
    expect(detail.groups).toHaveLength(1);
    expect(detail.total).toBe(Math.round(45_000 * 1.18) + Math.round(85_000 * 1.18));
    const imported = await manager.laborOperation.import({
      csv: "code;nom;catégorie;heures;type;forfait\nGEO;Géométrie;Trains;0;STANDARD;15000\nBAD;;;;;",
    });
    expect(imported).toMatchObject({ created: 1, updated: 0 });
    expect(imported.errors).toHaveLength(1);
    await expect(
      advisor.laborOperation.create({
        code: "X",
        name: "Xx",
        standardHours: 1,
        rateType: "STANDARD",
      }),
    ).rejects.toThrow(/Permission/);
  });
});
