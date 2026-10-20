import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { createConsoleAiProvider, type AiProvider } from "@atelieros/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setAiProviderForTests } from "../ai/service";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// M17 US-M17-10 / RG-M17-20 — assistant lecture seule, fournisseur `console` (aucun réseau).

const callerFactory = createCallerFactory(appRouter);
const orgIds: string[] = [];
const userIds: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

async function callerFor(
  organizationId: string,
  role: "OWNER" | "ADVISOR" | "MANAGER",
  siteIds: string[] = [],
) {
  const user = await adminDb.user.create({
    data: { name: `Assistant ${role}`, email: `${randomBytes(5).toString("hex")}@example.com` },
  });
  userIds.push(user.id);
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds },
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
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  return { caller: callerFactory(ctx), membership };
}

async function createOrg(name: string) {
  const org = await adminDb.organization.create({
    data: { name, plan: "PRO", onboardingCompletedAt: new Date() },
  });
  orgIds.push(org.id);
  return org;
}

describe("ai.assistant (M17 — assistant lecture seule)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let siteA1: { id: string };
  let siteA2: { id: string };
  let owner: Awaited<ReturnType<typeof callerFor>>;
  let advisor: Awaited<ReturnType<typeof callerFor>>;
  let managerSite2: Awaited<ReturnType<typeof callerFor>>;
  let ownerB: Awaited<ReturnType<typeof callerFor>>;

  beforeAll(async () => {
    orgA = await createOrg("Garage Assistant A");
    orgB = await createOrg("Garage Assistant B");
    siteA1 = await adminDb.site.create({
      data: {
        organizationId: orgA.id,
        name: "Yopougon",
        code: `Y${randomBytes(2).toString("hex")}`,
      },
    });
    siteA2 = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Cocody", code: `C${randomBytes(2).toString("hex")}` },
    });
    const siteB = await adminDb.site.create({
      data: {
        organizationId: orgB.id,
        name: "Marcory",
        code: `M${randomBytes(2).toString("hex")}`,
      },
    });
    owner = await callerFor(orgA.id, "OWNER");
    advisor = await callerFor(orgA.id, "ADVISOR");
    managerSite2 = await callerFor(orgA.id, "MANAGER", [siteA2.id]);
    ownerB = await callerFor(orgB.id, "OWNER");

    const sotra = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "SOTRA Logistique SARL", type: "COMPANY" },
    });
    const now = Date.now();
    await adminDb.invoice.createMany({
      data: [
        {
          organizationId: orgA.id,
          siteId: siteA1.id,
          customerId: sotra.id,
          number: "FAC-2026-000287",
          status: "OVERDUE",
          issuedAt: new Date(now - 60 * DAY),
          dueDate: new Date(now - 38 * DAY),
          total: 610_000,
          balance: 610_000,
        },
        {
          organizationId: orgA.id,
          siteId: siteA2.id,
          customerId: sotra.id,
          number: "FAC-2026-000301",
          status: "ISSUED",
          issuedAt: new Date(now - 5 * DAY),
          dueDate: new Date(now + 10 * DAY),
          total: 630_000,
          balance: 630_000,
        },
      ],
    });
    // Même nom de client dans une autre organisation : jamais visible depuis A (RG-M17-03).
    const sotraB = await adminDb.customer.create({
      data: { organizationId: orgB.id, displayName: "Koné Ibrahim", type: "INDIVIDUAL" },
    });
    await adminDb.invoice.create({
      data: {
        organizationId: orgB.id,
        siteId: siteB.id,
        customerId: sotraB.id,
        number: "FAC-B-1",
        status: "ISSUED",
        issuedAt: new Date(now - 2 * DAY),
        dueDate: new Date(now + 5 * DAY),
        total: 99_000,
        balance: 99_000,
      },
    });
  });

  beforeEach(() => setAiProviderForTests(createConsoleAiProvider()));

  afterAll(async () => {
    setAiProviderForTests();
    const where = { organizationId: { in: orgIds } };
    await adminDb.aiAssistantMessage.deleteMany({ where });
    await adminDb.aiAssistantThread.deleteMany({ where });
    await adminDb.aiInteraction.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.notification.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("« combien me doit SOTRA ? » : solde de l'organisation courante, liens, AiInteraction", async () => {
    const answer = await owner.caller.ai.assistant.ask({ question: "combien me doit SOTRA ?" });
    expect(answer.text).toBe(
      "SOTRA Logistique SARL vous doit 1 240 000 FCFA sur 2 facture(s) ; la plus ancienne (FAC-2026-000287, 610 000 FCFA) a 38 jour(s) de retard.",
    );
    expect(answer.toolCalls).toEqual(["search_customers", "get_customer_balance"]);
    expect(answer.links.map((l) => l.href)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/clients\//),
        expect.stringMatching(/^\/factures\//),
      ]),
    );
    expect(answer.verifiedFallback).toBe(false);
    const interaction = await adminDb.aiInteraction.findFirstOrThrow({
      where: { organizationId: orgA.id, feature: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    expect(interaction).toMatchObject({
      status: "OK",
      promptVersion: "v2",
      inputRef: `assistant_thread:${answer.threadId}`,
      createdById: owner.membership.id,
    });
    expect(interaction.credits).toBeGreaterThanOrEqual(1);
  });

  it("isolation : un client d'une autre organisation est introuvable", async () => {
    const answer = await owner.caller.ai.assistant.ask({
      question: "combien me doit Koné Ibrahim ?",
    });
    expect(answer.text).toBe("Je ne trouve pas ce client.");
    const fromB = await ownerB.caller.ai.assistant.ask({ question: "combien me doit SOTRA ?" });
    expect(fromB.text).toBe("Je ne trouve pas ce client.");
  });

  it("filtre de sites : un gérant limité à Cocody ne voit que les factures de son site", async () => {
    const answer = await managerSite2.caller.ai.assistant.ask({
      question: "combien me doit SOTRA ?",
    });
    expect(answer.text).toContain("630 000 FCFA sur 1 facture(s)");
    expect(answer.text).not.toContain("610 000");
  });

  it("ADVISOR sans report:financial : « Vous n'avez pas accès à cette information. »", async () => {
    const answer = await advisor.caller.ai.assistant.ask({ question: "quel est mon CA ce mois ?" });
    expect(answer.text).toBe("Vous n'avez pas accès à cette information.");
    const ownerAnswer = await owner.caller.ai.assistant.ask({
      question: "quel est mon CA ce mois ?",
    });
    expect(ownerAnswer.text).toMatch(
      // « CA » = HT (M12 RG-M12-05), mêmes chiffres que `dashboard.kpi`.
      /^Chiffre d'affaires HT facturé \(mois en cours\) : [\d  ]+ FCFA\.$/,
    );
  });

  it("RG-M17-20 : un chiffre absent des résultats d'outils fait remplacer la réponse", async () => {
    const inventing: AiProvider = {
      ...createConsoleAiProvider(),
      async complete(request) {
        const base = await createConsoleAiProvider().complete({
          ...request,
          consoleReply: (r) => {
            const reply = request.consoleReply!(r);
            return reply.toolCalls ? reply : { text: "SOTRA vous doit 9 999 999 FCFA." };
          },
        });
        return base;
      },
    };
    setAiProviderForTests(inventing);
    const answer = await owner.caller.ai.assistant.ask({ question: "combien me doit SOTRA ?" });
    expect(answer.verifiedFallback).toBe(true);
    expect(answer.text).not.toContain("9 999 999");
    expect(answer.text).toContain("1 240 000 FCFA");
  });

  it("une demande d'action propose un bouton sans rien exécuter", async () => {
    const answer = await owner.caller.ai.assistant.ask({ question: "relance SOTRA" });
    expect(answer.actions).toHaveLength(1);
    expect(answer.actions[0]!.href).toMatch(/^\/clients\//);
    expect(answer.text).toContain("Je ne peux rien modifier");
  });

  it("IA indisponible : message de repli et liens vers les rapports", async () => {
    setAiProviderForTests(createConsoleAiProvider({ fail: "ERROR" }));
    const answer = await owner.caller.ai.assistant.ask({ question: "combien me doit SOTRA ?" });
    expect(answer.unavailable).toBe(true);
    expect(answer.links.map((l) => l.href)).toContain("/creances");
  });

  it("historique : fils et messages du seul auteur, suppression", async () => {
    const first = await owner.caller.ai.assistant.ask({ question: "Qui me doit le plus ?" });
    expect(first.text).toContain("SOTRA Logistique SARL : 1 240 000 FCFA");
    await owner.caller.ai.assistant.ask({
      threadId: first.threadId,
      question: "écris-moi un poème",
    });
    const thread = await owner.caller.ai.assistant.thread({ threadId: first.threadId });
    expect(thread.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(thread.messages[3]!.text).toContain("gestion du garage");
    const threads = await owner.caller.ai.assistant.threads();
    expect(threads.map((t) => t.id)).toContain(first.threadId);

    await expect(
      advisor.caller.ai.assistant.thread({ threadId: first.threadId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      advisor.caller.ai.assistant.ask({ threadId: first.threadId, question: "et SOTRA ?" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      ownerB.caller.ai.assistant.deleteThread({ threadId: first.threadId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await owner.caller.ai.assistant.deleteThread({ threadId: first.threadId });
    expect(
      await adminDb.aiAssistantThread.findUnique({ where: { id: first.threadId } }),
    ).toBeNull();
  });
});
