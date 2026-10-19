import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processRemindersOnEventJob } from "./remindersOnEvent";
import { processRemindersOutcomesJob } from "./remindersOutcomes";

describe("reminders.on_event / reminders.outcomes — intégration (M10)", () => {
  let org: { id: string };
  let customer: { id: string };
  let rule: { id: string };

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Events Test" } });
    customer = await adminDb.customer.create({
      data: {
        organizationId: org.id,
        displayName: "Client Events Test",
        type: "INDIVIDUAL",
        phone: "+2250747210088",
      },
    });
    rule = await adminDb.reminderRule.create({
      data: {
        organizationId: org.id,
        type: "SERVICE",
        name: "Révision",
        isActive: true,
        steps: [
          {
            key: "J0",
            label: "Échéance",
            offsetDays: 0,
            templateKey: "rev_j0",
            autoSend: true,
            channels: ["WHATSAPP"],
          },
        ],
        sendWindow: {
          days: [0, 1, 2, 3, 4, 5, 6],
          from: "00:00",
          to: "23:59",
          preferredTime: "09:00",
        },
        conditions: {},
        stopOn: [],
      },
    });
  });

  afterAll(async () => {
    await adminDb.reminderSuppression.deleteMany({ where: { organizationId: org.id } });
    await adminDb.domainEvent.deleteMany({ where: { organizationId: org.id } });
    await adminDb.reminder.deleteMany({ where: { organizationId: org.id } });
    await adminDb.reminderRule.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("message.inbound_received (STOP) annule les relances non envoyées et pose OPTED_OUT", async () => {
    const planned = await adminDb.reminder.create({
      data: {
        organizationId: org.id,
        ruleId: rule.id,
        type: "SERVICE",
        stepKey: "J0",
        customerId: customer.id,
        dueDate: new Date(),
        scheduledFor: new Date(),
        status: "PLANNED",
        dedupeKey: "SERVICE:evt-test:J0",
        sequenceKey: "SERVICE:evt-test",
      },
    });
    const sent = await adminDb.reminder.create({
      data: {
        organizationId: org.id,
        ruleId: rule.id,
        type: "SERVICE",
        stepKey: "J-15",
        customerId: customer.id,
        dueDate: new Date(Date.now() - 15 * 86_400_000),
        scheduledFor: new Date(Date.now() - 15 * 86_400_000),
        status: "SENT",
        sentAt: new Date(Date.now() - 60_000),
        dedupeKey: "SERVICE:evt-test:J-15",
        sequenceKey: "SERVICE:evt-test",
      },
    });

    await adminDb.domainEvent.create({
      data: {
        organizationId: org.id,
        type: "message.inbound_received",
        payload: { address: "+2250747210088", customerId: customer.id, stop: true },
      },
    });

    await processRemindersOnEventJob();

    const updatedPlanned = await adminDb.reminder.findUniqueOrThrow({ where: { id: planned.id } });
    expect(updatedPlanned.status).toBe("CANCELLED");

    const updatedSent = await adminDb.reminder.findUniqueOrThrow({ where: { id: sent.id } });
    expect(updatedSent.outcome).toBe("OPTED_OUT");

    const events = await adminDb.domainEvent.findMany({ where: { organizationId: org.id } });
    expect(events.every((e) => e.processedAt !== null)).toBe(true);
  });

  it("reminders.outcomes pose NO_RESPONSE une fois la fenêtre d'attribution écoulée", async () => {
    const stale = await adminDb.reminder.create({
      data: {
        organizationId: org.id,
        ruleId: rule.id,
        type: "SERVICE",
        stepKey: "J0",
        customerId: customer.id,
        dueDate: new Date(Date.now() - 40 * 86_400_000),
        scheduledFor: new Date(Date.now() - 40 * 86_400_000),
        status: "SENT",
        sentAt: new Date(Date.now() - 40 * 86_400_000), // > 30 j (settings.attributionDays.SERVICE)
        dedupeKey: "SERVICE:evt-test-2:J0",
        sequenceKey: "SERVICE:evt-test-2",
      },
    });
    const fresh = await adminDb.reminder.create({
      data: {
        organizationId: org.id,
        ruleId: rule.id,
        type: "SERVICE",
        stepKey: "J0",
        customerId: customer.id,
        dueDate: new Date(),
        scheduledFor: new Date(),
        status: "SENT",
        sentAt: new Date(), // dans la fenêtre : pas encore de résultat
        dedupeKey: "SERVICE:evt-test-3:J0",
        sequenceKey: "SERVICE:evt-test-3",
      },
    });

    await processRemindersOutcomesJob();

    const updatedStale = await adminDb.reminder.findUniqueOrThrow({ where: { id: stale.id } });
    expect(updatedStale.outcome).toBe("NO_RESPONSE");

    const updatedFresh = await adminDb.reminder.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(updatedFresh.outcome).toBeNull();
  });
});
