import { adminDb, deleteTestOrganizations } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processRemindersDispatchJob } from "./remindersDispatch";
import { getRemindersQueue } from "../queues/reminders";
import { getMessagesQueue } from "../queues/messages";

// Échéances › « Relancer » : chaque véhicule a son propre message, même quand le client en a
// plusieurs (choix du garage, au lieu du message groupé vt_multi de RG-M10-15).
describe("reminders.dispatch — relance d'échéance depuis l'écran Échéances", () => {
  let orgId: string;
  let customerId: string;
  const vehicleIds: string[] = [];
  const rules: Record<string, string> = {};

  function inDays(days: number): Date {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
  }

  beforeAll(async () => {
    const org = await adminDb.organization.create({ data: { name: "Garage Échéances Groupées" } });
    orgId = org.id;
    customerId = (
      await adminDb.customer.create({
        data: {
          organizationId: orgId,
          displayName: "Kouassi Jean-Marc",
          phone: "+2250700000011",
          remindersConsent: true,
        },
      })
    ).id;
    for (const [plate, days] of [
      ["1111 AB 01", 10],
      ["5521 RS 01", 40],
    ] as const) {
      const vehicle = await adminDb.vehicle.create({
        data: {
          organizationId: orgId,
          customerId,
          plate,
          plateCompact: plate.replace(/\s/g, ""),
          make: "Toyota",
          model: "Corolla",
          inspectionExpiryDate: inDays(days),
          insuranceExpiryDate: inDays(days),
        },
      });
      vehicleIds.push(vehicle.id);
    }
    const sendWindow = {
      days: [0, 1, 2, 3, 4, 5, 6],
      from: "00:00",
      to: "23:59",
      preferredTime: "09:00",
    };
    for (const [type, templateKey] of [
      ["INSPECTION", "vt_j30"],
      ["INSURANCE_EXPIRY", "as_j15"],
    ] as const) {
      rules[type] = (
        await adminDb.reminderRule.create({
          data: {
            organizationId: orgId,
            type,
            name: type,
            isActive: true,
            steps: [
              {
                key: "J-30",
                label: "Rappel",
                offsetDays: -30,
                templateKey,
                autoSend: true,
                channels: ["SMS"],
              },
            ],
            sendWindow,
            conditions: {},
            stopOn: [],
          },
        })
      ).id;
    }
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgId,
        channel: "SMS",
        provider: "console",
        isActive: true,
        priority: 1,
        credentials: "",
      },
    });
    await adminDb.messageTemplate.createMany({
      data: [
        {
          organizationId: orgId,
          key: "vt_j30",
          name: "VT J-30",
          channel: "SMS",
          body: "VT {{vehicule.plaque}} expire le {{vt.dateExpiration}}",
          isActive: true,
        },
        {
          organizationId: orgId,
          key: "as_j15",
          name: "Assurance",
          channel: "SMS",
          body: "Assurance {{vehicule.plaque}} expire le {{assurance.dateExpiration}}",
          isActive: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await adminDb.reminder.updateMany({
      where: { organizationId: orgId },
      data: { messageId: null },
    });
    await deleteTestOrganizations([orgId]);
    await getRemindersQueue().close();
    await getMessagesQueue().close();
  });

  // Ce que crée reminders.dueRemind : MANUAL, approuvée, canal imposé, échéance du véhicule.
  const manual = (type: "INSPECTION" | "INSURANCE_EXPIRY", vehicleId: string, due: Date) =>
    adminDb.reminder.create({
      data: {
        organizationId: orgId,
        ruleId: rules[type]!,
        type,
        stepKey: "MANUAL",
        customerId,
        vehicleId,
        dueDate: due,
        scheduledFor: new Date(Date.now() - 1000),
        status: "PLANNED",
        channel: "SMS",
        channelLocked: true,
        approvedAt: new Date(),
        dedupeKey: `${type}:${vehicleId}:MANUAL:test:SMS`,
        sequenceKey: `${type}:${vehicleId}:manual`,
      },
    });

  it("VT : deux véhicules du même client → un message pour chacun, avec sa plaque", async () => {
    const a = await manual("INSPECTION", vehicleIds[0]!, inDays(10));
    const b = await manual("INSPECTION", vehicleIds[1]!, inDays(40));
    await processRemindersDispatchJob();
    const [ra, rb] = await Promise.all(
      [a, b].map((r) => adminDb.reminder.findUniqueOrThrow({ where: { id: r.id } })),
    );
    expect(ra!.skippedReason).toBeNull();
    expect(["QUEUED", "SENT"]).toContain(ra!.status);
    expect(ra!.messageId).not.toBeNull();
    expect(rb!.messageId).not.toBeNull();
    expect(rb!.messageId).not.toBe(ra!.messageId);
    const [ma, mb] = await Promise.all(
      [ra!, rb!].map((r) => adminDb.message.findUniqueOrThrow({ where: { id: r.messageId! } })),
    );
    expect(ma!.templateKey).toBe("vt_j30");
    expect(ma!.body).toContain("1111 AB 01");
    expect(ma!.body).not.toContain("5521 RS 01");
    expect(mb!.body).toContain("5521 RS 01");
  });

  it("assurance : un message par véhicule", async () => {
    const a = await manual("INSURANCE_EXPIRY", vehicleIds[0]!, inDays(10));
    const b = await manual("INSURANCE_EXPIRY", vehicleIds[1]!, inDays(40));
    await processRemindersDispatchJob();
    const [ra, rb] = await Promise.all(
      [a, b].map((r) => adminDb.reminder.findUniqueOrThrow({ where: { id: r.id } })),
    );
    expect(ra!.messageId).not.toBeNull();
    expect(rb!.messageId).not.toBeNull();
    expect(rb!.messageId).not.toBe(ra!.messageId);
  });
});
