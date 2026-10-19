import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { beforeAll, describe, expect, it } from "vitest";
import { scanOrganizationAlerts } from "./alertsScan";
import { sendOrganizationDigest } from "./digestOwner";

const DAY = 24 * 60 * 60 * 1000;

describe("M12 — alerts.scan et digest.owner", () => {
  let org: { id: string };
  let other: { id: string };
  let owner: { id: string };
  let advisor: { id: string };
  const now = new Date("2026-10-19T08:00:00Z");

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Digest Test" } });
    other = await adminDb.organization.create({ data: { name: "Garage Digest Autre" } });
    const site = await adminDb.site.create({
      data: { organizationId: org.id, name: "Yopougon", code: "YOP" },
    });
    const ownerUser = await adminDb.user.create({
      data: {
        name: "Gérant",
        email: `${randomBytes(4).toString("hex")}@example.com`,
        phone: `+22507${randomBytes(4).readUInt32BE(0).toString().padStart(8, "0").slice(0, 8)}`,
      },
    });
    const advisorUser = await adminDb.user.create({
      data: { name: "Conseiller", email: `${randomBytes(4).toString("hex")}@example.com` },
    });
    owner = await adminDb.membership.create({
      data: { organizationId: org.id, userId: ownerUser.id, role: "OWNER", siteIds: [] },
    });
    advisor = await adminDb.membership.create({
      data: { organizationId: org.id, userId: advisorUser.id, role: "ADVISOR", siteIds: [] },
    });
    await adminDb.channelConfig.createMany({
      data: [
        {
          organizationId: org.id,
          channel: "WHATSAPP",
          provider: "console",
          isActive: true,
          credentials: "",
          status: "ERROR",
        },
        {
          organizationId: org.id,
          channel: "SMS",
          provider: "console",
          isActive: true,
          credentials: "",
          balance: 120,
        },
      ],
    });
    const customer = await adminDb.customer.create({
      data: {
        organizationId: org.id,
        displayName: "SOTRA Logistique",
        type: "COMPANY",
        phone: "+2250747218888",
      },
    });
    await adminDb.invoice.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        customerId: customer.id,
        number: "FAC-2026-000412",
        status: "OVERDUE",
        issuedAt: new Date(now.getTime() - 60 * DAY),
        dueDate: new Date("2026-09-01T00:00:00Z"),
        total: 1_240_000,
        balance: 1_240_000,
      },
    });
  });

  it("alerts.scan crée les alertes pour les OWNER, une fois par objet et par jour", async () => {
    const created = await scanOrganizationAlerts(org.id, now);
    expect(created).toBe(3);
    const notifications = await adminDb.notification.findMany({
      where: { organizationId: org.id },
      orderBy: { type: "asc" },
    });
    expect(notifications.every((n) => n.membershipId === owner.id)).toBe(true);
    expect(notifications.map((n) => [n.type, n.severity])).toEqual([
      ["alert.channel_error", "critical"],
      ["alert.receivable_45d", "warning"],
      ["alert.sms_balance_low", "warning"],
    ]);
    expect(notifications.find((n) => n.type === "alert.receivable_45d")?.title).toBe(
      "Facture FAC-2026-000412 en retard de 48 j — SOTRA Logistique",
    );
    expect(await scanOrganizationAlerts(org.id, now)).toBe(0);
    expect(await scanOrganizationAlerts(other.id, now)).toBe(0);
    expect(advisor.id).toBeDefined();
  });

  it("digest.owner : rien avant l'heure, puis un seul message DIGEST par jour", async () => {
    expect(await sendOrganizationDigest(org.id, new Date("2026-10-19T07:00:00Z"))).toBe(0);
    expect(await sendOrganizationDigest(org.id, now)).toBe(1);
    expect(await sendOrganizationDigest(org.id, now)).toBe(0);
    const messages = await adminDb.message.findMany({
      where: { organizationId: org.id, kind: "DIGEST" },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.idempotencyKey).toBe(`digest:${owner.id}:2026-10-19`);
    expect(messages[0]!.body).toContain("☀️ Garage Digest Test — lundi 19/10/2026");
    expect(messages[0]!.body).toContain("ARGENT DEHORS : 1 240 000 FCFA dont 1 240 000 à +30 j");
    expect(messages[0]!.body).toContain("⚠️ Canal WhatsApp en erreur");
    expect(await sendOrganizationDigest(other.id, now)).toBe(0);
  });

  it("digest.owner : désactivé via settings.digest.enabled = false", async () => {
    await adminDb.organization.update({
      where: { id: org.id },
      data: { settings: { digest: { enabled: false } } },
    });
    expect(await sendOrganizationDigest(org.id, new Date("2026-10-20T08:00:00Z"))).toBe(0);
  });
});
