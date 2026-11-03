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
    await adminDb.reminder.updateMany({
      where: { organizationId: orgA.id },
      data: { messageId: null },
    });
    await adminDb.message.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.reminderSuppression.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.customer.deleteMany({ where: { organizationId: orgB.id } });
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

  it("reminders.markWaLinkSent enregistre le texte ouvert dans wa.me (M11 wa_link)", async () => {
    const waReminder = await adminDb.reminder.create({
      data: {
        organizationId: orgA.id,
        ruleId: ruleA.id,
        type: "INSPECTION",
        stepKey: "J-7",
        customerId: customerA.id,
        dueDate: new Date(),
        scheduledFor: new Date(),
        status: "NEEDS_APPROVAL",
        channel: "WHATSAPP",
        dedupeKey: `INSPECTION:${customerA.id}:wa:J-7`,
        sequenceKey: `INSPECTION:${customerA.id}:wa`,
      },
    });
    const body = "Bonjour, votre visite technique expire le 15/11/2026.";

    await expect(callerB.reminders.markWaLinkSent({ id: waReminder.id, body })).rejects.toThrow();

    await callerA.reminders.markWaLinkSent({ id: waReminder.id, body });
    const updated = await adminDb.reminder.findUniqueOrThrow({ where: { id: waReminder.id } });
    expect(updated.status).toBe("SENT");
    const message = await adminDb.message.findUniqueOrThrow({ where: { id: updated.messageId! } });
    expect(message.provider).toBe("wa_link");
    expect(message.body).toBe(body);
    expect(message.to).toBe("+2250747210001");

    // Déjà envoyée : un second « Oui » ne crée pas de doublon.
    await expect(callerA.reminders.markWaLinkSent({ id: waReminder.id, body })).rejects.toThrow();
  });

  it("reminders.dueCalendar compte les échéances par jour ; dueDates filtre sur un jour (M10 §7.2)", async () => {
    const customerB = await adminDb.customer.create({
      data: { organizationId: orgB.id, displayName: "Client B", type: "INDIVIDUAL" },
    });
    const base = { make: "Toyota", model: "Corolla" };
    await adminDb.vehicle.createMany({
      data: [
        {
          ...base,
          organizationId: orgA.id,
          customerId: customerA.id,
          plate: "1001 AA 01",
          plateCompact: "1001AA01",
          inspectionExpiryDate: new Date("2031-03-10"),
        },
        {
          ...base,
          organizationId: orgA.id,
          customerId: customerA.id,
          plate: "1002 AA 01",
          plateCompact: "1002AA01",
          inspectionExpiryDate: new Date("2031-03-10"),
        },
        {
          ...base,
          organizationId: orgA.id,
          customerId: customerA.id,
          plate: "1003 AA 01",
          plateCompact: "1003AA01",
          inspectionExpiryDate: new Date("2031-03-31"),
        },
        {
          ...base,
          organizationId: orgA.id,
          customerId: customerA.id,
          plate: "1004 AA 01",
          plateCompact: "1004AA01",
          inspectionExpiryDate: new Date("2031-04-01"),
        },
        {
          ...base,
          organizationId: orgB.id,
          customerId: customerB.id,
          plate: "1005 AA 01",
          plateCompact: "1005AA01",
          inspectionExpiryDate: new Date("2031-03-10"),
        },
      ],
    });

    const calendarA = await callerA.reminders.dueCalendar({ kind: "INSPECTION", month: "2031-03" });
    expect(calendarA.days).toEqual({ "2031-03-10": 2, "2031-03-31": 1 });
    expect(calendarA.total).toBe(3);

    // Isolation : l'organisation B ne voit que son propre véhicule.
    const calendarB = await callerB.reminders.dueCalendar({ kind: "INSPECTION", month: "2031-03" });
    expect(calendarB.days).toEqual({ "2031-03-10": 1 });

    const day = await callerA.reminders.dueDates({
      kind: "INSPECTION",
      filter: "ALL",
      day: "2031-03-10",
    });
    expect(day.items.map((v) => v.plate).sort()).toEqual(["1001 AA 01", "1002 AA 01"]);

    await expect(
      callerA.reminders.dueCalendar({ kind: "INSPECTION", month: "2031-13" }),
    ).rejects.toThrow();

    // Pagination par curseur : aucun véhicule sauté d'une page à l'autre.
    const plates: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await callerA.reminders.dueDates({
        kind: "INSPECTION",
        filter: "ALL",
        limit: 1,
        cursor,
      });
      plates.push(...page.items.map((v) => v.plate));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect([...plates].sort()).toEqual(["1001 AA 01", "1002 AA 01", "1003 AA 01", "1004 AA 01"]);
  });

  it("« Renvoyer par… » : options par canal puis envoi par le canal choisi (verrouillé)", async () => {
    const blocked = await adminDb.reminder.create({
      data: {
        organizationId: orgA.id,
        ruleId: ruleA.id,
        type: "INSPECTION",
        stepKey: "J-7",
        customerId: customerA.id,
        dueDate: new Date(),
        scheduledFor: new Date(),
        status: "NEEDS_APPROVAL",
        channel: null,
        skippedReason: "Erreur de rendu, à vérifier.",
        dedupeKey: `INSPECTION:${customerA.id}:via:J-7`,
        sequenceKey: `INSPECTION:${customerA.id}:via`,
      },
    });
    await adminDb.channelConfig.createMany({
      data: [
        {
          organizationId: orgA.id,
          channel: "SMS",
          provider: "console",
          isActive: true,
          priority: 1,
          credentials: "",
        },
        {
          organizationId: orgA.id,
          channel: "WHATSAPP",
          provider: "wa_link",
          isActive: true,
          priority: 1,
          credentials: "",
        },
      ],
    });

    const options = await callerA.reminders.channelOptions({ id: blocked.id });
    expect(options).toEqual([
      { channel: "WHATSAPP", mode: "manual_only", address: "+2250747210001", error: null },
      { channel: "SMS", mode: "test", address: "+2250747210001", error: null },
      { channel: "EMAIL", mode: "off", address: null, error: null },
    ]);

    // Pas d'email : refus clair ; WhatsApp en mode lien : refus (passer par « Ouvrir dans WhatsApp »).
    await expect(callerA.reminders.sendVia({ id: blocked.id, channel: "EMAIL" })).rejects.toThrow(
      /pas d'email/,
    );
    await expect(
      callerA.reminders.sendVia({ id: blocked.id, channel: "WHATSAPP" }),
    ).rejects.toThrow(/mode lien/);
    await expect(callerB.reminders.sendVia({ id: blocked.id, channel: "SMS" })).rejects.toThrow();

    await callerA.reminders.sendVia({ id: blocked.id, channel: "SMS" });
    const after = await adminDb.reminder.findUniqueOrThrow({ where: { id: blocked.id } });
    expect(after).toMatchObject({
      status: "PLANNED",
      channel: "SMS",
      channelLocked: true,
      skippedReason: null,
    });
    expect(after.approvedById).not.toBeNull();
    await adminDb.channelConfig.deleteMany({ where: { organizationId: orgA.id } });
  });

  it("accusé de réception : ✓ envoyé, onglet « Pas reçues », puis ✓✓ reçu", async () => {
    const message = await adminDb.message.create({
      data: {
        organizationId: orgA.id,
        customerId: customerA.id,
        direction: "OUTBOUND",
        channel: "SMS",
        to: "+2250747210001",
        body: "Rappel",
        status: "SENT",
        provider: "orange_sms",
        kind: "REMINDER",
        sentAt: new Date(Date.now() - 3 * 3_600_000),
      },
    });
    const sent = await adminDb.reminder.create({
      data: {
        organizationId: orgA.id,
        ruleId: ruleA.id,
        type: "INSPECTION",
        stepKey: "J0",
        customerId: customerA.id,
        dueDate: new Date(),
        scheduledFor: new Date(Date.now() - 3 * 3_600_000),
        sentAt: new Date(Date.now() - 3 * 3_600_000),
        status: "SENT",
        channel: "SMS",
        messageId: message.id,
        dedupeKey: `INSPECTION:${customerA.id}:ack:J0`,
        sequenceKey: `INSPECTION:${customerA.id}:ack`,
      },
    });

    const unconfirmed = await callerA.reminders.queue({ tab: "UNCONFIRMED" });
    expect(unconfirmed.items.map((r) => r.id)).toContain(sent.id);
    expect(unconfirmed.items.find((r) => r.id === sent.id)!.delivery?.state).toBe("sent");
    expect(unconfirmed.counts.UNCONFIRMED).toBeGreaterThanOrEqual(1);
    // Isolation : l'autre garage ne voit rien.
    expect((await callerB.reminders.queue({ tab: "UNCONFIRMED" })).items).toHaveLength(0);

    await adminDb.message.update({
      where: { id: message.id },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });
    const after = await callerA.reminders.queue({ tab: "UNCONFIRMED" });
    expect(after.items.map((r) => r.id)).not.toContain(sent.id);
    const all = await callerA.reminders.queue({ tab: "SENT_TODAY" });
    const row = all.items.find((r) => r.id === sent.id);
    if (row) expect(row.delivery?.state).toBe("delivered");

    await adminDb.reminder.delete({ where: { id: sent.id } });
    await adminDb.message.delete({ where: { id: message.id } });
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
