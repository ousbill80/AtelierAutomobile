import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import {
  createConsoleAiProvider,
  type AiCompletionRequest,
  type AiProvider,
} from "@atelieros/integrations";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setAiProviderForTests } from "../ai/service";
import { createContext } from "../context";
import { getObjectStorage } from "../storage";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// M17 — extraction de documents (US-M17-06, RG-M17-18) et correspondance de colonnes
// (US-M17-05, RG-M17-17, M13 RG-M13-07), fournisseur `console`.

const callerFactory = createCallerFactory(appRouter);

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function member(organizationId: string, role: string) {
  const user = await adminDb.user.create({
    data: { name: `AI ${role}`, email: `ai-ext-${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
    data: { organizationId, userId: user.id, role: role as never, siteIds: [] },
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

function spyProvider(base: AiProvider = createConsoleAiProvider()) {
  const requests: AiCompletionRequest[] = [];
  const provider: AiProvider = {
    ...base,
    complete(request) {
      requests.push(request);
      return base.complete(request);
    },
  };
  return { provider, requests };
}

// Petite image PNG valide (1×1) en base64.
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const CSV =
  "Nom;Joignable proprio;Truc\n" +
  "Kouassi Jean-Marc;0747218890;x\n" +
  "Ibrahim Diallo;0505123456;y\n";

describe("M17 — extraction de documents et correspondance de colonnes", () => {
  let org: { id: string };
  let otherOrg: { id: string };
  let owner: { userId: string; token: string };
  let mechanic: { userId: string; token: string };
  let otherOwner: { userId: string; token: string };
  const userIds: string[] = [];

  beforeAll(async () => {
    org = await adminDb.organization.create({
      data: { name: "Garage IA Extraction", plan: "PRO", onboardingCompletedAt: new Date() },
    });
    otherOrg = await adminDb.organization.create({
      data: { name: "Garage IA Extraction Autre", onboardingCompletedAt: new Date() },
    });
    owner = await member(org.id, "OWNER");
    mechanic = await member(org.id, "MECHANIC");
    otherOwner = await member(otherOrg.id, "OWNER");
    userIds.push(owner.userId, mechanic.userId, otherOwner.userId);
  });

  afterEach(() => setAiProviderForTests());

  afterAll(async () => {
    const orgIds = [org.id, otherOrg.id];
    await adminDb.aiSuggestion.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.aiInteraction.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.importRowError.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.importJob.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.notification.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("carte grise → champs normalisés avec confiance, suggestion seule (aucun véhicule créé)", async () => {
    setAiProviderForTests(createConsoleAiProvider());
    const caller = callerFactory(await contextFor(owner.token));
    const result = await caller.ai.extractDocument({
      kind: "VEHICLE_REGISTRATION",
      image: { mediaType: "image/png", dataBase64: PNG_1PX },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.plate).toEqual({
      value: "2547 GH 01",
      confidence: 0.96,
      needsReview: false,
    });
    expect(result.fields.fuel!.value).toBe("PETROL");
    expect(result.fields.firstRegistrationDate!.value).toBe("2018-03-14");
    expect(result.fields.ownerName!.needsReview).toBe(true); // 0,64 < 0,7
    expect(result.suggestionId).toBeTruthy();

    expect(await adminDb.vehicle.count({ where: { organizationId: org.id } })).toBe(0);
    const interaction = await adminDb.aiInteraction.findFirstOrThrow({
      where: { organizationId: org.id, feature: "document_extraction" },
    });
    expect(interaction).toMatchObject({ status: "OK", promptVersion: "v1", model: "console" });
    expect(JSON.stringify(interaction.output)).not.toContain(PNG_1PX);

    // Le formulaire enregistre puis trace la décision : un champ corrigé → editDistance > 0.
    await caller.ai.suggestion.accept({
      suggestionId: result.suggestionId!,
      editedPayload: {
        fields: {
          ...Object.fromEntries(Object.entries(result.fields).map(([k, f]) => [k, f.value])),
          model: "COROLLA XLI",
        },
      },
    });
    const suggestion = await adminDb.aiSuggestion.findUniqueOrThrow({
      where: { id: result.suggestionId! },
    });
    expect(suggestion.status).toBe("EDITED_ACCEPTED");
    const decided = await adminDb.aiInteraction.findUniqueOrThrow({
      where: { id: interaction.id },
    });
    expect(decided.accepted).toBe(true);
    expect(decided.editDistance).toBeGreaterThan(0);
  });

  it("constat amiable → date, lieu, police ; refusé sans permission assurance", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    const result = await caller.ai.extractDocument({
      kind: "CLAIM_REPORT",
      image: { mediaType: "image/jpeg", dataBase64: PNG_1PX },
    });
    expect(result.ok && result.fields.accidentDate!.value).toBe("2026-10-15");
    expect(result.ok && result.fields.policyNumber!.value).toBe("POL-2026-55821");

    const mech = callerFactory(await contextFor(mechanic.token));
    await expect(
      mech.ai.extractDocument({
        kind: "CLAIM_REPORT",
        image: { mediaType: "image/jpeg", dataBase64: PNG_1PX },
      }),
    ).rejects.toThrow("droits");
  });

  it("image > 5 Mo ou invalide refusée ; IA en panne → repli saisie manuelle", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    await expect(
      caller.ai.extractDocument({
        kind: "ODOMETER",
        image: { mediaType: "image/jpeg", dataBase64: "A".repeat(7_100_000) },
      }),
    ).rejects.toThrow("5 Mo");
    await expect(
      caller.ai.extractDocument({
        kind: "ODOMETER",
        image: { mediaType: "image/jpeg", dataBase64: "pas du base64 !" },
      }),
    ).rejects.toThrow("Image invalide");

    setAiProviderForTests(createConsoleAiProvider({ fail: "ERROR" }));
    const result = await caller.ai.extractDocument({
      kind: "ODOMETER",
      image: { mediaType: "image/jpeg", dataBase64: PNG_1PX },
    });
    expect(result).toEqual({ ok: false, reason: "Assistant momentanément indisponible." });
  });

  async function jobWithFile(token: string) {
    const caller = callerFactory(await contextFor(token));
    const { jobId } = await caller.import.upload({
      fileName: "clients.csv",
      size: CSV.length,
      mimeType: "text/csv",
    });
    const job = await adminDb.importJob.findUniqueOrThrow({ where: { id: jobId } });
    await getObjectStorage().upload({
      key: job.fileUrl!,
      body: new TextEncoder().encode(CSV),
      contentType: "text/csv",
    });
    return { caller, jobId };
  }

  it("import : « Joignable proprio » → customer.phone 0,9 proposé par l'IA, exemples masqués", async () => {
    const spy = spyProvider();
    setAiProviderForTests(spy.provider);
    const { caller, jobId } = await jobWithFile(owner.token);
    const analyzed = await caller.import.analyze({ jobId });
    const contact = analyzed.mapping.find((m) => m.column === "Joignable proprio")!;
    expect(contact).toMatchObject({ field: "customer.phone", confidence: 0.9, source: "ai" });
    // « Nom » (synonyme exact) n'est pas envoyé à l'IA.
    const prompt = JSON.stringify(spy.requests.map((r) => r.messages));
    expect(prompt).not.toContain("« Nom »");
    expect(prompt).toContain("07XXXXXXXX");
    expect(prompt).not.toContain("0747218890");

    const direct = await caller.ai.mapColumns({
      importJobId: jobId,
      columns: [{ header: "Joignable proprio", samples: ["0747218890"] }],
      targetFields: ["customer.phone", "customer.email"],
    });
    expect(direct).toEqual({
      available: true,
      mappings: [{ column: "Joignable proprio", field: "customer.phone", confidence: 0.9 }],
    });

    // Isolation : le job n'existe pas pour une autre organisation.
    const other = callerFactory(await contextFor(otherOwner.token));
    await expect(
      other.ai.mapColumns({
        importJobId: jobId,
        columns: [{ header: "Joignable proprio", samples: [] }],
        targetFields: ["customer.phone"],
      }),
    ).rejects.toThrow("Import introuvable");
  });

  it("IA indisponible → import non bloqué, colonnes « à associer »", async () => {
    setAiProviderForTests(createConsoleAiProvider({ fail: "ERROR" }));
    const { caller, jobId } = await jobWithFile(owner.token);
    const analyzed = await caller.import.analyze({ jobId });
    expect(analyzed.mapping.find((m) => m.column === "Joignable proprio")).toMatchObject({
      field: null,
      source: null,
    });
    expect(analyzed.mapping.find((m) => m.column === "Nom")!.field).toBe("customer.displayName");
    const direct = await caller.ai.mapColumns({
      importJobId: jobId,
      columns: [{ header: "Joignable proprio", samples: [] }],
      targetFields: ["customer.phone"],
    });
    expect(direct.available).toBe(false);
  });
});
