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

const VT_STEPS = [
  {
    key: "J-30",
    label: "1er rappel",
    offsetDays: -30,
    templateKey: "vt_j30",
    autoSend: true,
    channels: ["WHATSAPP"],
  },
  {
    key: "J0",
    label: "Échéance",
    offsetDays: 0,
    templateKey: "vt_j0",
    autoSend: true,
    channels: ["WHATSAPP"],
  },
];
const SEND_WINDOW = {
  days: [1, 2, 3, 4, 5, 6],
  from: "08:00",
  to: "19:00",
  preferredTime: "09:00",
};

describe("reminders / reminderRules / reminderSettings routers (M10)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { userId: string; token: string };
  let ownerB: { userId: string; token: string };
  let callerA: ReturnType<typeof callerFactory>;
  let callerB: ReturnType<typeof callerFactory>;
  let customerA: { id: string };
  let ruleA: { id: string };
  let reminderA: { id: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Relances Test A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Relances Test B" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Relances A");
    ownerB = await ownerContextFor(orgB.id, "Owner Relances B");
    callerA = callerFactory(await contextFor(ownerA.token));
    callerB = callerFactory(await contextFor(ownerB.token));

    customerA = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "Client Relances Test",
        type: "INDIVIDUAL",
        phone: "+2250747210001",
      },
    });
    ruleA = await adminDb.reminderRule.create({
      data: {
        organizationId: orgA.id,
        type: "INSPECTION",
        name: "Visite technique",
        isActive: true,
        steps: VT_STEPS,
        sendWindow: SEND_WINDOW,
        conditions: {},
        stopOn: [],
      },
    });
    reminderA = await adminDb.reminder.create({
      data: {
        organizationId: orgA.id,
        ruleId: ruleA.id,
        type: "INSPECTION",
        stepKey: "J-30",
        customerId: customerA.id,
        dueDate: new Date(),
        scheduledFor: new Date(),
        status: "NEEDS_APPROVAL",
        channel: "WHATSAPP",
        dedupeKey: `INSPECTION:${customerA.id}:test:J-30`,
        sequenceKey: `INSPECTION:${customerA.id}:test`,
      },
    });
  });

  afterAll(async () => {
    await adminDb.reminderSuppression.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.reminder.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.reminderRule.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.session.deleteMany({ where: { userId: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.user.deleteMany({ where: { id: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("isolation multi-locataire : l'organisation B ne voit aucune relance de l'organisation A", async () => {
    const queueA = await callerA.reminders.queue({ tab: "TO_APPROVE" });
    expect(queueA.items.some((r) => r.id === reminderA.id)).toBe(true);

    const queueB = await callerB.reminders.queue({ tab: "TO_APPROVE" });
    expect(queueB.items.some((r) => r.id === reminderA.id)).toBe(false);

    await expect(callerB.reminders.get({ id: reminderA.id })).rejects.toThrow();
  });

  it("reminders.queue classe par onglet et compte les relances à valider", async () => {
    const queue = await callerA.reminders.queue({ tab: "TO_APPROVE" });
    expect(queue.counts.TO_APPROVE).toBeGreaterThanOrEqual(1);
  });

  it("reminders.approve planifie la relance et horodate l'approbation", async () => {
    const result = await callerA.reminders.approve({ ids: [reminderA.id], sendNow: true });
    expect(result.scheduled + result.queued).toBe(1);
    const updated = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminderA.id } });
    expect(updated.status).toBe("PLANNED");
    expect(updated.approvedById).not.toBeNull();
  });

  it("reminders.skip avec stopSequence crée une ReminderSuppression", async () => {
    const result = await callerA.reminders.skip({
      ids: [reminderA.id],
      reason: "Autre",
      stopSequence: true,
    });
    expect(result.updated).toBe(1);
    const suppression = await adminDb.reminderSuppression.findFirst({
      where: { organizationId: orgA.id, sequenceKey: `INSPECTION:${customerA.id}:test` },
    });
    expect(suppression).not.toBeNull();
    expect(suppression?.source).toBe("staff");
  });

  it("reminderRules.upsert puis toggle (RG-M10-02/03)", async () => {
    const created = await callerA.reminderRules.upsert({
      type: "SATISFACTION",
      name: "Satisfaction test",
      isActive: true,
      steps: [
        {
          key: "J+2",
          label: "Enquête",
          offsetDays: 2,
          templateKey: "satis_jp2",
          autoSend: true,
          channels: ["WHATSAPP"],
        },
      ],
      sendWindow: SEND_WINDOW,
      conditions: {},
      stopOn: [],
    });
    expect(created.isActive).toBe(true);

    const toggled = await callerA.reminderRules.toggle({ id: created.id, isActive: false });
    expect(toggled.isActive).toBe(false);

    await adminDb.reminderRule.delete({ where: { id: created.id } });
  });

  it("reminderRules.upsert rejette des offsets non strictement croissants (RG-M10-03)", async () => {
    await expect(
      callerA.reminderRules.upsert({
        type: "SATISFACTION",
        name: "Invalide",
        isActive: true,
        steps: [
          {
            key: "A",
            label: "A",
            offsetDays: 5,
            templateKey: "x",
            autoSend: true,
            channels: ["WHATSAPP"],
          },
          {
            key: "B",
            label: "B",
            offsetDays: 2,
            templateKey: "y",
            autoSend: true,
            channels: ["WHATSAPP"],
          },
        ],
        sendWindow: SEND_WINDOW,
        conditions: {},
        stopOn: [],
      }),
    ).rejects.toThrow();
  });

  it("reminderSettings.get renvoie les valeurs par défaut puis .update les persiste", async () => {
    const defaults = await callerA.reminderSettings.get();
    expect(defaults.maxPerDay).toBe(1);
    expect(defaults.maxPerWeek).toBe(3);

    const updated = await callerA.reminderSettings.update({ maxPerWeek: 5 });
    expect(updated.maxPerWeek).toBe(5);

    const reread = await callerA.reminderSettings.get();
    expect(reread.maxPerWeek).toBe(5);
  });
});
