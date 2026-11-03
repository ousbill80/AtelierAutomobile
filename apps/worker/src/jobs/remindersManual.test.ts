import { DEFAULT_MESSAGE_TEMPLATES } from "@atelieros/core";
import { adminDb, deleteTestOrganizations } from "@atelieros/db";
import type { Job } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { processRemindersDispatchJob } from "./remindersDispatch";
import { processMessagesSendJob } from "./messagesSend";
import type { MessagesSendJobData } from "../queues/messages";
import { getRemindersQueue } from "../queues/reminders";
import { getMessagesQueue } from "../queues/messages";

// « Relancer maintenant » (M09) : une relance de créance hors séquence (stepKey MANUAL)
// reprend le premier palier client de la règle et part au prochain dispatch ; elle est
// annulée si la facture a été réglée entre-temps (revérification juste avant l'envoi).
describe("reminders.dispatch — relance manuelle de créance", () => {
  let orgId: string;
  let debtorId: string;
  let paidId: string;
  let ruleId: string;

  beforeAll(async () => {
    const org = await adminDb.organization.create({ data: { name: "Garage Relance Manuelle" } });
    orgId = org.id;
    const site = await adminDb.site.create({
      data: { organizationId: orgId, name: "Cocody", code: "COC" },
    });
    const customer = (name: string, phone: string) =>
      adminDb.customer.create({
        data: { organizationId: orgId, displayName: name, phone, whatsappPhone: phone },
      });
    debtorId = (await customer("Koné Ibrahim", "+2250152770943")).id;
    paidId = (await customer("Bamba Awa", "+2250707070707")).id;
    const overdue = new Date(Date.now() - 20 * 86_400_000);
    for (const [customerId, number, balance] of [
      [debtorId, "FAC-2026-000901", 185_000],
      [paidId, "FAC-2026-000902", 0],
    ] as const) {
      await adminDb.invoice.create({
        data: {
          organizationId: orgId,
          siteId: site.id,
          customerId,
          number,
          status: balance > 0 ? "OVERDUE" : "PAID",
          issuedAt: overdue,
          dueDate: overdue,
          total: 185_000,
          balance,
          amountPaid: 185_000 - balance,
          origin: "IMPORTED",
        },
      });
      await adminDb.collectionCase.create({ data: { organizationId: orgId, customerId } });
    }
    ruleId = (
      await adminDb.reminderRule.create({
        data: {
          organizationId: orgId,
          type: "RECEIVABLE",
          name: "Créances",
          isActive: true,
          steps: [
            {
              key: "J+3",
              label: "Rappel",
              offsetDays: 3,
              templateKey: "cr_jp3",
              autoSend: true,
              channels: ["WHATSAPP"],
            },
            {
              key: "J+45",
              label: "Alerte gérant",
              offsetDays: 45,
              templateKey: "cr_alerte_gerant",
              autoSend: true,
              internalOnly: true,
              channels: [],
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
      })
    ).id;
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgId,
        channel: "WHATSAPP",
        provider: "console",
        isActive: true,
        priority: 1,
        credentials: "",
      },
    });
    await adminDb.messageTemplate.create({
      data: {
        organizationId: orgId,
        key: "cr_jp3",
        name: "Créance J+3",
        channel: "WHATSAPP",
        body: "Bonjour {{client.salutation}}, il reste {{factures.resume}} à régler. Payer : {{lien.paiement}}",
        isActive: true,
      },
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

  const manual = (customerId: string) =>
    adminDb.reminder.create({
      data: {
        organizationId: orgId,
        ruleId,
        type: "RECEIVABLE",
        stepKey: "MANUAL",
        customerId,
        dueDate: new Date(),
        scheduledFor: new Date(Date.now() - 1000),
        status: "PLANNED",
        approvedAt: new Date(),
        dedupeKey: `RECEIVABLE:${customerId}:MANUAL:test`,
        sequenceKey: `RECEIVABLE:${customerId}:manual`,
      },
    });

  it("part avec le modèle du premier palier client et le total dû", async () => {
    const reminder = await manual(debtorId);
    await processRemindersDispatchJob();
    const updated = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(["QUEUED", "SENT"]).toContain(updated.status);
    const message = await adminDb.message.findUniqueOrThrow({ where: { id: updated.messageId! } });
    expect(message.to).toBe("+2250152770943");
    expect(message.body).toContain("1 facture(s)");
    // {{lien.paiement}} : lien court vers la page facture du portail (paiement en ligne).
    expect(message.body).toMatch(/Payer : https?:\/\/\S+\/l\/[A-Za-z0-9]{8}/);
    const portalToken = await adminDb.portalToken.findFirstOrThrow({
      where: { organizationId: orgId, reminderId: reminder.id },
    });
    expect(portalToken.scope).toBe("INVOICE");
    expect(message.body).toMatch(/185\s000/);
  });

  it("modèles par défaut cr_jp3 / cr_jp3_pro : rendus sans variable vide (particulier et entreprise)", async () => {
    // Régression : {{lien.paiement}} et {{lien.releve}} n'étaient jamais remplis pour une
    // créance, toutes les relances de créance échouaient (« Erreur de rendu, à vérifier »).
    await adminDb.messageTemplate.deleteMany({ where: { organizationId: orgId, key: "cr_jp3" } });
    const defaults = DEFAULT_MESSAGE_TEMPLATES.filter(
      (tpl) => (tpl.key === "cr_jp3" || tpl.key === "cr_jp3_pro") && tpl.channel === "WHATSAPP",
    );
    expect(defaults).toHaveLength(2);
    await adminDb.messageTemplate.createMany({
      data: defaults.map((tpl) => ({
        organizationId: orgId,
        key: tpl.key,
        name: tpl.key,
        channel: tpl.channel,
        body: tpl.body,
        isActive: true,
      })),
    });
    await adminDb.customer.update({ where: { id: debtorId }, data: { type: "COMPANY" } });
    // Repartir de zéro : le message du premier test serait réutilisé (clé d'idempotence).
    await adminDb.reminder.deleteMany({ where: { organizationId: orgId } });
    await adminDb.message.deleteMany({ where: { organizationId: orgId } });

    const reminder = await manual(debtorId);
    await processRemindersDispatchJob();
    const updated = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(updated.skippedReason).toBeNull();
    // QUEUED, ou déjà SENT si un worker local a envoyé le message entre-temps.
    expect(["QUEUED", "SENT"]).toContain(updated.status);
    const message = await adminDb.message.findUniqueOrThrow({ where: { id: updated.messageId! } });
    expect(message.templateKey).toBe("cr_jp3_pro");
    expect(message.body).not.toMatch(/\{\{/);
  });

  it("canaux choisis SMS + email : deux messages distincts, sans plafond anti-spam", async () => {
    await adminDb.reminder.deleteMany({ where: { organizationId: orgId } });
    await adminDb.message.deleteMany({ where: { organizationId: orgId } });
    await adminDb.customer.update({
      where: { id: debtorId },
      data: { type: "INDIVIDUAL", email: "kone@example.com" },
    });
    await adminDb.channelConfig.createMany({
      data: (["SMS", "EMAIL"] as const).map((channel) => ({
        organizationId: orgId,
        channel,
        provider: "console",
        isActive: true,
        priority: 1,
        credentials: "",
      })),
    });
    await adminDb.messageTemplate.createMany({
      data: (["SMS", "EMAIL"] as const).map((channel) => ({
        organizationId: orgId,
        key: "cr_jp3",
        name: "cr_jp3",
        channel,
        subject: channel === "EMAIL" ? "Rappel" : null,
        body: "Bonjour {{client.salutation}}, {{factures.resume}} à régler : {{lien.paiement}}",
        isActive: true,
      })),
    });
    const made = await Promise.all(
      (["SMS", "EMAIL"] as const).map((channel) =>
        adminDb.reminder.create({
          data: {
            organizationId: orgId,
            ruleId,
            type: "RECEIVABLE",
            stepKey: "MANUAL",
            customerId: debtorId,
            dueDate: new Date(),
            scheduledFor: new Date(Date.now() - 1000),
            status: "PLANNED",
            channel,
            approvedAt: new Date(),
            dedupeKey: `RECEIVABLE:${debtorId}:MANUAL:multi:${channel}`,
            sequenceKey: `RECEIVABLE:${debtorId}:manual`,
          },
        }),
      ),
    );
    await processRemindersDispatchJob();
    const updated = await adminDb.reminder.findMany({
      where: { id: { in: made.map((r) => r.id) } },
    });
    expect(updated.every((r) => r.status === "QUEUED" || r.status === "SENT")).toBe(true);
    const messages = await adminDb.message.findMany({
      where: { id: { in: updated.map((r) => r.messageId!) } },
    });
    expect(messages.map((m) => m.channel).sort()).toEqual(["EMAIL", "SMS"]);
    expect(messages.find((m) => m.channel === "EMAIL")!.to).toBe("kone@example.com");
  });

  it("une fois le message parti, la relance passe « envoyée » (date et canal réels)", async () => {
    const manual = await adminDb.reminder.findMany({
      where: { organizationId: orgId, stepKey: "MANUAL", messageId: { not: null } },
    });
    expect(manual.length).toBe(2);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T10:00:00.000Z")); // dans la fenêtre d'envoi
    try {
      for (const reminder of manual.filter((r) => r.status === "QUEUED")) {
        await processMessagesSendJob({
          data: { messageId: reminder.messageId! },
          moveToDelayed: vi.fn(),
        } as unknown as Job<MessagesSendJobData>);
      }
    } finally {
      vi.useRealTimers();
    }
    const after = await adminDb.reminder.findMany({
      where: { id: { in: manual.map((r) => r.id) } },
    });
    expect(after.every((r) => r.status === "SENT" && r.sentAt !== null)).toBe(true);
    expect(after.map((r) => r.channel).sort()).toEqual(["EMAIL", "SMS"]);
  });

  it("« Renvoyer par… » : après un échec, un nouveau message part ; canal impossible → bloquée avec raison", async () => {
    await adminDb.reminder.deleteMany({ where: { organizationId: orgId } });
    await adminDb.message.deleteMany({ where: { organizationId: orgId } });
    const reminder = await adminDb.reminder.create({
      data: {
        organizationId: orgId,
        ruleId,
        type: "RECEIVABLE",
        stepKey: "J+3",
        customerId: debtorId,
        dueDate: new Date(),
        scheduledFor: new Date(Date.now() - 1000),
        status: "PLANNED",
        channel: "SMS",
        channelLocked: true,
        approvedAt: new Date(),
        dedupeKey: `RECEIVABLE:${debtorId}:via:J+3`,
        sequenceKey: `RECEIVABLE:${debtorId}:via`,
      },
    });
    await processRemindersDispatchJob();
    const first = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(first.channel).toBe("SMS");
    const firstMessageId = first.messageId!;

    // Le message échoue ; l'utilisateur renvoie par le même canal : nouveau message.
    await adminDb.message.update({ where: { id: firstMessageId }, data: { status: "FAILED" } });
    await adminDb.reminder.update({
      where: { id: reminder.id },
      data: { status: "PLANNED", scheduledFor: new Date(Date.now() - 1000) },
    });
    await processRemindersDispatchJob();
    const second = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(second.messageId).not.toBe(firstMessageId);
    const message = await adminDb.message.findUniqueOrThrow({ where: { id: second.messageId! } });
    expect(message.idempotencyKey).toMatch(/:retry1$/);
    expect(message.channel).toBe("SMS");

    // Canal imposé impossible (WhatsApp sans configuration active ici) : pas de repli sur SMS.
    await adminDb.channelConfig.updateMany({
      where: { organizationId: orgId, channel: "WHATSAPP" },
      data: { isActive: false },
    });
    const locked = await adminDb.reminder.create({
      data: {
        organizationId: orgId,
        ruleId,
        type: "RECEIVABLE",
        stepKey: "J+15",
        customerId: debtorId,
        dueDate: new Date(),
        scheduledFor: new Date(Date.now() - 1000),
        status: "PLANNED",
        channel: "WHATSAPP",
        channelLocked: true,
        approvedAt: new Date(),
        dedupeKey: `RECEIVABLE:${debtorId}:via:J+15`,
        sequenceKey: `RECEIVABLE:${debtorId}:via`,
      },
    });
    await processRemindersDispatchJob();
    const blocked = await adminDb.reminder.findUniqueOrThrow({ where: { id: locked.id } });
    expect(blocked).toMatchObject({ status: "NEEDS_APPROVAL", channel: null, messageId: null });
    expect(blocked.skippedReason).toMatch(/impossible d'envoyer par WhatsApp/);
    await adminDb.channelConfig.updateMany({
      where: { organizationId: orgId, channel: "WHATSAPP" },
      data: { isActive: true },
    });
  });

  it("est annulée si le client a tout réglé entre-temps", async () => {
    const reminder = await manual(paidId);
    await processRemindersDispatchJob();
    const updated = await adminDb.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(updated.status).toBe("CANCELLED");
    expect(updated.messageId).toBeNull();
  });
});
