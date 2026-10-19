import { fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMessagesQueue } from "../queues/messages";
import { getRemindersQueue } from "../queues/reminders";
import { processCollectionsPromisesJob, processReceivablesAgeJob } from "./receivablesAge";
import { processRemindersDispatchJob } from "./remindersDispatch";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("receivables.age / collections.promises — intégration (M09)", () => {
  let org: { id: string };
  let customer: { id: string };

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Créances Worker" } });
    const site = await adminDb.site.create({
      data: { organizationId: org.id, name: "Cocody", code: "COC" },
    });
    customer = await adminDb.customer.create({
      data: {
        organizationId: org.id,
        displayName: "Koné Ibrahim",
        phone: "+2250152770943",
        whatsappPhone: "+2250152770943",
      },
    });
    await adminDb.reminderRule.create({
      data: {
        organizationId: org.id,
        type: "RECEIVABLE",
        name: "Créances",
        isActive: true,
        steps: [
          {
            key: "J+3",
            label: "Courtois",
            offsetDays: 3,
            templateKey: "cr_j3",
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
    await adminDb.invoice.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        customerId: customer.id,
        number: "FAC-2026-000412",
        status: "ISSUED",
        issuedAt: d("2026-10-06"),
        dueDate: d("2026-10-06"),
        total: 185_000,
        balance: 185_000,
      },
    });
  });

  afterAll(async () => {
    await adminDb.message.deleteMany({ where: { organizationId: org.id } });
    await adminDb.reminder.deleteMany({ where: { organizationId: org.id } });
    await adminDb.messageTemplate.deleteMany({ where: { organizationId: org.id } });
    await adminDb.channelConfig.deleteMany({ where: { organizationId: org.id } });
    await adminDb.paymentPromise.deleteMany({ where: { organizationId: org.id } });
    await adminDb.reminderRule.deleteMany({ where: { organizationId: org.id } });
    await adminDb.invoice.deleteMany({ where: { organizationId: org.id } });
    await adminDb.collectionCase.deleteMany({ where: { organizationId: org.id } });
    await adminDb.domainEvent.deleteMany({ where: { organizationId: org.id } });
    await adminDb.customer.deleteMany({ where: { organizationId: org.id } });
    await adminDb.site.deleteMany({ where: { organizationId: org.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
    await getRemindersQueue().close();
    await getMessagesQueue().close();
  });

  it("le 07/10 à 01:00 la facture passe OVERDUE et le dossier s'ouvre (idempotent)", async () => {
    const clock = fixedClock(new Date("2026-10-07T01:00:00.000Z"));
    await processReceivablesAgeJob(clock);
    await processReceivablesAgeJob(clock);
    const cases = await adminDb.collectionCase.findMany({ where: { organizationId: org.id } });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ status: "OPEN", totalDue: 185_000, overdueDue: 185_000 });
    expect(cases[0]!.anchorDate).toEqual(d("2026-10-06"));
    const opened = await adminDb.domainEvent.count({
      where: { organizationId: org.id, type: "collection.opened" },
    });
    expect(opened).toBe(1);
  });

  it("promesse non tenue → BROKEN, dossier OPEN, une seule relance PROMISE_BROKEN", async () => {
    const kase = await adminDb.collectionCase.findFirstOrThrow({
      where: { organizationId: org.id },
    });
    await adminDb.collectionCase.update({
      where: { id: kase.id },
      data: { status: "PROMISED", previousStatus: "OPEN" },
    });
    await adminDb.paymentPromise.create({
      data: {
        organizationId: org.id,
        collectionCaseId: kase.id,
        amount: 185_000,
        promisedDate: d("2026-10-25"),
        createdAt: new Date("2026-10-08T10:00:00.000Z"),
      },
    });
    // la veille de l'échéance : rien ne bouge
    await processCollectionsPromisesJob(fixedClock(new Date("2026-10-25T01:15:00.000Z")));
    expect(
      (await adminDb.paymentPromise.findFirstOrThrow({ where: { collectionCaseId: kase.id } }))
        .status,
    ).toBe("PENDING");

    const clock = fixedClock(new Date("2026-10-26T01:15:00.000Z"));
    await processCollectionsPromisesJob(clock);
    await processCollectionsPromisesJob(clock);
    const promise = await adminDb.paymentPromise.findFirstOrThrow({
      where: { collectionCaseId: kase.id },
    });
    expect(promise.status).toBe("BROKEN");
    const after = await adminDb.collectionCase.findUniqueOrThrow({ where: { id: kase.id } });
    expect(after).toMatchObject({ status: "OPEN", brokenPromiseCount: 1 });
    const reminders = await adminDb.reminder.findMany({
      where: { organizationId: org.id, stepKey: "PROMISE_BROKEN" },
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.scheduledFor.toISOString()).toBe("2026-10-26T10:00:00.000Z");
    expect(reminders[0]!.dedupeKey).toBe(
      `RECEIVABLE:${kase.id}:2026-10-06:PROMISE_BROKEN:${promise.id}`,
    );
  });

  it("la relance PROMISE_BROKEN part avec le modèle cr_promesse_rompue et le montant promis", async () => {
    await adminDb.channelConfig.create({
      data: {
        organizationId: org.id,
        channel: "WHATSAPP",
        provider: "console",
        isActive: true,
        priority: 1,
        credentials: "",
      },
    });
    await adminDb.messageTemplate.create({
      data: {
        organizationId: org.id,
        key: "cr_promesse_rompue",
        name: "Créances — promesse non tenue",
        channel: "WHATSAPP",
        body: "Bonjour {{client.salutation}}, le paiement de {{promesse.montant}} prévu le {{promesse.date}} ne nous est pas parvenu.",
        isActive: true,
      },
    });
    const reminder = await adminDb.reminder.findFirstOrThrow({
      where: { organizationId: org.id, stepKey: "PROMISE_BROKEN" },
    });
    await adminDb.reminder.update({
      where: { id: reminder.id },
      data: { status: "PLANNED", approvedAt: new Date(), scheduledFor: new Date() },
    });
    await processRemindersDispatchJob();
    const sent = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(sent.status).toBe("QUEUED");
    const message = await adminDb.message.findUniqueOrThrow({ where: { id: sent.messageId! } });
    expect(message.body).toContain("185 000 FCFA");
    expect(message.body).toContain("25/10/2026");
  });

  it("facture réglée ailleurs → dossier CLOSED_PAID au passage suivant", async () => {
    await adminDb.invoice.updateMany({
      where: { organizationId: org.id },
      data: { status: "PAID", balance: 0, amountPaid: 185_000 },
    });
    await processReceivablesAgeJob(fixedClock(new Date("2026-10-27T01:00:00.000Z")));
    const kase = await adminDb.collectionCase.findFirstOrThrow({
      where: { organizationId: org.id },
    });
    expect(kase.status).toBe("CLOSED_PAID");
  });
});
