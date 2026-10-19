import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function ownerContextFor(organizationId: string, name: string) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
    data: { organizationId, userId: user.id, role: "OWNER", siteIds: [] },
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
  return { userId: user.id, token };
}

const DRAFT_RULE = {
  type: "INSPECTION" as const,
  name: "VT — Règle de test",
  isActive: true,
  steps: [
    {
      key: "J-30",
      label: "J-30",
      offsetDays: -30,
      templateKey: "vt_j30",
      autoSend: true,
      channels: ["WHATSAPP" as const],
    },
  ],
  sendWindow: {
    days: [1, 2, 3, 4, 5, 6] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[],
    from: "08:00",
    to: "19:00",
    preferredTime: "09:00",
  },
  conditions: {},
  stopOn: ["appointment.created"],
};

describe("reminderRules router (M10)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { userId: string; token: string };
  let ownerB: { userId: string; token: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Relances A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Relances B" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Relances A");
    ownerB = await ownerContextFor(orgB.id, "Owner Relances B");
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.messageTemplate.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.reminderRule.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.session.deleteMany({ where: { userId: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.user.deleteMany({ where: { id: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("reminderRules.upsert refuse des paliers invalides (RG-M10-03)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await expect(
      caller.reminderRules.upsert({
        ...DRAFT_RULE,
        steps: [{ ...DRAFT_RULE.steps[0]!, key: "palier invalide avec espaces et minuscules" }],
      }),
    ).rejects.toThrow();
  });

  it("reminderRules.upsert refuse un événement d'arrêt inconnu (RG-M10-23)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await expect(
      caller.reminderRules.upsert({ ...DRAFT_RULE, stopOn: ["evenement.bidon"] }),
    ).rejects.toThrow();
  });

  it("reminderRules.upsert crée une règle et journalise reminder_rule.created", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const created = await caller.reminderRules.upsert(DRAFT_RULE);
    expect(created.name).toBe(DRAFT_RULE.name);
    expect(created.organizationId).toBe(orgA.id);

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "reminder_rule.created", entityId: created.id },
    });
    expect(log).not.toBeNull();
  });

  it("reminderRules.upsert met à jour une règle existante et journalise reminder_rule.updated", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const created = await caller.reminderRules.upsert({ ...DRAFT_RULE, name: "VT — à renommer" });
    const updated = await caller.reminderRules.upsert({
      ...DRAFT_RULE,
      id: created.id,
      name: "VT — renommée",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("VT — renommée");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "reminder_rule.updated", entityId: created.id },
    });
    expect(log).not.toBeNull();
  });

  it("reminderRules.toggle active/désactive une règle", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const created = await caller.reminderRules.upsert(DRAFT_RULE);
    const toggled = await caller.reminderRules.toggle({ id: created.id, isActive: false });
    expect(toggled.isActive).toBe(false);
  });

  it("isolation multi-locataire : reminderRules.list ne voit pas les règles d'une autre organisation", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await callerA.reminderRules.upsert(DRAFT_RULE);

    const callerB = callerFactory(await contextFor(ownerB.token));
    const listB = await callerB.reminderRules.list();
    expect(listB).toHaveLength(0);
  });

  it("isolation multi-locataire : reminderRules.get refuse l'accès à la règle d'une autre organisation", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const created = await callerA.reminderRules.upsert(DRAFT_RULE);

    const callerB = callerFactory(await contextFor(ownerB.token));
    await expect(callerB.reminderRules.get({ id: created.id })).rejects.toThrow();
  });

  it("reminderRules.simulate calcule un aperçu à blanc sans écriture", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const customer = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Client Simulation", remindersConsent: true },
    });
    const dueDate = new Date(Date.now() + 10 * 86_400_000);
    await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: customer.id,
        plate: `SIM${randomBytes(2).toString("hex")}`,
        make: "Toyota",
        model: "Hilux",
        inspectionExpiryDate: dueDate,
      },
    });

    const countBefore = await adminDb.reminderRule.count({ where: { organizationId: orgA.id } });
    const result = await caller.reminderRules.simulate({
      rule: { ...DRAFT_RULE, steps: [{ ...DRAFT_RULE.steps[0]!, offsetDays: -5 }] },
      days: 30,
    });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.sample.length).toBeGreaterThanOrEqual(1);

    const countAfter = await adminDb.reminderRule.count({ where: { organizationId: orgA.id } });
    expect(countAfter).toBe(countBefore);
  });

  it("isolation multi-locataire : reminderRules.previewTemplate ne voit pas les modèles d'une autre organisation", async () => {
    await adminDb.messageTemplate.create({
      data: {
        organizationId: orgA.id,
        key: "preview_test_key",
        name: "Modèle de test",
        channel: "WHATSAPP",
        body: "Bonjour {{client.salutation}}.",
      },
    });

    const callerA = callerFactory(await contextFor(ownerA.token));
    const previewA = await callerA.reminderRules.previewTemplate({ key: "preview_test_key" });
    expect(previewA.length).toBeGreaterThanOrEqual(1);

    const callerB = callerFactory(await contextFor(ownerB.token));
    const previewB = await callerB.reminderRules.previewTemplate({ key: "preview_test_key" });
    expect(previewB).toHaveLength(0);
  });
});
