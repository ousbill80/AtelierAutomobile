import { normalizePlate } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processRemindersPlanJob } from "./remindersPlan";
import { processRemindersDispatchJob } from "./remindersDispatch";
import { getRemindersQueue } from "../queues/reminders";
import { getMessagesQueue } from "../queues/messages";

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
    key: "J-7",
    label: "2e rappel",
    offsetDays: -7,
    templateKey: "vt_j7",
    autoSend: true,
    channels: ["WHATSAPP"],
  },
];
const SEND_WINDOW = {
  days: [0, 1, 2, 3, 4, 5, 6],
  from: "00:00",
  to: "23:59",
  preferredTime: "09:00",
};

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// RG-M02-05 : plate/plateCompact/plateType sont dérivés de la saisie (cf. packages/db/prisma/seed.ts).
function plateFields(input: string) {
  const normalized = normalizePlate(input);
  return {
    plate: normalized.plate,
    plateCompact: normalized.plateCompact,
    plateType: normalized.plateType,
  };
}

describe("reminders.plan / reminders.dispatch — intégration (M10)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let customerA: { id: string };
  let vehicleA: { id: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Plan/Dispatch Test A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Plan/Dispatch Test B" } });

    customerA = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "Client Plan Test",
        type: "INDIVIDUAL",
        phone: "+2250747210099",
        whatsappPhone: "+2250747210099",
      },
    });
    vehicleA = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: customerA.id,
        ...plateFields("9999 AB 01"),
        make: "Toyota",
        model: "Corolla",
        inspectionExpiryDate: daysFromNow(30), // J-30 dû aujourd'hui
      },
    });
    await adminDb.reminderRule.create({
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
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgA.id,
        channel: "WHATSAPP",
        provider: "console",
        isActive: true,
        priority: 1,
        credentials: "",
      },
    });
    await adminDb.messageTemplate.create({
      data: {
        organizationId: orgA.id,
        key: "vt_j30",
        name: "VT — J-30",
        channel: "WHATSAPP",
        body: "Bonjour {{client.salutation}}, VT {{vehicule.plaque}} expire le {{vt.dateExpiration}}.",
        isActive: true,
      },
    });

    // Organisation B : aucune règle active, aucun véhicule concerné — sert à vérifier
    // l'isolation multi-locataire du job (pas de fuite de candidats entre organisations).
    await adminDb.customer.create({
      data: { organizationId: orgB.id, displayName: "Client B", type: "INDIVIDUAL" },
    });
  });

  afterAll(async () => {
    await adminDb.message.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.reminder.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.reminderRule.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.messageTemplate.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.channelConfig.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await getRemindersQueue().close();
    await getMessagesQueue().close();
  });

  it("reminders.plan crée le palier J-30 dû aujourd'hui, en isolation par organisation", async () => {
    await processRemindersPlanJob();

    const remindersA = await adminDb.reminder.findMany({ where: { organizationId: orgA.id } });
    expect(remindersA).toHaveLength(1);
    expect(remindersA[0]?.stepKey).toBe("J-30");
    expect(remindersA[0]?.type).toBe("INSPECTION");
    // RG-M10-18 : premier passage de la règle + rattrapage (quelques ms entre la création du
    // véhicule et le passage du job) → NEEDS_APPROVAL, jamais d'envoi automatique à l'activation.
    expect(remindersA[0]?.status).toBe("NEEDS_APPROVAL");
    expect(remindersA[0]?.isCatchUp).toBe(true);
    // RG-M10-31 : un canal préliminaire est posé dès la planification (le client a un
    // whatsappPhone et WHATSAPP est actif) pour que la relance apparaisse dans « À valider »
    // plutôt que « À appeler » tant qu'un canal est exploitable.
    expect(remindersA[0]?.channel).toBe("WHATSAPP");
    expect(remindersA[0]?.sequenceKey).toBe(
      `INSPECTION:${vehicleA.id}:${daysFromNow(30).toISOString().slice(0, 10)}`,
    );

    const remindersB = await adminDb.reminder.findMany({ where: { organizationId: orgB.id } });
    expect(remindersB).toHaveLength(0);
  });

  it("reminders.plan est idempotent (ON CONFLICT DO NOTHING, RG-M10-05)", async () => {
    await processRemindersPlanJob();
    const remindersA = await adminDb.reminder.findMany({ where: { organizationId: orgA.id } });
    expect(remindersA).toHaveLength(1);
  });

  it("reminders.dispatch envoie la relance planifiée : Message créé, Reminder QUEUED", async () => {
    const reminder = await adminDb.reminder.findFirstOrThrow({
      where: { organizationId: orgA.id },
    });
    // Simule l'approbation manuelle (reminders.approve) qu'exige RG-M10-18 pour ce rattrapage
    // de premier passage, avant que dispatch ne puisse la prendre en charge.
    await adminDb.reminder.update({
      where: { id: reminder.id },
      data: { status: "PLANNED", approvedAt: new Date(), scheduledFor: new Date() },
    });

    await processRemindersDispatchJob();

    const updated = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(updated.status).toBe("QUEUED");
    expect(updated.messageId).not.toBeNull();
    expect(updated.channel).toBe("WHATSAPP");

    const message = await adminDb.message.findUniqueOrThrow({ where: { id: updated.messageId! } });
    expect(message.channel).toBe("WHATSAPP");
    expect(message.to).toBe("+2250747210099");
    expect(message.body).toContain("9999 AB 01");
    expect(message.kind).toBe("REMINDER");
  });

  it("reminders.dispatch est idempotent sur un rejeu (pas de second Message)", async () => {
    const reminder = await adminDb.reminder.findFirstOrThrow({
      where: { organizationId: orgA.id },
    });
    const messageCountBefore = await adminDb.message.count({ where: { organizationId: orgA.id } });

    // QUEUED n'est plus repris par dispatch (déjà traité) : on simule un rejeu du job sans
    // changer le statut, pour vérifier qu'aucun nouveau message n'apparaît.
    await processRemindersDispatchJob();

    const messageCountAfter = await adminDb.message.count({ where: { organizationId: orgA.id } });
    expect(messageCountAfter).toBe(messageCountBefore);
    const stillSameReminder = await adminDb.reminder.findUniqueOrThrow({
      where: { id: reminder.id },
    });
    expect(stillSameReminder.status).toBe("QUEUED");
  });
});
