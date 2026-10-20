import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// M17 §8 / §12 — routeur `automations` : modèles fournis, règles, test à blanc, permissions,
// isolation multi-locataire, acceptation d'une proposition (mode PROPOSE).

const callerFactory = createCallerFactory(appRouter);

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

describe("automations router (M17)", () => {
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let orgA: { id: string };
  let tokens: { ownerA: string; advisorA: string; ownerB: string };
  let customerA: { id: string };

  async function member(organizationId: string, role: "OWNER" | "ADVISOR") {
    const user = await adminDb.user.create({
      data: { name: role, email: `auto-${randomBytes(4).toString("hex")}@example.com` },
    });
    userIds.push(user.id);
    await adminDb.membership.create({
      data: { organizationId, userId: user.id, role, siteIds: [] },
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
    return token;
  }

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Automatisations A" } });
    const orgB = await adminDb.organization.create({ data: { name: "Garage Automatisations B" } });
    orgIds.push(orgA.id, orgB.id);
    tokens = {
      ownerA: await member(orgA.id, "OWNER"),
      advisorA: await member(orgA.id, "ADVISOR"),
      ownerB: await member(orgB.id, "OWNER"),
    };
    customerA = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "SOTRA Logistique SARL",
        type: "COMPANY",
        phone: "+2250707070707",
      },
    });
  });

  afterAll(async () => {
    const orgs = { in: orgIds };
    await adminDb.aiSuggestion.deleteMany({ where: { organizationId: orgs } });
    await adminDb.automationRun.deleteMany({ where: { organizationId: orgs } });
    await adminDb.automationRule.deleteMany({ where: { organizationId: orgs } });
    await adminDb.domainEvent.deleteMany({ where: { organizationId: orgs } });
    await adminDb.messageTemplate.deleteMany({ where: { organizationId: orgs } });
    await adminDb.customer.deleteMany({ where: { organizationId: orgs } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: orgs } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.notification.deleteMany({ where: { organizationId: orgs } });
    await adminDb.membership.deleteMany({ where: { organizationId: orgs } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: orgs } });
  });

  it("liste les 6 modèles fournis, désactivés par défaut", async () => {
    const caller = callerFactory(await contextFor(tokens.ownerA));
    const templates = await caller.automations.templates();
    expect(templates).toHaveLength(6);
    expect(templates.every((t) => !t.isActive)).toBe(true);
    expect(templates.find((t) => t.key === "low_review_task")?.available).toBe(false);
  });

  it("active « OR prêt » en un clic : règle active + modèle de message créé ; audit", async () => {
    const caller = callerFactory(await contextFor(tokens.ownerA));
    const { rule } = await caller.automations.activateTemplate({ key: "ro_ready_message" });
    expect(rule).toMatchObject({
      isActive: true,
      trigger: "repair_order.status_changed",
      mode: "AUTO",
    });
    expect(rule.activatedAt).toBeInstanceOf(Date);
    const template = await adminDb.messageTemplate.findFirst({
      where: { organizationId: orgA.id, key: "pret_j0", channel: "WHATSAPP" },
    });
    expect(template?.body).toContain("{{lien.paiement}}");
    const again = await caller.automations.activateTemplate({ key: "ro_ready_message" });
    expect(again.rule.id).toBe(rule.id);
    expect(
      await adminDb.auditLog.count({
        where: { organizationId: orgA.id, action: "automation.activated" },
      }),
    ).toBe(2);
    const list = await caller.automations.list();
    expect(list.map((r) => r.id)).toEqual([rule.id]);
    await expect(caller.automations.activateTemplate({ key: "low_review_task" })).rejects.toThrow(
      /pas encore disponible/,
    );
  });

  it("crée une règle, avertit d'un doublon d'envoi, teste à blanc sans rien envoyer", async () => {
    const caller = callerFactory(await contextFor(tokens.ownerA));
    const first = await caller.automations.create({
      name: "Reçu",
      trigger: "payment.received",
      actions: [{ type: "send_template", templateKey: "pret_j0", channel: "WHATSAPP" }],
      mode: "AUTO",
    });
    expect(first.rule.isActive).toBe(false);
    await caller.automations.toggle({ id: first.rule.id, isActive: true });
    const second = await caller.automations.create({
      name: "Reçu bis",
      trigger: "payment.received",
      actions: [{ type: "send_template", templateKey: "pret_j0", channel: "WHATSAPP" }],
    });
    expect(second.warnings).toEqual(["Reçu"]);
    expect(second.rule.mode).toBe("PROPOSE");

    const company = await caller.automations.create({
      name: "Entreprise",
      trigger: "customer.created",
      conditions: [{ field: "customer.type", op: "eq", value: "COMPANY" }],
      actions: [
        { type: "add_customer_tag", tag: "flotte" },
        { type: "notify_members", roles: ["ACCOUNTANT"], title: "Nouveau : {{client.nomComplet}}" },
      ],
    });
    const result = await caller.automations.test({
      ruleId: company.rule.id,
      sampleEntity: { type: "customer", id: customerA.id },
    });
    expect(result.matched).toBe(true);
    expect(result.actions).toEqual([
      { type: "add_customer_tag", preview: "Tag « flotte »" },
      { type: "notify_members", preview: "ACCOUNTANT : Nouveau : SOTRA Logistique SARL" },
    ]);
    const unchanged = await adminDb.customer.findUniqueOrThrow({ where: { id: customerA.id } });
    expect(unchanged.tags).toEqual([]);

    const send = await caller.automations.test({
      ruleId: first.rule.id,
      sampleEntity: { type: "customer", id: customerA.id },
    });
    expect(send.actions[0]!.preview).toContain("WHATSAPP → +2250707070707");
    expect(await adminDb.message.count({ where: { organizationId: orgA.id } })).toBe(0);

    await caller.automations.update({
      id: company.rule.id,
      name: "Entreprise (modifiée)",
      trigger: "customer.created",
      conditions: [{ field: "customer.type", op: "eq", value: "INDIVIDUAL" }],
      actions: [{ type: "add_customer_tag", tag: "flotte" }],
    });
    const after = await caller.automations.test({
      ruleId: company.rule.id,
      sampleEntity: { type: "customer", id: customerA.id },
    });
    expect(after.matched).toBe(false);
    await caller.automations.delete({ id: second.rule.id });
    await expect(caller.automations.get({ id: second.rule.id })).rejects.toThrow(/introuvable/);
  });

  it("refuse un ADVISOR (ai:configure requis) et isole les organisations", async () => {
    const advisor = callerFactory(await contextFor(tokens.advisorA));
    await expect(advisor.automations.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ownerB = callerFactory(await contextFor(tokens.ownerB));
    expect(await ownerB.automations.list()).toEqual([]);
    const ruleA = await adminDb.automationRule.findFirstOrThrow({
      where: { organizationId: orgA.id },
    });
    await expect(ownerB.automations.get({ id: ruleA.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      ownerB.automations.toggle({ id: ruleA.id, isActive: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      ownerB.automations.test({
        ruleId: ruleA.id,
        sampleEntity: { type: "customer", id: customerA.id },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await ownerB.automations.runs()).items).toEqual([]);
  });

  it("PROPOSE : accepter la proposition approuve le run (exécuté ensuite par le worker)", async () => {
    const caller = callerFactory(await contextFor(tokens.ownerA));
    const rule = await adminDb.automationRule.create({
      data: {
        organizationId: orgA.id,
        name: "RDV manqué",
        trigger: "appointment.no_show",
        actions: [],
        mode: "PROPOSE",
        siteIds: [],
        isActive: true,
        activatedAt: new Date(),
      },
    });
    const run = await adminDb.automationRun.create({
      data: { organizationId: orgA.id, ruleId: rule.id, eventId: "ev_test", status: "PENDING" },
    });
    const suggestion = await adminDb.aiSuggestion.create({
      data: {
        organizationId: orgA.id,
        feature: "automation",
        targetEntity: "automation_run",
        targetId: run.id,
        payload: { ruleId: rule.id, runId: run.id, actions: [] },
        isFallback: true,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await adminDb.automationRun.update({
      where: { id: run.id },
      data: { result: { awaitingApproval: true, suggestionId: suggestion.id } },
    });
    const pending = await caller.automations.pendingApprovals();
    expect(pending.map((p) => p.id)).toEqual([suggestion.id]);
    const runs = await caller.automations.runs({ ruleId: rule.id });
    expect(runs.items[0]).toMatchObject({ id: run.id, awaitingApproval: true });

    await caller.ai.suggestion.accept({ suggestionId: suggestion.id });
    const approved = await adminDb.automationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(approved.result).toMatchObject({
      suggestionId: suggestion.id,
      approvedAt: expect.any(String),
    });
    const decided = await adminDb.aiSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(decided.status).toBe("ACCEPTED");
  });
});
