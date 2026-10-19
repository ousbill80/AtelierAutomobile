import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, DEFAULT_REMINDER_SETTINGS } from "@atelieros/core";
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

describe("reminderSettings router (M10 §6)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { userId: string; token: string };
  let ownerB: { userId: string; token: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Réglages A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Réglages B" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Réglages A");
    ownerB = await ownerContextFor(orgB.id, "Owner Réglages B");
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.session.deleteMany({ where: { userId: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.user.deleteMany({ where: { id: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("reminderSettings.get retourne les valeurs par défaut sans personnalisation", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const settings = await caller.reminderSettings.get();
    expect(settings).toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it("reminderSettings.update fusionne la mise à jour partielle sans écraser les autres réglages", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await caller.reminderSettings.update({ maxPerDay: 3 });
    const afterFirst = await caller.reminderSettings.get();
    expect(afterFirst.maxPerDay).toBe(3);
    expect(afterFirst.minGapDays).toBe(DEFAULT_REMINDER_SETTINGS.minGapDays);

    await caller.reminderSettings.update({ minGapDays: 5 });
    const afterSecond = await caller.reminderSettings.get();
    expect(afterSecond.maxPerDay).toBe(3);
    expect(afterSecond.minGapDays).toBe(5);

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "reminder_settings.updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
  });

  it("reminderSettings.setApprovalMode bascule PAUSED et journalise", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const paused = await caller.reminderSettings.setApprovalMode({ approvalMode: "PAUSED" });
    expect(paused.approvalMode).toBe("PAUSED");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "reminder_settings.approval_mode_changed" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();

    await caller.reminderSettings.setApprovalMode({ approvalMode: "PER_STEP" });
  });

  it("isolation multi-locataire : reminderSettings.update d'une organisation ne modifie pas l'autre", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const callerB = callerFactory(await contextFor(ownerB.token));

    await callerA.reminderSettings.update({ maxPerWeek: 42 });
    const settingsB = await callerB.reminderSettings.get();
    expect(settingsB.maxPerWeek).toBe(DEFAULT_REMINDER_SETTINGS.maxPerWeek);
  });

  it("reminderSettings.get ne touche pas aux autres clés de Organization.settings", async () => {
    await adminDb.organization.update({
      where: { id: orgA.id },
      data: { settings: { onboarding: { step: 8, skipped: [], completedAt: null } } },
    });
    const caller = callerFactory(await contextFor(ownerA.token));
    await caller.reminderSettings.update({ maxPerDay: 7 });

    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: orgA.id } });
    const settings = org.settings as { onboarding?: { step: number } };
    expect(settings.onboarding?.step).toBe(8);
  });
});
