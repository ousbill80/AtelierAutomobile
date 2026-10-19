import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeSessionAbsoluteExpiry, fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createContext } from "../context";
import { setQuotesClock } from "../quotes/helpers";
import { setRepairOrdersClock } from "../repairOrders/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// Pas de Redis dans les tests : le job d'envoi (après commit) est simulé.
vi.mock("../messaging/queue", () => ({ enqueueMessageSendJob: vi.fn(async () => undefined) }));

const callerFactory = createCallerFactory(appRouter);
type Caller = ReturnType<typeof callerFactory>;
type Role = "OWNER" | "MANAGER" | "ADVISOR" | "CASHIER";

async function contextFor(token: string | null, userAgent = "Mozilla/5.0 (Android 10) Mobile") {
  const req = new Request("http://localhost/api/trpc", {
    headers: {
      ...(token ? { cookie: `atelieros_session=${token}` } : {}),
      "user-agent": userAgent,
      "x-real-ip": "41.207.1.2",
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
  return { userId: user.id, membershipId: membership.id, caller: callerFactory(await contextFor(token)) };
}

const NOW = new Date("2026-10-19T09:00:00.000Z");
const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tokenFromUrl(url: string): string {
  return url.split("/p/")[1]!.split("/")[0]!;
}

describe("quote routers (M05)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  const users: string[] = [];
  let owner: Caller;
  let manager: Caller;
  let advisor: Caller;
  let advisorMembershipId: string;
  let callerB: Caller;
  let anonymous: Caller;
  let whatsappBot: Caller;
  let site: { id: string };
  let customer: { id: string };
  let vehicle: { id: string };
  let ops: { PLAQ: string; AMOR: string; VID: string };
  let products: { plaquettes: string; amortisseur: string; balais: string };

  async function orderWithInspection() {
    const order = await adminDb.repairOrder.create({
      data: {
        organizationId: orgA.id,
        siteId: site.id,
        number: `OR-YOP-2026-${randomBytes(2).toString("hex")}`,
        customerId: customer.id,
        vehicleId: vehicle.id,
        status: "DIAGNOSING",
        advisorId: advisorMembershipId,
        lines: {
          create: {
            organizationId: orgA.id,
            type: "LABOR",
            description: "Vidange",
            quantity: 0.5,
            unitPrice: 15_000,
            vatRate: 18,
            approval: "APPROVED",
            approvalSource: "CHECK_IN",
          },
        },
      },
    });
    const inspection = await adminDb.inspection.create({
      data: {
        organizationId: orgA.id,
        repairOrderId: order.id,
        completedAt: NOW,
        items: {
          create: [
            {
              organizationId: orgA.id,
              category: "Freinage",
              label: "Plaquettes avant",
              result: "URGENT",
              recommendedLaborIds: [ops.PLAQ],
              recommendedProductIds: [products.plaquettes],
              sortOrder: 0,
            },
            {
              organizationId: orgA.id,
              category: "Suspension",
              label: "Amortisseurs arrière",
              result: "WATCH",
              recommendedLaborIds: [ops.AMOR],
              recommendedProductIds: [products.amortisseur],
              sortOrder: 1,
            },
            {
              organizationId: orgA.id,
              category: "Visibilité",
              label: "Balais d'essuie-glace",
              result: "WATCH",
              recommendedProductIds: [products.balais],
              sortOrder: 2,
            },
            {
              organizationId: orgA.id,
              category: "Niveaux",
              label: "Huile moteur",
              result: "OK",
              sortOrder: 3,
            },
          ],
        },
      },
    });
    return { order, inspection };
  }

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = "local";
    process.env.LOCAL_STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "atelieros-quote-"));
    setQuotesClock(fixedClock(NOW));
    setRepairOrdersClock(fixedClock(NOW));
    orgA = await adminDb.organization.create({
      data: { name: "Garage Devis Test A", onboardingCompletedAt: NOW },
    });
    orgB = await adminDb.organization.create({
      data: { name: "Garage Devis Test B", onboardingCompletedAt: NOW },
    });
    site = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Yopougon", code: "YOP", whatsappNumber: "+2250700000000" },
    });
    await adminDb.site.create({ data: { organizationId: orgB.id, name: "Cocody", code: "COC" } });
    // Canaux console actifs : SMS et email (WhatsApp exige un modèle approuvé hors fenêtre 24 h).
    for (const channel of ["SMS", "EMAIL"] as const) {
      await adminDb.channelConfig.create({
        data: { organizationId: orgA.id, channel, provider: "console", isActive: true, credentials: "{}", status: "OK" },
      });
    }
    await adminDb.reminderRule.create({
      data: {
        organizationId: orgA.id,
        type: "QUOTE_FOLLOWUP",
        name: "Relance devis",
        steps: [{ key: "J+2", offsetDays: 2, templateKey: "quote_followup", autoSend: true, channels: ["SMS"] }],
        sendWindow: { days: [1, 2, 3, 4, 5, 6], from: "08:00", to: "19:00" },
        stopOn: ["quote.accepted", "quote.declined"],
      },
    });
    const o = await member(orgA.id, "Owner Devis A", "OWNER");
    const m = await member(orgA.id, "Chef d'atelier", "MANAGER");
    const a = await member(orgA.id, "Bamba Aminata", "ADVISOR");
    const b = await member(orgB.id, "Owner Devis B", "OWNER");
    users.push(o.userId, m.userId, a.userId, b.userId);
    owner = o.caller;
    manager = m.caller;
    advisor = a.caller;
    advisorMembershipId = a.membershipId;
    callerB = b.caller;
    anonymous = callerFactory(await contextFor(null));
    whatsappBot = callerFactory(await contextFor(null, "WhatsApp/2.23.20.0 A"));
    customer = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Kouassi Jean-Marc", phone: "+2250747218890", email: "kouassi@example.com" },
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
    const [plaq, amor, vid] = await Promise.all([
      adminDb.laborOperation.create({
        data: { organizationId: orgA.id, code: "PLAQ", name: "Remplacement plaquettes AV", standardHours: 1 },
      }),
      adminDb.laborOperation.create({
        data: { organizationId: orgA.id, code: "AMOR", name: "Remplacement amortisseurs AR", standardHours: 2 },
      }),
      adminDb.laborOperation.create({
        data: {
          organizationId: orgA.id,
          code: "VID",
          name: "Vidange moteur + filtre",
          standardHours: 0.5,
          fixedPrice: 25_000,
          defaultParts: [{ category: "Lubrifiants", quantity: 1 }],
          vehicleOverrides: [{ make: "Toyota", model: "Hilux", standardHours: 1 }],
        },
      }),
    ]);
    ops = { PLAQ: plaq.id, AMOR: amor.id, VID: vid.id };
    const [p1, p2, p3] = await Promise.all([
      adminDb.product.create({
        data: { organizationId: orgA.id, sku: "PLQ-COR", name: "Jeu de plaquettes AV Toyota Corolla", salePrice: 28_000, minSalePrice: 25_000, purchasePrice: 18_000 },
      }),
      adminDb.product.create({
        data: { organizationId: orgA.id, sku: "AMO-AR", name: "Amortisseurs arrière (paire)", salePrice: 90_000, purchasePrice: 60_000 },
      }),
      adminDb.product.create({
        data: { organizationId: orgA.id, sku: "BAL-EG", name: "Balais d'essuie-glace (jeu)", salePrice: 8_000, purchasePrice: 4_000 },
      }),
    ]);
    await adminDb.product.create({
      data: { organizationId: orgA.id, sku: "HU-5W30", name: "Huile 5W30 (bidon 4 L)", category: "Lubrifiants", salePrice: 18_000 },
    });
    products = { plaquettes: p1.id, amortisseur: p2.id, balais: p3.id };
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    const where = { organizationId: { in: orgIds } };
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.message.deleteMany({ where });
    await adminDb.conversation.deleteMany({ where });
    await adminDb.reminder.deleteMany({ where });
    await adminDb.reminderRule.deleteMany({ where });
    await adminDb.portalToken.deleteMany({ where });
    await adminDb.attachment.deleteMany({ where });
    await adminDb.vehicleRecommendation.deleteMany({ where });
    await adminDb.invoiceLine.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.repairOrderLine.deleteMany({ where });
    await adminDb.quoteLine.deleteMany({ where });
    await adminDb.quote.deleteMany({ where });
    await adminDb.inspectionItem.deleteMany({ where });
    await adminDb.inspection.deleteMany({ where });
    await adminDb.repairOrderStatusHistory.deleteMany({ where });
    await adminDb.repairOrder.deleteMany({ where });
    await adminDb.stockLevel.deleteMany({ where });
    await adminDb.product.deleteMany({ where });
    await adminDb.laborOperation.deleteMany({ where });
    await adminDb.documentSequence.deleteMany({ where });
    await adminDb.channelConfig.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  describe("US-M05-01 / RG-M05-03 — devis depuis l'inspection, envoi, portail, décision", () => {
    let quoteId: string;
    let orderId: string;
    let publicUrl: string;
    let groups: { key: string; label: string; priority: string | null; isOptional: boolean }[];

    it("crée un devis DRAFT numéroté DEV-YOP-2026-00001 avec 3 groupes et le total du PRD", async () => {
      const { order, inspection } = await orderWithInspection();
      orderId = order.id;
      const { quote, alreadyApproved, itemsAdded } = await advisor.quote.createFromInspection({
        inspectionId: inspection.id,
      });
      quoteId = quote.id;
      expect(quote.number).toBe("DEV-YOP-2026-00001");
      expect(quote.status).toBe("DRAFT");
      expect(quote.origin).toBe("INSPECTION");
      expect(quote.total).toBe(201_780);
      expect(quote.vatTotal).toBe(30_780);
      expect(quote.validUntil.toISOString().slice(0, 10)).toBe("2026-11-03");
      expect(itemsAdded).toBe(3);
      expect(alreadyApproved.map((l) => l.description)).toEqual(["Vidange"]);
      const detail = await advisor.quote.get({ id: quoteId });
      groups = detail.groups;
      expect(detail.groups.map((g) => [g.label, g.priority, g.isOptional, g.total])).toEqual([
        ["Plaquettes avant", "URGENT", false, 50_740],
        ["Amortisseurs arrière", "WATCH", true, 141_600],
        ["Balais d'essuie-glace", "WATCH", true, 9_440],
      ]);
      expect(detail.lines).toHaveLength(5);
      expect(detail.transitions).toEqual(["send", "decide", "delete"]);
      const items = await adminDb.inspectionItem.findMany({ where: { inspectionId: inspection.id, addedToQuote: true } });
      expect(items).toHaveLength(3);
    });

    it("isolation : une autre organisation ne voit ni ne lit ce devis", async () => {
      await expect(callerB.quote.get({ id: quoteId })).rejects.toThrow();
      const list = await callerB.quote.list({});
      expect(list.items.some((q) => q.id === quoteId)).toBe(false);
      await expect(callerB.quoteLine.remove({ id: (await advisor.quote.get({ id: quoteId })).lines[0]!.id })).rejects.toThrow();
    });

    it("US-M05-03 — remise 15 % par un réceptionniste : validation requise, envoi bloqué, puis validée par le chef", async () => {
      const detail = await advisor.quote.get({ id: quoteId });
      const labor = detail.lines.find((l) => l.laborOperationId === ops.PLAQ)!;
      await expect(
        advisor.quoteLine.update({ id: labor.id, patch: { discountRate: 15 } }),
      ).rejects.toThrow(/motif/);
      await advisor.quote.update({ id: quoteId, patch: { discountReason: "LOYAL_CUSTOMER" } });
      const { discount } = await advisor.quoteLine.update({ id: labor.id, patch: { discountRate: 15 } });
      expect(discount).toEqual({ ok: false, status: "PENDING" });
      await expect(advisor.quote.send({ id: quoteId, channel: "SMS" })).rejects.toThrow(/validation/);
      await expect(advisor.quote.decideDiscount({ id: quoteId, decision: "APPROVE" })).rejects.toThrow(/Permission/);
      const approved = await manager.quote.decideDiscount({ id: quoteId, decision: "APPROVE" });
      expect(approved.discountApprovalStatus).toBe("APPROVED");
      // Retour à 0 % de remise pour conserver les montants du PRD.
      const back = await advisor.quoteLine.update({ id: labor.id, patch: { discountRate: 0 } });
      expect(back.quote.total).toBe(201_780);
      const notifications = await adminDb.notification.findMany({ where: { organizationId: orgA.id, type: "quote.discount_decided" } });
      expect(notifications).toHaveLength(1);
    });

    it("RG-M05-06 — prix sous le minimum refusé sans permission, accepté par le propriétaire avec motif", async () => {
      const detail = await advisor.quote.get({ id: quoteId });
      const part = detail.lines.find((l) => l.productId === products.plaquettes)!;
      await expect(
        advisor.quoteLine.update({ id: part.id, patch: { unitPrice: 20_000 } }),
      ).rejects.toThrow(/minimum/);
      await owner.quoteLine.update({ id: part.id, patch: { unitPrice: 20_000, priceReason: "Alignement concurrence" } });
      const restored = await owner.quoteLine.update({ id: part.id, patch: { unitPrice: 28_000 } });
      expect(restored.quote.total).toBe(201_780);
      const audit = await adminDb.auditLog.findFirst({ where: { organizationId: orgA.id, action: "quote.price_below_min" } });
      expect(audit?.reason).toBe("Alignement concurrence");
    });

    it("US-M05-04 — envoi : SENT, message en file, OR en attente d'accord, lien public", async () => {
      const result = await advisor.quote.send({ id: quoteId, channel: "SMS" });
      publicUrl = result.publicUrl;
      expect(result.quote.status).toBe("SENT");
      expect(result.quote.sentVia).toBe("SMS");
      expect(result.quote.sentTo).toBe("+2250747218890");
      expect(result.messageId).toBeTruthy();
      expect(result.body).toContain("DEV-YOP-2026-00001");
      expect(result.body).toContain("201 780 FCFA TTC (dont 50 740 FCFA urgents)");
      expect(result.body).toContain(publicUrl);
      expect(publicUrl).toMatch(/\/p\/[A-Za-z0-9_-]{40,}\/devis$/);
      const message = await adminDb.message.findUniqueOrThrow({ where: { id: result.messageId! } });
      expect(message.channel).toBe("SMS");
      expect(message.status).toBe("QUEUED");
      const order = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      expect(order.status).toBe("AWAITING_APPROVAL");
      expect(order.lines.filter((l) => l.quoteLineId && l.approval === "PENDING")).toHaveLength(5);
      const events = await adminDb.domainEvent.findMany({ where: { organizationId: orgA.id, type: "quote.sent" } });
      expect(events).toHaveLength(1);
      // Un devis envoyé est figé : modification en place refusée.
      await expect(advisor.quote.update({ id: quoteId, patch: { globalDiscountRate: 5 } })).rejects.toThrow(/nouvelle version/);
      await expect(manager.quote.delete({ id: quoteId, reason: "test" })).rejects.toThrow(/traçabilité/);
    });

    it("portail : un robot d'aperçu ne marque pas « vu », une ouverture humaine oui", async () => {
      const token = tokenFromUrl(publicUrl);
      const botView = await whatsappBot.portal.quote.get({ token });
      expect(botView.state).toBe("OPEN");
      expect((await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("SENT");
      const view = await anonymous.portal.quote.get({ token });
      expect(view.number).toBe("DEV-YOP-2026-00001");
      expect(view.total).toBe(201_780);
      expect(view.groups.map((g) => g.label)).toEqual(["Plaquettes avant", "Amortisseurs arrière", "Balais d'essuie-glace"]);
      expect(view.groups[0]!.lines.map((l) => l.total)).toEqual([17_700, 33_040]);
      expect(view.requireSignature).toBe(true);
      const updated = await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } });
      expect(updated.status).toBe("VIEWED");
      expect(updated.viewedAt).toEqual(NOW);
      const detail = await advisor.quote.get({ id: quoteId });
      expect(detail.link?.openCount).toBe(2);
      // Un jeton REPAIR_ORDER ne donne jamais accès au portail devis (portée A2).
      await expect(anonymous.portal.quote.get({ token: "x".repeat(40) })).rejects.toThrow(/introuvable/);
    });

    it("US-M05-05 — décision partielle signée : PARTIALLY_ACCEPTED, 60 180 FCFA, OR approuvé, recommandation, relances annulées", async () => {
      const token = tokenFromUrl(publicUrl);
      const view = await anonymous.portal.quote.get({ token });
      await adminDb.reminder.create({
        data: {
          organizationId: orgA.id,
          ruleId: (await adminDb.reminderRule.findFirstOrThrow({ where: { organizationId: orgA.id } })).id,
          type: "QUOTE_FOLLOWUP",
          stepKey: "J+2",
          customerId: customer.id,
          quoteId,
          dueDate: new Date("2026-11-03T00:00:00Z"),
          scheduledFor: new Date("2026-10-21T09:00:00Z"),
          status: "PLANNED",
          dedupeKey: `QUOTE_FOLLOWUP:${quoteId}:J+2`,
        },
      });
      await expect(
        anonymous.portal.quote.decide({
          token,
          decisions: [{ groupKey: view.groups[0]!.key, accepted: true }],
          signerName: "Kouassi Jean-Marc",
          signatureDataUrl: SIGNATURE,
          contentHash: "stale-hash-00000000",
        }),
      ).rejects.toThrow(/mis à jour/);
      await expect(
        anonymous.portal.quote.decide({
          token,
          decisions: [{ groupKey: view.groups[0]!.key, accepted: true }],
          signerName: "Kouassi Jean-Marc",
          contentHash: view.contentHash,
        }),
      ).rejects.toThrow(/signature/);
      const result = await anonymous.portal.quote.decide({
        token,
        decisions: [
          { groupKey: view.groups[0]!.key, accepted: true },
          { groupKey: view.groups[1]!.key, accepted: false },
          { groupKey: view.groups[2]!.key, accepted: true },
        ],
        declineReason: "LATER",
        signerName: "Kouassi Jean-Marc",
        signatureDataUrl: SIGNATURE,
        contentHash: view.contentHash,
      });
      expect(result.status).toBe("PARTIALLY_ACCEPTED");
      expect(result.acceptedTotal).toBe(60_180);
      expect(result.alreadyDecided).toBe(false);

      const quote = await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true } });
      expect(quote.status).toBe("PARTIALLY_ACCEPTED");
      expect(quote.acceptedTotal).toBe(60_180);
      expect(quote.decisionChannel).toBe("portal");
      expect(quote.signerName).toBe("Kouassi Jean-Marc");
      expect(quote.signatureUrl).toMatch(/^\/api\/attachments\//);
      expect(quote.decisionHash).toHaveLength(64);
      expect(quote.decisionIp).toBe("41.207.1.2");
      expect(quote.lines.filter((l) => l.accepted).length).toBe(3);
      expect(quote.lines.find((l) => l.laborOperationId === ops.AMOR)?.declineReason).toBe("LATER");

      // RG-M05-12 : lignes acceptées copiées dans l'OR, approuvées ; OR → APPROVED.
      const order = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const fromQuote = order.lines.filter((l) => l.quoteLineId);
      expect(fromQuote).toHaveLength(5);
      expect(fromQuote.filter((l) => l.approval === "APPROVED" && l.approvalSource === "QUOTE")).toHaveLength(3);
      expect(fromQuote.filter((l) => l.approval === "DECLINED")).toHaveLength(2);
      expect(order.status).toBe("APPROVED");
      expect(order.totalEstimate).toBe(60_180 + 8_850);

      const recommendations = await adminDb.vehicleRecommendation.findMany({ where: { organizationId: orgA.id, vehicleId: vehicle.id } });
      expect(recommendations).toHaveLength(1);
      expect(recommendations[0]!.label).toBe("Amortisseurs arrière");
      const reminder = await adminDb.reminder.findFirstOrThrow({ where: { quoteId } });
      expect(reminder.status).toBe("CANCELLED");
      const accepted = await adminDb.domainEvent.findMany({ where: { organizationId: orgA.id, type: "quote.accepted" } });
      expect(accepted).toHaveLength(1);
      expect((accepted[0]!.payload as { acceptedTotal: number }).acceptedTotal).toBe(60_180);
      const notifications = await adminDb.notification.findMany({ where: { organizationId: orgA.id, type: "quote.decided" } });
      expect(notifications.some((n) => n.membershipId === advisorMembershipId)).toBe(true);

      // §11 : double soumission → décision déjà enregistrée, rien ne change.
      const again = await anonymous.portal.quote.decide({
        token,
        decisions: [{ groupKey: view.groups[1]!.key, accepted: true }],
        signerName: "Kouassi Jean-Marc",
        signatureDataUrl: SIGNATURE,
        contentHash: view.contentHash,
      });
      expect(again.alreadyDecided).toBe(true);
      const portal = await anonymous.portal.quote.get({ token });
      expect(portal.state).toBe("DECIDED");
      expect(portal.acceptedTotal).toBe(60_180);
    });

    it("US-M05-06 — question et demande de rappel depuis le portail", async () => {
      const token = tokenFromUrl(publicUrl);
      const result = await anonymous.portal.quote.ask({ token, message: "Les amortisseurs peuvent attendre ?" });
      expect(result.messageIds).toHaveLength(1);
      const message = await adminDb.message.findUniqueOrThrow({ where: { id: result.messageIds[0]! } });
      expect(message.direction).toBe("INBOUND");
      expect(message.body).toBe("[Devis DEV-YOP-2026-00001] Les amortisseurs peuvent attendre ?");
      await anonymous.portal.quote.ask({ token, callback: true });
      const callback = await adminDb.notification.findFirst({ where: { organizationId: orgA.id, type: "quote.callback_requested" } });
      expect(callback?.title).toBe("Rappeler Kouassi Jean-Marc au sujet du devis DEV-YOP-2026-00001");
    });

    it("RG-M05-11 — décision complémentaire : les amortisseurs refusés passent acceptés", async () => {
      const amendment = await advisor.quote.recordDecision({
        id: quoteId,
        channel: "phone",
        decisions: [{ groupKey: groups[1]!.key, accepted: true }],
        counterpartName: "M. Kouassi lui-même",
        amendment: true,
        sendWrittenConfirmation: false,
      });
      expect(amendment.status).toBe("ACCEPTED");
      expect(amendment.acceptedTotal).toBe(201_780);
      const order = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      expect(order.lines.filter((l) => l.quoteLineId && l.approval === "APPROVED")).toHaveLength(5);
    });

    it("US-M05-14 — statistiques : 1 devis clos accepté → 100 %", async () => {
      const stats = await owner.quote.stats({});
      expect(stats.closed).toBe(1);
      expect(stats.acceptedCount).toBe(1);
      expect(stats.rateCount).toBe(100);
      expect(stats.rateValue).toBe(100);
      await expect(advisor.quote.stats({})).rejects.toThrow(/Permission/);
    });
  });

  describe("US-M05-02 / US-M05-07 / US-M05-08 / US-M05-11 — devis libre, kit, version, téléphone, conversion", () => {
    let quoteId: string;
    let publicUrl: string;

    it("crée un devis libre pour un prospect (nom + téléphone) et ajoute un forfait avec son kit", async () => {
      const quote = await advisor.quote.create({
        newCustomer: { name: "Bamba Mariam", phone: "05 01 02 06 62" },
        origin: "STANDALONE",
      });
      quoteId = quote.id;
      expect(quote.number).toBe("DEV-YOP-2026-00002");
      const prospect = await adminDb.customer.findUniqueOrThrow({ where: { id: quote.customerId } });
      expect(prospect).toMatchObject({ phone: "+2250501020662", source: "devis", displayName: "Bamba Mariam" });
      const kit = await advisor.quote.addKit({ quoteId, laborOperationId: ops.VID });
      expect(kit.added).toBe(2);
      // Forfait 25 000 (qté 1) + huile 18 000 = 43 000 HT, TVA 7 740.
      expect(kit.quote.total).toBe(50_740);
      const detail = await advisor.quote.get({ id: quoteId });
      expect(detail.groups).toHaveLength(1);
      expect(detail.groups[0]!.lineIds).toHaveLength(2);
      const catalog = await advisor.quote.catalog({ q: "vidange" });
      expect(catalog.find((c) => c.kind === "LABOR")).toMatchObject({ code: "VID", fixed: true, kitParts: 1, unitPrice: 25_000 });
      const parts = await advisor.quote.catalog({ q: "huile", siteId: site.id });
      expect(parts.find((c) => c.kind === "PART")).toMatchObject({ available: 0, leadTimeDays: 3 });
    });

    it("US-M05-08 — modification après envoi : version 2 brouillon, v1 remplacée, ancien lien révoqué", async () => {
      const sent = await advisor.quote.send({ id: quoteId, channel: "LINK_ONLY" });
      publicUrl = sent.publicUrl;
      expect(sent.messageId).toBeNull();
      expect(sent.quote.status).toBe("SENT");
      const { quote: v2, priceChanges } = await advisor.quote.createVersion({ id: quoteId });
      expect(v2.number).toBe("DEV-YOP-2026-00002");
      expect(v2.version).toBe(2);
      expect(v2.status).toBe("DRAFT");
      expect(v2.supersedesId).toBe(quoteId);
      expect(v2.total).toBe(50_740);
      expect(priceChanges).toEqual([]);
      const v1 = await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } });
      expect(v1.supersededAt).toEqual(NOW);
      await expect(anonymous.portal.quote.get({ token: tokenFromUrl(publicUrl) })).rejects.toThrow(/mis à jour/);
      await expect(advisor.quote.createVersion({ id: quoteId })).rejects.toThrow(/déjà été remplacée/);
      const list = await advisor.quote.list({ tab: "TODO" });
      expect(list.items.filter((q) => q.number === "DEV-YOP-2026-00002").map((q) => q.version)).toEqual([2]);
      quoteId = v2.id;
    });

    it("US-M05-07 — accord par téléphone : décision tracée + confirmation écrite automatique (SMS)", async () => {
      const detail = await advisor.quote.get({ id: quoteId });
      await expect(
        owner.quote.recordDecision({ id: quoteId, channel: "phone", decisions: [] }),
      ).rejects.toThrow(/non optionnels/);
      const result = await advisor.quote.recordDecision({
        id: quoteId,
        channel: "phone",
        decisions: [{ groupKey: detail.groups[0]!.key, accepted: true }],
        counterpartName: "Mme Bamba elle-même",
      });
      expect(result.status).toBe("ACCEPTED");
      expect(result.acceptedTotal).toBe(50_740);
      expect(result.confirmationMessageId).toBeTruthy();
      const message = await adminDb.message.findUniqueOrThrow({ where: { id: result.confirmationMessageId! } });
      expect(message.body).toMatch(/^Suite à notre appel de \d{2}:\d{2}, vous avez accepté : Vidange moteur \+ filtre \(50 740 FCFA TTC\)\. Si ce n'est pas correct/);
      const quote = await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } });
      expect(quote.decisionChannel).toBe("phone");
      expect(quote.decisionCounterpart).toBe("Mme Bamba elle-même");
      expect(quote.recordedById).toBe(advisorMembershipId);
      const audit = await adminDb.auditLog.findFirst({ where: { entityId: quoteId, action: "quote.decision_recorded" } });
      expect(audit).not.toBeNull();
    });

    it("US-M05-11 — conversion d'un devis libre accepté en OR brouillon (véhicule requis)", async () => {
      await expect(advisor.quote.convertToRepairOrder({ id: quoteId })).rejects.toThrow(/véhicule/);
      const prospectVehicle = await adminDb.vehicle.create({
        data: {
          organizationId: orgA.id,
          customerId: (await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } })).customerId,
          plate: "9999 ZZ 01",
          plateCompact: "9999ZZ01",
          make: "Hyundai",
          model: "Tucson",
        },
      });
      await adminDb.quote.update({ where: { id: quoteId }, data: { vehicleId: prospectVehicle.id } });
      const converted = await advisor.quote.convertToRepairOrder({ id: quoteId });
      expect(converted.number).toMatch(/^OR-YOP-2026-\d{5}$/);
      expect(converted.suggestedDurationHours).toBe(1);
      const order = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: converted.repairOrderId }, include: { lines: true } });
      expect(order.status).toBe("DRAFT");
      expect(order.lines).toHaveLength(2);
      expect(order.lines.every((l) => l.approval === "APPROVED" && l.approvalSource === "QUOTE" && l.quoteLineId)).toBe(true);
      expect(order.totalEstimate).toBe(50_740);
      const quote = await adminDb.quote.findUniqueOrThrow({ where: { id: quoteId } });
      expect(quote.status).toBe("CONVERTED");
      expect(quote.repairOrderId).toBe(order.id);
      expect(quote.convertedAt).toEqual(NOW);
    });

    it("US-M05-11 / US-M05-12 — vente comptoir facturée et acompte (facture DEPOSIT brouillon)", async () => {
      const quote = await advisor.quote.create({
        customerId: customer.id,
        lines: [{ type: "PART", productId: products.balais, description: "Balais", quantity: 2 }],
      });
      await advisor.quote.recordDecision({
        id: quote.id,
        channel: "in_person",
        decisions: [{ lineId: (await advisor.quote.get({ id: quote.id })).lines[0]!.id, accepted: true }],
        signerName: "Kouassi Jean-Marc",
        signatureDataUrl: SIGNATURE,
        sendWrittenConfirmation: false,
      });
      const { invoiceId } = await owner.quote.convertToInvoice({ id: quote.id });
      const invoice = await adminDb.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
      expect(invoice.status).toBe("DRAFT");
      expect(invoice.total).toBe(18_880);
      expect(invoice.lines).toHaveLength(1);
      expect(invoice.quoteId).toBe(quote.id);
      const deposit = await owner.quote.requestDeposit({ id: quote.id, amount: 10_000 });
      expect(deposit.amount).toBe(10_000);
      const depositInvoice = await adminDb.invoice.findUniqueOrThrow({ where: { id: deposit.invoiceId } });
      expect(depositInvoice.type).toBe("DEPOSIT");
      expect(depositInvoice.total).toBe(10_000);
      expect((await owner.quote.requestDeposit({ id: quote.id })).invoiceId).toBe(deposit.invoiceId);
    });

    it("RG-M05-08 — devis expiré : décision portail refusée, décision personnel forçable avec motif", async () => {
      const quote = await advisor.quote.create({
        customerId: customer.id,
        validUntil: "2026-10-01",
        lines: [{ type: "LABOR", laborOperationId: ops.PLAQ, description: "Plaquettes", quantity: 1 }],
      });
      const sent = await advisor.quote.send({ id: quote.id, channel: "EMAIL" });
      const token = tokenFromUrl(sent.publicUrl);
      const view = await anonymous.portal.quote.get({ token });
      expect(view.state).toBe("EXPIRED");
      await expect(
        anonymous.portal.quote.decide({
          token,
          decisions: [{ groupKey: view.groups[0]!.key, accepted: true }],
          signerName: "Kouassi",
          signatureDataUrl: SIGNATURE,
          contentHash: view.contentHash,
        }),
      ).rejects.toThrow(/expiré/);
      const refresh = await adminDb.notification.findFirst({ where: { organizationId: orgA.id, type: "quote.refresh_requested" } });
      expect(refresh).not.toBeNull();
      await expect(
        advisor.quote.recordDecision({ id: quote.id, channel: "phone", decisions: [{ groupKey: view.groups[0]!.key, accepted: true }], sendWrittenConfirmation: false }),
      ).rejects.toThrow(/QUOTE_EXPIRED/);
      const forced = await advisor.quote.recordDecision({
        id: quote.id,
        channel: "phone",
        decisions: [{ groupKey: view.groups[0]!.key, accepted: true }],
        overrideExpiredReason: "Le client a rappelé le lendemain",
        sendWrittenConfirmation: false,
      });
      expect(forced.status).toBe("ACCEPTED");
      const audit = await adminDb.auditLog.findFirst({ where: { entityId: quote.id, action: "quote.decision_forced_after_expiry" } });
      expect(audit?.reason).toBe("Le client a rappelé le lendemain");
    });

    it("US-M05-10 — réactivation d'un devis expiré avec les prix catalogue actuels", async () => {
      const quote = await advisor.quote.create({
        customerId: customer.id,
        lines: [{ type: "PART", productId: products.balais, description: "Balais", quantity: 1 }],
      });
      await advisor.quote.send({ id: quote.id, channel: "LINK_ONLY" });
      await adminDb.quote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } });
      await adminDb.product.update({ where: { id: products.balais }, data: { salePrice: 9_000 } });
      const { quote: v2, priceChanges } = await advisor.quote.createVersion({ id: quote.id });
      expect(v2.status).toBe("DRAFT");
      expect(priceChanges).toEqual([{ lineId: expect.any(String), from: 8_000, to: 9_000 }]);
      expect(v2.total).toBe(10_620);
      await adminDb.product.update({ where: { id: products.balais }, data: { salePrice: 8_000 } });
    });

    it("quote.delete — brouillon jamais envoyé supprimé logiquement, avec motif audité", async () => {
      const quote = await advisor.quote.create({ customerId: customer.id });
      await expect(advisor.quote.delete({ id: quote.id, reason: "doublon" })).rejects.toThrow(/Permission/);
      await manager.quote.delete({ id: quote.id, reason: "doublon" });
      await expect(advisor.quote.get({ id: quote.id })).rejects.toThrow();
      const audit = await adminDb.auditLog.findFirst({ where: { entityId: quote.id, action: "quote.deleted" } });
      expect(audit?.reason).toBe("doublon");
    });

    it("catalogue MO : création / modification réservées à labor_catalog:manage, code unique", async () => {
      await expect(advisor.laborOperation.create({ code: "GEO", name: "Géométrie", standardHours: 0, fixedPrice: 15_000 })).rejects.toThrow(/Permission/);
      const geo = await manager.laborOperation.create({ code: "geo", name: "Géométrie / parallélisme", standardHours: 0, fixedPrice: 15_000, customerDescription: "Réglage des roues pour une usure régulière des pneus." });
      expect(geo.code).toBe("GEO");
      await expect(manager.laborOperation.create({ code: "GEO", name: "Doublon", standardHours: 1 })).rejects.toThrow(/existe déjà/);
      const list = await advisor.laborOperation.list({ q: "géom" });
      expect(list).toHaveLength(1);
      expect(list[0]!.pricing).toEqual({ quantity: 1, unitPrice: 15_000 });
      const archived = await manager.laborOperation.archive({ id: geo.id });
      expect(archived.isActive).toBe(false);
      const settings = await owner.quote.updateSettings({ validityDays: 10, depositRule: { thresholdTtc: 300_000, rate: 50 } });
      expect(settings.validityDays).toBe(10);
      expect(settings.depositRule).toEqual({ thresholdTtc: 300_000, rate: 50 });
      expect(settings.discountCaps.ADVISOR).toEqual({ line: 10, global: 5 });
      await expect(advisor.quote.updateSettings({ validityDays: 5 })).rejects.toThrow(/Permission/);
    });
  });
});
