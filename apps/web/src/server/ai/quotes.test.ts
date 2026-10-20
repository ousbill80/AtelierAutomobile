import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import {
  createConsoleAiProvider,
  type AiCompletionRequest,
  type AiProvider,
} from "@atelieros/integrations";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createContext } from "../context";
import { setRepairOrdersClock } from "../repairOrders/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "../routers/_app";
import { setAiProviderForTests } from "./service";

// M17 US-M17-03/04 — pré-devis et explication client, fournisseur IA `console`.
vi.mock("../messaging/queue", () => ({ enqueueMessageSendJob: vi.fn(async () => undefined) }));

const callerFactory = createCallerFactory(appRouter);
type Caller = ReturnType<typeof callerFactory>;
type Role = "OWNER" | "MANAGER" | "ADVISOR" | "MECHANIC";

async function member(organizationId: string, role: Role, users: string[]) {
  const user = await adminDb.user.create({
    data: { name: `${role} test`, email: `${randomBytes(5).toString("hex")}@example.com` },
  });
  users.push(user.id);
  const membership = await adminDb.membership.create({
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
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}`, "user-agent": "vitest" },
  });
  const ctx = await createContext({ req, resHeaders: new Headers(), info: undefined as never });
  return { membershipId: membership.id, caller: callerFactory(ctx) };
}

/** Fournisseur qui renvoie une sortie fixe et garde la trace des prompts envoyés. */
function scriptedProvider(output: unknown, seen: AiCompletionRequest[]): AiProvider {
  return {
    name: "scripted",
    model: "scripted",
    fastModel: "scripted",
    async complete(request) {
      seen.push(request);
      return {
        text: JSON.stringify(output),
        toolCalls: [],
        stopReason: "end_turn",
        tokensIn: 900,
        tokensOut: 200,
        model: "scripted",
      };
    },
  };
}

const NOW = new Date("2026-10-19T09:00:00.000Z");

describe("M17 — pré-devis et explication (ai.draftQuote / ai.explainQuote)", () => {
  const users: string[] = [];
  let orgA: { id: string };
  let orgB: { id: string };
  let advisor: Caller;
  let mechanic: Caller;
  let ownerB: Caller;
  let order: { id: string };
  let orderB: { id: string };
  let productB: { id: string };
  let padsLabor: { id: string };
  let pads: { id: string };

  beforeAll(async () => {
    setRepairOrdersClock(fixedClock(NOW));
    orgA = await adminDb.organization.create({
      data: { name: "Garage IA Devis A", plan: "PRO", onboardingCompletedAt: NOW },
    });
    orgB = await adminDb.organization.create({
      data: { name: "Garage IA Devis B", plan: "PRO", onboardingCompletedAt: NOW },
    });
    const siteA = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" },
    });
    const siteB = await adminDb.site.create({
      data: { organizationId: orgB.id, name: "Cocody", code: "COC" },
    });
    advisor = (await member(orgA.id, "ADVISOR", users)).caller;
    mechanic = (await member(orgA.id, "MECHANIC", users)).caller;
    ownerB = (await member(orgB.id, "OWNER", users)).caller;
    await adminDb.channelConfig.create({
      data: {
        organizationId: orgA.id,
        channel: "SMS",
        provider: "console",
        isActive: true,
        credentials: "{}",
      },
    });
    const customer = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Kouassi Jean-Marc", phone: "+2250707070707" },
    });
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: customer.id,
        plate: "2547 GH 01",
        plateCompact: "2547GH01",
        make: "Toyota",
        model: "Corolla",
        year: 2018,
      },
    });
    padsLabor = await adminDb.laborOperation.create({
      data: {
        organizationId: orgA.id,
        code: "PLQ-AV",
        name: "Remplacement plaquettes AV",
        category: "Freinage",
        standardHours: 0.8,
      },
    });
    await adminDb.laborOperation.create({
      data: { organizationId: orgA.id, code: "VID", name: "Vidange + filtre", standardHours: 0.5 },
    });
    pads = await adminDb.product.create({
      data: {
        organizationId: orgA.id,
        sku: "PLQ-COR",
        name: "Plaquettes AV Corolla 2014-2019",
        category: "Freinage",
        salePrice: 28_000,
        compatibleWith: ["TOYOTA|COROLLA|2014-2019"],
      },
    });
    await adminDb.product.create({
      data: {
        organizationId: orgA.id,
        sku: "HUI",
        name: "Huile 5W30",
        category: "Lubrifiants",
        salePrice: 6_000,
      },
    });
    await adminDb.product.create({
      data: {
        organizationId: orgA.id,
        sku: "PLQ-KIA",
        name: "Plaquettes AV Kia Picanto",
        category: "Freinage",
        salePrice: 20_000,
        compatibleWith: ["KIA|PICANTO|*"],
      },
    });
    order = await adminDb.repairOrder.create({
      data: {
        organizationId: orgA.id,
        siteId: siteA.id,
        number: "OR-YOP-2026-00042",
        customerId: customer.id,
        vehicleId: vehicle.id,
        status: "DIAGNOSING",
        complaint: "Bruit au freinage, rappeler au 0707070707",
      },
    });
    const inspection = await adminDb.inspection.create({
      data: { organizationId: orgA.id, repairOrderId: order.id, completedAt: NOW },
    });
    await adminDb.inspectionItem.createMany({
      data: [
        {
          organizationId: orgA.id,
          inspectionId: inspection.id,
          category: "Freinage",
          label: "Plaquettes avant",
          result: "URGENT",
          measurement: "2 mm",
          recommendedLaborIds: [padsLabor.id],
          recommendedProductIds: [pads.id],
          sortOrder: 0,
        },
        {
          organizationId: orgA.id,
          inspectionId: inspection.id,
          category: "Freinage",
          label: "Disques avant",
          result: "WATCH",
          sortOrder: 1,
        },
        {
          organizationId: orgA.id,
          inspectionId: inspection.id,
          category: "Entretien",
          label: "Vidange",
          result: "URGENT",
          comment: "dépassée de 1 200 km",
          sortOrder: 2,
        },
        {
          organizationId: orgA.id,
          inspectionId: inspection.id,
          category: "Niveaux",
          label: "Liquide de refroidissement",
          result: "OK",
          sortOrder: 3,
        },
      ],
    });
    // Organisation B : son catalogue ne doit jamais apparaître dans le prompt de A.
    const customerB = await adminDb.customer.create({
      data: { organizationId: orgB.id, displayName: "Client B Secret" },
    });
    productB = await adminDb.product.create({
      data: {
        organizationId: orgB.id,
        sku: "B-PLQ",
        name: "Plaquettes Secrètes B",
        category: "Freinage",
        salePrice: 1,
      },
    });
    const vehicleB = await adminDb.vehicle.create({
      data: {
        organizationId: orgB.id,
        customerId: customerB.id,
        plate: "1111 AA 01",
        plateCompact: "1111AA01",
        make: "Kia",
        model: "Picanto",
      },
    });
    orderB = await adminDb.repairOrder.create({
      data: {
        organizationId: orgB.id,
        siteId: siteB.id,
        number: "OR-COC-2026-00001",
        customerId: customerB.id,
        vehicleId: vehicleB.id,
        status: "DIAGNOSING",
        complaint: "Plaquettes",
      },
    });
  });

  afterEach(() => setAiProviderForTests(createConsoleAiProvider()));

  afterAll(async () => {
    setAiProviderForTests(undefined);
    const orgIds = [orgA.id, orgB.id];
    const where = { organizationId: { in: orgIds } };
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.aiSuggestion.deleteMany({ where });
    await adminDb.aiInteraction.deleteMany({ where });
    await adminDb.message.deleteMany({ where });
    await adminDb.conversation.deleteMany({ where });
    await adminDb.quoteLine.deleteMany({ where });
    await adminDb.portalToken.deleteMany({ where });
    await adminDb.reminder.deleteMany({ where });
    await adminDb.quote.deleteMany({ where });
    await adminDb.inspectionItem.deleteMany({ where });
    await adminDb.inspection.deleteMany({ where });
    await adminDb.repairOrderStatusHistory.deleteMany({ where });
    await adminDb.repairOrderLine.deleteMany({ where });
    await adminDb.repairOrder.deleteMany({ where });
    await adminDb.documentSequence.deleteMany({ where });
    await adminDb.laborOperation.deleteMany({ where });
    await adminDb.product.deleteMany({ where });
    await adminDb.channelConfig.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.notification.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  let suggestionId: string;

  it("US-M17-03 : lignes du seul catalogue de l'org, MO au barème, disques « À chiffrer », AiInteraction", async () => {
    const seen: AiCompletionRequest[] = [];
    const console = createConsoleAiProvider();
    setAiProviderForTests({
      ...console,
      complete: (req) => {
        seen.push(req);
        return console.complete(req);
      },
    });
    const draft = await advisor.ai.draftQuote({ repairOrderId: order.id });
    suggestionId = draft.suggestionId;
    expect(draft.isFallback).toBe(false);
    expect(draft.compatibilityChecked).toBe(true);
    const labor = draft.lines.find((l) => l.catalogId === padsLabor.id)!;
    expect(labor.quantity).toBe(0.8);
    expect(labor.reason).toContain("plaquettes avant 2 mm");
    expect(draft.lines.map((l) => l.description)).toContain("Plaquettes AV Corolla 2014-2019");
    expect(draft.lines.map((l) => l.description)).not.toContain("Plaquettes AV Kia Picanto");
    const disques = draft.lines.find((l) => l.groupLabel === "Disques avant")!;
    expect(disques).toMatchObject({ toPrice: true, optional: true, unitPrice: 0 });
    expect(disques.description).toBe("À chiffrer : disques avant (non trouvée au catalogue)");
    expect(
      draft.lines.find((l) => l.description === "Plaquettes AV Corolla 2014-2019")!.unitPrice,
    ).toBe(28_000);

    // RG-M17-03/04 : prompt sans données d'une autre org, téléphone masqué, contenu balisé.
    const prompt = JSON.stringify(seen.map((r) => [r.system, r.messages]));
    expect(prompt).not.toContain("Plaquettes Secrètes B");
    expect(prompt).not.toContain(productB.id);
    expect(prompt).not.toContain("0707070707");
    expect(prompt).toContain("<doleance>");

    const interaction = await adminDb.aiInteraction.findFirstOrThrow({
      where: { organizationId: orgA.id, feature: "quote_draft" },
    });
    expect(interaction).toMatchObject({
      status: "OK",
      promptVersion: "quote_draft/v1",
      inputRef: `repair_order:${order.id}`,
    });
  });

  it("rejette un catalogId hors liste candidate (catalogue d'une autre org)", async () => {
    const seen: AiCompletionRequest[] = [];
    setAiProviderForTests(
      scriptedProvider(
        {
          lines: [
            {
              kind: "PART",
              catalogId: productB.id,
              quantity: 1,
              reason: "x",
              priority: "URGENT",
              optional: false,
              need: "Plaquettes avant",
            },
            {
              kind: "LABOR",
              catalogId: padsLabor.id,
              quantity: 9,
              reason: "Inspection : plaquettes 2 mm",
              priority: "URGENT",
              optional: false,
              need: "Plaquettes avant",
            },
          ],
        },
        seen,
      ),
    );
    const draft = await advisor.ai.draftQuote({ repairOrderId: order.id });
    expect(draft.rejected).toBe(1);
    expect(draft.lines.some((l) => l.catalogId === productB.id)).toBe(false);
    expect(draft.lines.find((l) => l.catalogId === padsLabor.id)!.quantity).toBe(0.8);
    // L'ancienne suggestion est périmée par la nouvelle.
    const old = await adminDb.aiSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
    expect(old.status).toBe("EXPIRED");
    suggestionId = draft.suggestionId;
  });

  it("acceptation : brouillon DRAFT avec les lignes cochées, audit, envoi bloqué par « À chiffrer »", async () => {
    const draft = await advisor.ai.draftQuote({ repairOrderId: order.id });
    const keys = draft.lines.filter((l) => l.groupLabel !== "Vidange").map((l) => l.key);
    const result = (await advisor.ai.suggestion.accept({
      suggestionId: draft.suggestionId,
      editedPayload: { selectedKeys: keys },
    })) as { quoteId: string; number: string };
    const quote = await adminDb.quote.findUniqueOrThrow({
      where: { id: result.quoteId },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
    expect(quote).toMatchObject({ status: "DRAFT", repairOrderId: order.id, origin: "INSPECTION" });
    expect(quote.lines).toHaveLength(keys.length);
    expect(quote.lines.find((l) => l.laborOperationId === padsLabor.id)!.quantity).toBe(0.8);
    expect(quote.lines.find((l) => l.productId === pads.id)!.unitPrice).toBe(28_000);
    const unpriced = quote.lines.find((l) => l.description.startsWith("À chiffrer"))!;
    expect(unpriced).toMatchObject({ unitPrice: 0, isOptional: true, priority: "WATCH" });

    const suggestion = await adminDb.aiSuggestion.findUniqueOrThrow({
      where: { id: draft.suggestionId },
    });
    expect(suggestion.status).toBe("EDITED_ACCEPTED");
    const audit = await adminDb.auditLog.findFirstOrThrow({
      where: { organizationId: orgA.id, action: "quote.created_from_ai_draft" },
    });
    expect((audit.after as { aiSuggestionId: string }).aiSuggestionId).toBe(draft.suggestionId);
    const interaction = await adminDb.aiInteraction.findUniqueOrThrow({
      where: { id: suggestion.interactionId! },
    });
    expect(interaction.accepted).toBe(true);
    expect(interaction.editDistance).toBeGreaterThan(0);

    await expect(
      advisor.quote.send({ id: quote.id, channel: "LINK_ONLY", recipient: { type: "CUSTOMER" } }),
    ).rejects.toThrow(/À chiffrer/);
    // Une fois le prix complété, l'envoi est possible.
    await advisor.quoteLine.update({ id: unpriced.id, patch: { unitPrice: 60_000 } });
    await expect(
      advisor.quote.send({ id: quote.id, channel: "LINK_ONLY", recipient: { type: "CUSTOMER" } }),
    ).resolves.toBeTruthy();
    // Suggestion déjà décidée : pas de seconde exécution.
    await expect(
      advisor.ai.suggestion.accept({ suggestionId: draft.suggestionId }),
    ).rejects.toThrow(/plus d'actualité/);
  });

  it("isolation multi-locataire et permissions", async () => {
    suggestionId = (await advisor.ai.draftQuote({ repairOrderId: order.id })).suggestionId;
    await expect(ownerB.ai.draftQuote({ repairOrderId: order.id })).rejects.toThrow(/introuvable/);
    await expect(ownerB.ai.suggestion.accept({ suggestionId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // MECHANIC a ai:use mais pas quote:create.
    await expect(mechanic.ai.draftQuote({ repairOrderId: order.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(mechanic.ai.suggestion.accept({ suggestionId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(advisor.ai.draftQuote({ repairOrderId: orderB.id })).rejects.toThrow(
      /introuvable/,
    );
  });

  it("repli sans IA (panne) : lignes recommandées de l'inspection", async () => {
    setAiProviderForTests(createConsoleAiProvider({ fail: "ERROR" }));
    const draft = await advisor.ai.draftQuote({ repairOrderId: order.id });
    expect(draft.isFallback).toBe(true);
    expect(draft.fallbackReason).toBeTruthy();
    expect(draft.lines.filter((l) => !l.toPrice).map((l) => l.catalogId)).toEqual([
      padsLabor.id,
      pads.id,
    ]);
    expect(draft.lines.filter((l) => l.toPrice).map((l) => l.groupLabel)).toEqual([
      "Disques avant",
      "Vidange",
    ]);
    const last = await adminDb.aiInteraction.findFirstOrThrow({
      where: { organizationId: orgA.id, feature: "quote_draft" },
      orderBy: { createdAt: "desc" },
    });
    expect(last.status).toBe("ERROR");
  });

  it("offre STARTER : pré-devis hors plan → repli DISABLED", async () => {
    await adminDb.organization.update({ where: { id: orgA.id }, data: { plan: "STARTER" } });
    try {
      const draft = await advisor.ai.draftQuote({ repairOrderId: order.id });
      expect(draft.isFallback).toBe(true);
      expect(draft.fallbackReason).toContain("STARTER");
    } finally {
      await adminDb.organization.update({ where: { id: orgA.id }, data: { plan: "PRO" } });
    }
  });

  it("US-M17-04 : explication proposée, éditée puis validée, visible sur la vue client", async () => {
    const quote = await adminDb.quote.findFirstOrThrow({
      where: { organizationId: orgA.id, repairOrderId: order.id },
    });
    const before = await advisor.quote.preview({ id: quote.id });
    expect(before.groups.every((g) => g.simpleExplanation === null)).toBe(true);

    const proposal = await advisor.ai.explainQuote({ quoteId: quote.id });
    expect(proposal.isFallback).toBe(false);
    const pads = proposal.groups.find((g) => g.label === "Plaquettes avant")!;
    expect(pads.text).toMatch(/rapidement/);
    expect(pads.text).not.toMatch(/FCFA/);
    // Pas encore validée : rien sur la vue client.
    const pending = await advisor.quote.preview({ id: quote.id });
    expect(pending.groups.every((g) => g.simpleExplanation === null)).toBe(true);

    const edited = proposal.groups.map((g) =>
      g.key === pads.key
        ? {
            key: g.key,
            text: "Vos plaquettes avant sont presque usées (2 mm). Les changer garantit un bon freinage.",
          }
        : { key: g.key, text: g.text },
    );
    await advisor.ai.suggestion.accept({
      suggestionId: proposal.suggestionId,
      editedPayload: { groups: edited },
    });
    const view = await advisor.quote.preview({ id: quote.id });
    expect(view.groups.find((g) => g.key === pads.key)!.simpleExplanation).toBe(
      "Vos plaquettes avant sont presque usées (2 mm). Les changer garantit un bon freinage.",
    );
    const suggestion = await adminDb.aiSuggestion.findUniqueOrThrow({
      where: { id: proposal.suggestionId },
    });
    expect(suggestion.status).toBe("EDITED_ACCEPTED");
    const interaction = await adminDb.aiInteraction.findUniqueOrThrow({
      where: { id: suggestion.interactionId! },
    });
    expect(interaction).toMatchObject({ feature: "quote_explanation", accepted: true });
    expect(interaction.editDistance).toBeGreaterThan(0);

    await expect(ownerB.ai.explainQuote({ quoteId: quote.id })).rejects.toThrow();
  });
});
