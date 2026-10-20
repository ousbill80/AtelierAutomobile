import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  detectAnomaliesForOrganization,
  notifyAnomalies,
  processAiPurgeOutputsJob,
  processAiSuggestionsExpireJob,
} from "./aiJobs";

// M17 §9 / RG-M17-22 — anomalies (données réelles en base), expiration des suggestions,
// purge des sorties ; isolation : une organisation ne voit jamais les données d'une autre.

const NOW = new Date("2026-10-20T06:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("ai jobs (M17)", () => {
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { id: string };
  let ownerB: { id: string };
  let koffi: { id: string };

  async function membership(
    organizationId: string,
    role: "OWNER" | "ADVISOR" | "CASHIER",
    name: string,
  ) {
    const user = await adminDb.user.create({
      data: { name, email: `m17-jobs-${randomBytes(4).toString("hex")}@example.com` },
    });
    userIds.push(user.id);
    return adminDb.membership.create({
      data: { organizationId, userId: user.id, role, siteIds: [] },
    });
  }

  async function invoice(
    organizationId: string,
    siteId: string,
    customerId: string,
    data: { number: string; issuedAt: Date; discount: number; createdById: string },
  ) {
    return adminDb.invoice.create({
      data: {
        organizationId,
        siteId,
        customerId,
        number: data.number,
        status: "ISSUED",
        issuedAt: data.issuedAt,
        dueDate: data.issuedAt,
        subtotal: 100_000 - data.discount,
        discountTotal: data.discount,
        total: 100_000 - data.discount,
        balance: 0,
        createdById: data.createdById,
      },
    });
  }

  beforeAll(async () => {
    orgA = await adminDb.organization.create({
      data: { name: "M17 jobs A", onboardingCompletedAt: new Date() },
    });
    orgB = await adminDb.organization.create({
      data: { name: "M17 jobs B", onboardingCompletedAt: new Date() },
    });
    orgIds.push(orgA.id, orgB.id);
    ownerA = await membership(orgA.id, "OWNER", "Gérant A");
    ownerB = await membership(orgB.id, "OWNER", "Gérant B");
    koffi = await membership(orgA.id, "ADVISOR", "Koffi A.");
    const cashier = await membership(orgA.id, "CASHIER", "Awa");
    const siteA = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "A", code: "AAA" },
    });
    const siteB = await adminDb.site.create({
      data: { organizationId: orgB.id, name: "B", code: "BBB" },
    });
    const custA = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Client A" },
    });
    const custB = await adminDb.customer.create({
      data: { organizationId: orgB.id, displayName: "Client B" },
    });

    // Historique de Koffi : 4 % de remise en moyenne, puis 35 % hier (US-M17-11).
    for (let i = 0; i < 8; i++) {
      await invoice(orgA.id, siteA.id, custA.id, {
        number: `FAC-2026-0003${i}`,
        issuedAt: day(10 + i),
        discount: i % 2 ? 3_000 : 5_000,
        createdById: koffi.id,
      });
    }
    const big = await invoice(orgA.id, siteA.id, custA.id, {
      number: "FAC-2026-000455",
      issuedAt: day(0.5),
      discount: 35_000,
      createdById: koffi.id,
    });
    const product = await adminDb.product.create({
      data: { organizationId: orgA.id, sku: "BAT-70", name: "Batterie 70Ah", averageCost: 45_000 },
    });
    await adminDb.invoiceLine.create({
      data: {
        organizationId: orgA.id,
        invoiceId: big.id,
        type: "PART",
        productId: product.id,
        description: "Batterie 70Ah",
        quantity: 1,
        unitPrice: 40_000,
        vatRate: 18,
        lineSubtotal: 40_000,
        lineVat: 7_200,
        lineTotal: 47_200,
        costAmount: 45_000,
      },
    });
    await adminDb.cashSession.createMany({
      data: [5, 4].map((n, i) => ({
        organizationId: orgA.id,
        siteId: siteA.id,
        openedById: cashier.id,
        openedAt: day(n),
        openingFloat: 0,
        closedById: cashier.id,
        closedAt: day(n),
        difference: i === 0 ? -15_000 : -6_000,
      })),
    });
    // Organisation B : même remise énorme, jamais signalée à A.
    await invoice(orgB.id, siteB.id, custB.id, {
      number: "FAC-B-1",
      issuedAt: day(0.5),
      discount: 60_000,
      createdById: ownerB.id,
    });
  });

  afterAll(async () => {
    const where = { organizationId: { in: orgIds } };
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.notification.deleteMany({ where });
    await adminDb.aiSuggestion.deleteMany({ where });
    await adminDb.aiInteraction.deleteMany({ where });
    await adminDb.cashSession.deleteMany({ where });
    await adminDb.invoiceLine.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.product.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.site.deleteMany({ where });
    await adminDb.notification.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("US-M17-11 — remise inhabituelle, vente à perte et écarts de caisse détectés pour A seulement", async () => {
    const anomalies = await detectAnomaliesForOrganization(orgA.id, NOW);
    const codes = anomalies.map((a) => a.code).sort();
    expect(codes).toEqual(["anomaly.cash_gap", "anomaly.discount", "anomaly.price_below_cost"]);
    expect(anomalies.find((a) => a.code === "anomaly.discount")!.title).toBe(
      "Remise inhabituelle : 35 % sur FAC-2026-000455 (Koffi A.)",
    );
    expect(JSON.stringify(anomalies)).not.toContain("FAC-B-1");
  });

  it("alerte OWNER dédoublonnée, visible comme alerte (alert.anomaly.*), événement émis", async () => {
    const anomalies = await detectAnomaliesForOrganization(orgA.id, NOW);
    expect(await notifyAnomalies(orgA.id, anomalies, NOW)).toBe(3);
    expect(await notifyAnomalies(orgA.id, anomalies, NOW)).toBe(0);
    const alerts = await adminDb.notification.findMany({ where: { membershipId: ownerA.id } });
    expect(alerts.map((a) => a.type).sort()).toEqual([
      "alert.anomaly.cash_gap",
      "alert.anomaly.discount",
      "alert.anomaly.price_below_cost",
    ]);
    expect(alerts.every((a) => a.severity === "warning")).toBe(true);
    expect(await adminDb.notification.count({ where: { membershipId: ownerB.id } })).toBe(0);
    expect(
      await adminDb.domainEvent.count({
        where: { organizationId: orgA.id, type: "ai.anomaly_detected" },
      }),
    ).toBe(3);
  });

  it("§5 / RG-M17-06 — suggestions expirées après 48 h, sorties vidées après 180 j", async () => {
    const expired = await adminDb.aiSuggestion.create({
      data: {
        organizationId: orgA.id,
        feature: "reply_draft",
        targetEntity: "conversation",
        payload: { body: "x" },
        expiresAt: day(0.01),
      },
    });
    const fresh = await adminDb.aiSuggestion.create({
      data: {
        organizationId: orgA.id,
        feature: "reply_draft",
        targetEntity: "conversation",
        payload: { body: "y" },
        expiresAt: new Date(NOW.getTime() + 3_600_000),
      },
    });
    await processAiSuggestionsExpireJob(NOW);
    expect(
      (await adminDb.aiSuggestion.findUniqueOrThrow({ where: { id: expired.id } })).status,
    ).toBe("EXPIRED");
    expect((await adminDb.aiSuggestion.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe(
      "PENDING",
    );

    const old = await adminDb.aiInteraction.create({
      data: {
        organizationId: orgA.id,
        feature: "reply_draft",
        output: { body: "ancien" },
        credits: 2,
        createdAt: day(181),
      },
    });
    const recent = await adminDb.aiInteraction.create({
      data: { organizationId: orgA.id, feature: "reply_draft", output: { body: "récent" } },
    });
    await processAiPurgeOutputsJob(NOW);
    expect(await adminDb.aiInteraction.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      output: {},
      credits: 2,
      feature: "reply_draft",
    });
    expect(
      (await adminDb.aiInteraction.findUniqueOrThrow({ where: { id: recent.id } })).output,
    ).toEqual({
      body: "récent",
    });
  });
});

describe("ai.learn_reminder_timing (RG-M17-16)", () => {
  let org: { id: string };
  let kone: { id: string };

  beforeAll(async () => {
    org = await adminDb.organization.create({
      data: { name: "M17 timing", onboardingCompletedAt: new Date() },
    });
    kone = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Koné Ibrahim", phone: "+2250701010101" },
    });
    const sends: [string, string, boolean][] = [
      ["WHATSAPP", "2026-09-01T19:10:00Z", true],
      ["WHATSAPP", "2026-09-08T20:05:00Z", true],
      ["WHATSAPP", "2026-09-15T19:40:00Z", true],
      ["WHATSAPP", "2026-09-22T20:30:00Z", true],
      ["WHATSAPP", "2026-09-29T09:00:00Z", false],
      ["SMS", "2026-08-01T09:00:00Z", false],
      ["SMS", "2026-08-08T09:00:00Z", false],
      ["SMS", "2026-08-15T10:00:00Z", false],
    ];
    for (const [channel, sentAt, read] of sends) {
      await adminDb.message.create({
        data: {
          organizationId: org.id,
          customerId: kone.id,
          direction: "OUTBOUND",
          channel: channel as "WHATSAPP" | "SMS",
          to: "+2250701010101",
          body: "Relance",
          status: read ? "READ" : "DELIVERED",
          provider: "console",
          kind: "REMINDER",
          sentAt: new Date(sentAt),
          readAt: read ? new Date(sentAt) : null,
        },
      });
    }
  });

  afterAll(async () => {
    await adminDb.message.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("US-M17-09 — apprend 19 h sur WhatsApp pour Koné", async () => {
    const { learnReminderTimingForOrganization } = await import("./aiJobs");
    expect(await learnReminderTimingForOrganization(org.id, "Africa/Abidjan", NOW)).toBe(1);
    expect(await adminDb.customer.findUniqueOrThrow({ where: { id: kone.id } })).toMatchObject({
      bestSendHour: 19,
      bestChannel: "WHATSAPP",
      preferredChannel: null,
    });
    expect(await learnReminderTimingForOrganization(org.id, "Africa/Abidjan", NOW)).toBe(0);
  });
});
