import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expireQuotesForOrganization } from "./quotes";

describe("M05 — quotes.expire (RG-M05-08 / US-M05-10)", () => {
  let org: { id: string };
  let advisor: { id: string };
  const users: string[] = [];
  let expiredQuoteId: string;
  let validQuoteId: string;
  let acceptedQuoteId: string;
  const now = new Date("2026-11-04T00:30:00Z");

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Devis Jobs" } });
    const site = await adminDb.site.create({
      data: { organizationId: org.id, name: "Yopougon", code: "YOP" },
    });
    const user = await adminDb.user.create({
      data: { name: "Advisor", email: `${randomBytes(4).toString("hex")}@example.com` },
    });
    users.push(user.id);
    advisor = await adminDb.membership.create({
      data: { organizationId: org.id, userId: user.id, role: "ADVISOR", siteIds: [] },
    });
    const customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Kouassi Jean-Marc" },
    });
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        plate: "2547 GH 01",
        plateCompact: "2547GH01",
        make: "Toyota",
        model: "Corolla",
      },
    });
    const rule = await adminDb.reminderRule.create({
      data: {
        organizationId: org.id,
        type: "QUOTE_FOLLOWUP",
        name: "Relance devis",
        steps: [],
        sendWindow: {},
        stopOn: [],
      },
    });
    const base = {
      organizationId: org.id,
      siteId: site.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      createdById: advisor.id,
      sentAt: new Date("2026-10-19T10:00:00Z"),
    };
    const expiredQuote = await adminDb.quote.create({
      data: {
        ...base,
        number: "DEV-YOP-2026-00001",
        status: "VIEWED",
        validUntil: new Date("2026-11-03T00:00:00Z"),
        total: 141_600,
        lines: {
          create: [
            {
              organizationId: org.id,
              type: "LABOR",
              description: "Remplacement amortisseurs AR",
              groupLabel: "Amortisseurs arrière",
              quantity: 2,
              unitPrice: 15_000,
              vatRate: 18,
              priority: "WATCH",
              isOptional: true,
              inspectionItemId: "insp-item-1",
              lineTotal: 35_400,
            },
            {
              organizationId: org.id,
              type: "PART",
              description: "Amortisseurs AR",
              quantity: 2,
              unitPrice: 45_000,
              vatRate: 18,
              priority: "WATCH",
              isOptional: true,
              inspectionItemId: "insp-item-1",
              lineTotal: 106_200,
            },
          ],
        },
      },
    });
    expiredQuoteId = expiredQuote.id;
    await adminDb.reminder.create({
      data: {
        organizationId: org.id,
        ruleId: rule.id,
        type: "QUOTE_FOLLOWUP",
        stepKey: "J+5",
        customerId: customer.id,
        quoteId: expiredQuote.id,
        dueDate: new Date("2026-11-03T00:00:00Z"),
        scheduledFor: new Date("2026-11-05T09:00:00Z"),
        status: "PLANNED",
        dedupeKey: `QUOTE_FOLLOWUP:${expiredQuote.id}:J+5`,
      },
    });
    validQuoteId = (
      await adminDb.quote.create({
        data: {
          ...base,
          number: "DEV-YOP-2026-00002",
          status: "SENT",
          validUntil: new Date("2026-11-04T00:00:00Z"),
        },
      })
    ).id;
    acceptedQuoteId = (
      await adminDb.quote.create({
        data: {
          ...base,
          number: "DEV-YOP-2026-00003",
          status: "PARTIALLY_ACCEPTED",
          validUntil: new Date("2026-10-01T00:00:00Z"),
        },
      })
    ).id;
  });

  afterAll(async () => {
    const where = { organizationId: org.id };
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.reminder.deleteMany({ where });
    await adminDb.reminderRule.deleteMany({ where });
    await adminDb.vehicleRecommendation.deleteMany({ where });
    await adminDb.quoteLine.deleteMany({ where });
    await adminDb.quote.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("expire les devis en attente dont la validité est dépassée (validUntil inclus = encore valide)", async () => {
    expect(await expireQuotesForOrganization(org.id, now)).toBe(1);
    const [expired, valid, accepted] = await Promise.all([
      adminDb.quote.findUniqueOrThrow({ where: { id: expiredQuoteId } }),
      adminDb.quote.findUniqueOrThrow({ where: { id: validQuoteId } }),
      adminDb.quote.findUniqueOrThrow({ where: { id: acceptedQuoteId } }),
    ]);
    expect(expired.status).toBe("EXPIRED");
    expect(valid.status).toBe("SENT");
    expect(accepted.status).toBe("PARTIALLY_ACCEPTED");
    // Idempotent.
    expect(await expireQuotesForOrganization(org.id, now)).toBe(0);
  });

  it("alimente les travaux conseillés, annule les relances, émet quote.expired et notifie", async () => {
    const recommendations = await adminDb.vehicleRecommendation.findMany({
      where: { organizationId: org.id },
    });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      label: "Amortisseurs arrière",
      severity: "WATCH",
      estimatedAmount: 35_400,
      inspectionItemId: "insp-item-1",
    });
    expect(recommendations[0]!.remindAt?.toISOString().slice(0, 10)).toBe("2027-02-02");
    const reminder = await adminDb.reminder.findFirstOrThrow({
      where: { quoteId: expiredQuoteId },
    });
    expect(reminder.status).toBe("CANCELLED");
    const events = await adminDb.domainEvent.findMany({
      where: { organizationId: org.id, type: "quote.expired" },
    });
    expect(events).toHaveLength(1);
    const notification = await adminDb.notification.findFirstOrThrow({
      where: { organizationId: org.id, type: "quote.expired" },
    });
    expect(notification.membershipId).toBe(advisor.id);
    expect(notification.title).toBe("Devis DEV-YOP-2026-00001 expiré sans réponse");
  });
});
