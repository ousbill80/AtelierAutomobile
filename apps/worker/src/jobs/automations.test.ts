import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchAutomationsForOrganization, processAutomationsDispatchJob } from "./automations";
import { getMessagesQueue } from "../queues/messages";

// M17 RG-M17-23/24 — moteur d'automatisations : idempotence (ruleId, eventId), isolation
// multi-locataire, activation, délai, conditions, OptOut revérifié, PROPOSE, anti-boucle.

const suffix = randomBytes(3).toString("hex");
const minutes = (n: number) => n * 60_000;

describe("automations.dispatch (M17)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let customerA: { id: string };
  let customerB: { id: string };
  let accountant: { id: string };
  const userIds: string[] = [];
  const t0 = new Date(Date.now() - minutes(10));

  async function event(
    organizationId: string,
    type: string,
    payload: object,
    occurredAt = new Date(),
  ) {
    return adminDb.domainEvent.create({
      data: { organizationId, type, payload, occurredAt, processedAt: new Date() },
    });
  }

  async function rule(data: Record<string, unknown>) {
    return adminDb.automationRule.create({
      data: {
        organizationId: orgA.id,
        name: "Règle test",
        trigger: "payment.received",
        conditions: [],
        actions: [],
        mode: "AUTO",
        siteIds: [],
        isActive: true,
        activatedAt: t0,
        ...data,
      } as never,
    });
  }

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: `Auto A ${suffix}` } });
    orgB = await adminDb.organization.create({ data: { name: `Auto B ${suffix}` } });
    customerA = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "Koné Ibrahim",
        type: "INDIVIDUAL",
        phone: `+22507${randomBytes(4).readUInt32BE(0).toString().padStart(8, "0").slice(0, 8)}`,
      },
    });
    customerB = await adminDb.customer.create({
      data: {
        organizationId: orgB.id,
        displayName: "Client B",
        type: "COMPANY",
        phone: "+2250701010101",
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
        key: "auto_recu_paiement",
        name: "Reçu",
        channel: "WHATSAPP",
        body: "Bonjour {{client.salutation}}, paiement reçu. {{garage.nom}}",
        isActive: true,
      },
    });
    const user = await adminDb.user.create({
      data: { name: "Comptable", email: `auto-${suffix}@example.com` },
    });
    userIds.push(user.id);
    accountant = await adminDb.membership.create({
      data: { organizationId: orgA.id, userId: user.id, role: "ACCOUNTANT", siteIds: [] },
    });
  });

  afterAll(async () => {
    const orgs = { in: [orgA.id, orgB.id] };
    await adminDb.aiSuggestion.deleteMany({ where: { organizationId: orgs } });
    await adminDb.automationRun.deleteMany({ where: { organizationId: orgs } });
    await adminDb.automationRule.deleteMany({ where: { organizationId: orgs } });
    await adminDb.domainEvent.deleteMany({ where: { organizationId: orgs } });
    await adminDb.message.deleteMany({ where: { organizationId: orgs } });
    await adminDb.optOut.deleteMany({ where: { organizationId: orgs } });
    await adminDb.messageTemplate.deleteMany({ where: { organizationId: orgs } });
    await adminDb.channelConfig.deleteMany({ where: { organizationId: orgs } });
    await adminDb.customer.deleteMany({ where: { organizationId: orgs } });
    await adminDb.notification.deleteMany({ where: { organizationId: orgs } });
    await adminDb.membership.deleteMany({ where: { organizationId: orgs } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: orgs } });
    await getMessagesQueue().close();
  });

  it("AUTO : envoie le modèle une seule fois (idempotence), journalise et émet automation.executed", async () => {
    const r = await rule({
      actions: [{ type: "send_template", templateKey: "auto_recu_paiement", channel: "WHATSAPP" }],
    });
    const ev = await event(orgA.id, "payment.received", {
      customerId: customerA.id,
      amount: 50000,
    });
    // Événement d'une autre organisation : jamais pris par la règle de A.
    await event(orgB.id, "payment.received", { customerId: customerB.id, amount: 1 });
    // Événement antérieur à l'activation : ignoré.
    await event(
      orgA.id,
      "payment.received",
      { customerId: customerA.id },
      new Date(t0.getTime() - minutes(5)),
    );

    await processAutomationsDispatchJob();
    await processAutomationsDispatchJob();

    const runs = await adminDb.automationRun.findMany({ where: { ruleId: r.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ eventId: ev.id, status: "SUCCEEDED", organizationId: orgA.id });
    const messages = await adminDb.message.findMany({
      where: { organizationId: orgA.id, templateKey: "auto_recu_paiement" },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: "TRANSACTIONAL",
      status: "QUEUED",
      to: expect.stringMatching(/^\+225/),
      idempotencyKey: `auto:${customerA.id}:auto_recu_paiement:${ev.id}`,
    });
    expect(messages[0]!.body).toContain("Koné Ibrahim");
    expect(await adminDb.automationRun.count({ where: { organizationId: orgB.id } })).toBe(0);
    const executed = await adminDb.domainEvent.findMany({
      where: { organizationId: orgA.id, type: "automation.executed" },
    });
    expect(executed).toHaveLength(1);
    expect(executed[0]!.payload).toMatchObject({
      ruleId: r.id,
      automation: { ruleId: r.id, depth: 1 },
    });
    await adminDb.automationRule.update({ where: { id: r.id }, data: { isActive: false } });
  });

  it("deux règles sur le même événement : un seul message (dédoublonnage M11)", async () => {
    const action = {
      type: "send_template",
      templateKey: "auto_recu_paiement",
      channel: "WHATSAPP",
    };
    const r1 = await rule({ trigger: "invoice.issued", actions: [action] });
    const r2 = await rule({ trigger: "invoice.issued", actions: [action] });
    const ev = await event(orgA.id, "invoice.issued", { customerId: customerA.id });
    await dispatchAutomationsForOrganization(orgA.id, new Date());
    expect(
      await adminDb.message.count({
        where: { organizationId: orgA.id, idempotencyKey: { endsWith: ev.id } },
      }),
    ).toBe(1);
    for (const r of [r1, r2]) {
      await adminDb.automationRule.update({ where: { id: r.id }, data: { isActive: false } });
    }
  });

  it("OptOut revérifié juste avant l'envoi → SKIPPED avec motif (message non transactionnel)", async () => {
    const r = await rule({
      trigger: "appointment.no_show",
      actions: [{ type: "send_template", templateKey: "auto_recu_paiement", channel: "WHATSAPP" }],
    });
    const customer = await adminDb.customer.findUniqueOrThrow({ where: { id: customerA.id } });
    await adminDb.optOut.create({
      data: {
        organizationId: orgA.id,
        address: customer.phone!,
        channel: null,
        source: "STOP",
      } as never,
    });
    await event(orgA.id, "appointment.no_show", { customerId: customerA.id });
    await dispatchAutomationsForOrganization(orgA.id, new Date());
    const run = await adminDb.automationRun.findFirstOrThrow({ where: { ruleId: r.id } });
    expect(run.status).toBe("SKIPPED");
    expect(run.error).toContain("désinscrit");
    await adminDb.optOut.deleteMany({ where: { organizationId: orgA.id } });
    await adminDb.automationRule.update({ where: { id: r.id }, data: { isActive: false } });
  });

  it("conditions non remplies → SKIPPED ; délai → exécution différée", async () => {
    const tagged = await rule({
      trigger: "customer.created",
      conditions: [{ field: "customer.type", op: "eq", value: "COMPANY" }],
      actions: [
        { type: "add_customer_tag", tag: "flotte" },
        {
          type: "notify_members",
          roles: ["ACCOUNTANT"],
          title: "Nouveau client {{client.nomComplet}}",
        },
      ],
    });
    await event(orgA.id, "customer.created", { customerId: customerA.id });
    await dispatchAutomationsForOrganization(orgA.id, new Date());
    const skipped = await adminDb.automationRun.findFirstOrThrow({ where: { ruleId: tagged.id } });
    expect(skipped).toMatchObject({ status: "SKIPPED", error: "Conditions non remplies." });

    await adminDb.customer.update({ where: { id: customerA.id }, data: { type: "COMPANY" } });
    const delayed = await rule({
      trigger: "quote.viewed",
      delayMinutes: 30,
      actions: [{ type: "add_customer_tag", tag: "flotte" }],
    });
    await event(orgA.id, "quote.viewed", { customerId: customerA.id });
    const now = new Date();
    await dispatchAutomationsForOrganization(orgA.id, now);
    let run = await adminDb.automationRun.findFirstOrThrow({ where: { ruleId: delayed.id } });
    expect(run.status).toBe("PENDING");
    expect(run.scheduledFor.getTime()).toBeGreaterThanOrEqual(now.getTime() + minutes(29));
    await dispatchAutomationsForOrganization(orgA.id, new Date(now.getTime() + minutes(31)));
    run = await adminDb.automationRun.findFirstOrThrow({ where: { ruleId: delayed.id } });
    expect(run.status).toBe("SUCCEEDED");
    const customer = await adminDb.customer.findUniqueOrThrow({ where: { id: customerA.id } });
    expect(customer.tags).toEqual(["flotte"]);

    // La règle « entreprise » s'exécute sur un nouvel événement : tag non dupliqué, notification.
    await event(orgA.id, "customer.created", { customerId: customerA.id });
    await dispatchAutomationsForOrganization(orgA.id, new Date());
    const ok = await adminDb.automationRun.findFirstOrThrow({
      where: { ruleId: tagged.id, status: "SUCCEEDED" },
    });
    expect(ok).toBeTruthy();
    expect(
      (await adminDb.customer.findUniqueOrThrow({ where: { id: customerA.id } })).tags,
    ).toEqual(["flotte"]);
    const notifications = await adminDb.notification.findMany({
      where: { membershipId: accountant.id, type: "automation.notification" },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.title).toBe("Nouveau client Koné Ibrahim");
    for (const r of [tagged, delayed]) {
      await adminDb.automationRule.update({ where: { id: r.id }, data: { isActive: false } });
    }
  });

  it("PROPOSE : suggestion à valider, rien n'est exécuté avant l'approbation", async () => {
    const r = await rule({
      trigger: "repair_order.ready",
      mode: "PROPOSE",
      actions: [{ type: "add_customer_tag", tag: "propose" }],
    });
    await event(orgA.id, "repair_order.ready", { customerId: customerA.id });
    await dispatchAutomationsForOrganization(orgA.id, new Date());
    let run = await adminDb.automationRun.findFirstOrThrow({ where: { ruleId: r.id } });
    expect(run.status).toBe("PENDING");
    const suggestion = await adminDb.aiSuggestion.findFirstOrThrow({
      where: { organizationId: orgA.id, targetEntity: "automation_run", targetId: run.id },
    });
    expect(suggestion).toMatchObject({ feature: "automation", status: "PENDING" });
    await dispatchAutomationsForOrganization(orgA.id, new Date());
    expect(await adminDb.aiSuggestion.count({ where: { targetId: run.id } })).toBe(1);
    expect(
      (await adminDb.customer.findUniqueOrThrow({ where: { id: customerA.id } })).tags,
    ).not.toContain("propose");

    await adminDb.automationRun.update({
      where: { id: run.id },
      data: { result: { suggestionId: suggestion.id, approvedAt: new Date().toISOString() } },
    });
    await dispatchAutomationsForOrganization(orgA.id, new Date());
    run = await adminDb.automationRun.findFirstOrThrow({ where: { ruleId: r.id } });
    expect(run.status).toBe("SUCCEEDED");
    expect(
      (await adminDb.customer.findUniqueOrThrow({ where: { id: customerA.id } })).tags,
    ).toContain("propose");
    await adminDb.automationRule.update({ where: { id: r.id }, data: { isActive: false } });
  });

  it("anti-boucle : une règle ne se déclenche pas sur un événement qu'elle a produit", async () => {
    const r = await rule({
      trigger: "payment.refunded",
      actions: [{ type: "add_customer_tag", tag: "boucle" }],
    });
    await event(orgA.id, "payment.refunded", {
      customerId: customerA.id,
      automation: { ruleId: r.id, depth: 1 },
    });
    await event(orgA.id, "payment.refunded", {
      customerId: customerA.id,
      automation: { ruleId: "autre", depth: 3 },
    });
    await dispatchAutomationsForOrganization(orgA.id, new Date());
    const runs = await adminDb.automationRun.findMany({ where: { ruleId: r.id } });
    expect(runs).toHaveLength(2);
    expect(runs.every((x) => x.status === "SKIPPED")).toBe(true);
    expect(runs.map((x) => x.error).join(" ")).toContain("anti-boucle");
  });
});
