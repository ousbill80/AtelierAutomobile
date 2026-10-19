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

describe("reminders router (M10)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { userId: string; token: string };
  let ownerB: { userId: string; token: string };
  let customerA: { id: string };
  let vehicleA: { id: string; inspectionExpiryDate: Date | null };
  let ruleA: { id: string };
  let reminderA: { id: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Relances Queue A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Relances Queue B" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Queue A");
    ownerB = await ownerContextFor(orgB.id, "Owner Queue B");

    await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Atelier A", code: "ATA", phone: "+2250700000099" },
    });
    customerA = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "Koné Ibrahim",
        civility: "M",
        lastName: "Koné",
        phone: "+2250700000010",
        whatsappPhone: "+2250700000010",
        hasWhatsapp: true,
        remindersConsent: true,
      },
    });
    vehicleA = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: customerA.id,
        plate: `QUE${randomBytes(2).toString("hex")}`,
        make: "Toyota",
        model: "Hilux",
        inspectionExpiryDate: new Date(Date.now() + 5 * 86_400_000),
      },
    });
    ruleA = await adminDb.reminderRule.create({
      data: {
        organizationId: orgA.id,
        type: "INSPECTION",
        name: "VT — file de test",
        steps: [
          {
            key: "J-5",
            label: "J-5",
            offsetDays: -5,
            templateKey: "vt_j5_test",
            autoSend: true,
            channels: ["WHATSAPP"],
          },
        ],
        sendWindow: {
          days: [1, 2, 3, 4, 5, 6],
          from: "08:00",
          to: "19:00",
          preferredTime: "09:00",
        },
        stopOn: [],
      },
    });
    await adminDb.messageTemplate.create({
      data: {
        organizationId: orgA.id,
        key: "vt_j5_test",
        name: "VT J-5 test",
        channel: "WHATSAPP",
        body: "Bonjour {{client.salutation}}, votre VT expire bientôt.",
      },
    });
    reminderA = await adminDb.reminder.create({
      data: {
        organizationId: orgA.id,
        ruleId: ruleA.id,
        type: "INSPECTION",
        stepKey: "J-5",
        customerId: customerA.id,
        vehicleId: vehicleA.id,
        dueDate: vehicleA.inspectionExpiryDate!,
        scheduledFor: new Date(),
        status: "NEEDS_APPROVAL",
        dedupeKey: `INSPECTION:${vehicleA.id}:test:J-5`,
        sequenceKey: `INSPECTION:${vehicleA.id}:test`,
      },
    });
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.reminder.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.messageTemplate.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.reminderRule.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.site.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.session.deleteMany({ where: { userId: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.user.deleteMany({ where: { id: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("reminders.queue retourne la relance en attente d'approbation (RG-M10-31 : sans canal → À appeler)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const queue = await caller.reminders.queue({ tab: "CALL_LIST" });
    expect(queue.items.map((i) => i.id)).toContain(reminderA.id);
  });

  it("reminders.preview rend le gabarit avec les variables résolues", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const preview = await caller.reminders.preview({ id: reminderA.id, channel: "WHATSAPP" });
    expect(preview.body).toContain("M. Koné");
  });

  it("reminders.approve envoie la relance et journalise", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.reminders.approve({ ids: [reminderA.id] });
    expect(result.queued).toBe(1);

    const updated = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminderA.id } });
    expect(updated.status).toBe("SENT");
    expect(updated.renderedBody).toContain("M. Koné");
  });

  it("isolation multi-locataire : reminders.queue d'une autre organisation ne voit rien", async () => {
    const callerB = callerFactory(await contextFor(ownerB.token));
    const queueB = await callerB.reminders.queue({ tab: "SENT_TODAY" });
    expect(queueB.items).toHaveLength(0);
  });

  it("isolation multi-locataire : reminders.get refuse l'accès à la relance d'une autre organisation", async () => {
    const callerB = callerFactory(await contextFor(ownerB.token));
    await expect(callerB.reminders.get({ id: reminderA.id })).rejects.toThrow();
  });
});
