import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { decryptSecret, loadEncryptionKey } from "@atelieros/integrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// Clé de test (jamais une vraie clé) si `.env` n'en fournit pas.
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const callerFactory = createCallerFactory(appRouter);

async function ownerCaller(organizationId: string) {
  const user = await adminDb.user.create({
    data: { name: "Owner Canaux", email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({
    data: { organizationId, userId: user.id, role: "OWNER", siteIds: [] },
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
  return { userId: user.id, caller: callerFactory(ctx) };
}

async function storedCredentials(id: string): Promise<Record<string, unknown>> {
  const row = await adminDb.channelConfig.findUniqueOrThrow({ where: { id } });
  return JSON.parse(decryptSecret(row.credentials, loadEncryptionKey())) as Record<string, unknown>;
}

describe("channel router (M11 — canaux)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let a: Awaited<ReturnType<typeof ownerCaller>>;
  let b: Awaited<ReturnType<typeof ownerCaller>>;

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Canaux Test A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Canaux Test B" } });
    a = await ownerCaller(orgA.id);
    b = await ownerCaller(orgB.id);
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    await adminDb.channelConfig.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.session.deleteMany({ where: { userId: { in: [a.userId, b.userId] } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: [a.userId, b.userId] } } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("activer/désactiver conserve les identifiants chiffrés (setActive et upsert avec {})", async () => {
    const created = await a.caller.channel.upsert({
      channel: "SMS",
      provider: "twilio",
      isActive: true,
      priority: 1,
      credentials: { accountSid: "AC_fake", authToken: "fake-token", fromNumber: "+10000000000" },
    });
    expect(created).not.toHaveProperty("credentials");

    await a.caller.channel.setActive({ id: created.id, isActive: false });
    expect(await storedCredentials(created.id)).toEqual({
      accountSid: "AC_fake",
      authToken: "fake-token",
      fromNumber: "+10000000000",
    });

    // Ancien chemin du bouton : upsert avec des identifiants vides ne doit rien effacer.
    await a.caller.channel.upsert({
      id: created.id,
      channel: "SMS",
      provider: "twilio",
      isActive: true,
      priority: 1,
      credentials: {},
    });
    expect((await storedCredentials(created.id)).authToken).toBe("fake-token");

    // Reconfiguration partielle : seuls les champs saisis remplacent les valeurs existantes.
    await a.caller.channel.upsert({
      id: created.id,
      channel: "SMS",
      provider: "twilio",
      isActive: true,
      priority: 1,
      credentials: { authToken: "new-fake-token", accountSid: "" },
    });
    expect(await storedCredentials(created.id)).toEqual({
      accountSid: "AC_fake",
      authToken: "new-fake-token",
      fromNumber: "+10000000000",
    });

    const list = await a.caller.channel.list();
    const row = list.find((c) => c.id === created.id);
    expect(row).toMatchObject({ isActive: true, hasCredentials: true });
    expect(row).not.toHaveProperty("credentials");
  });

  it("reconfigurer un fournisseur local sans id met à jour la ligne existante", async () => {
    const first = await a.caller.channel.upsert({
      channel: "WHATSAPP",
      provider: "console",
      isActive: true,
      priority: 1,
      credentials: {},
    });
    const second = await a.caller.channel.upsert({
      channel: "WHATSAPP",
      provider: "console",
      isActive: true,
      priority: 1,
      credentials: {},
    });
    expect(second.id).toBe(first.id);
  });

  it("« Vérifier maintenant » teste la configuration demandée, même désactivée", async () => {
    const httpSms = await a.caller.channel.upsert({
      channel: "SMS",
      provider: "http_sms",
      isActive: false,
      priority: 2,
      credentials: {
        url: "https://sms.example.test/send",
        method: "POST",
        bodyTemplate: '{"to":"{{to}}","text":"{{body}}"}',
        contentType: "application/json",
        responseMessageIdPath: "id",
      },
    });
    const health = await a.caller.channel.test({ id: httpSms.id });
    // Le message de santé vient de l'adaptateur http_sms, pas de twilio (priorité 1, actif).
    expect(health.ok).toBe(true);
    expect(health.detail).toContain("Agrégateur SMS");
    const row = await adminDb.channelConfig.findUniqueOrThrow({ where: { id: httpSms.id } });
    expect(row.status).toBe("OK");
    expect(row.isActive).toBe(false);
  });

  it("template.preview rend un modèle à variables avec des données de démonstration", async () => {
    const preview = await a.caller.template.preview({
      channel: "SMS",
      body: "Bonjour {{client.salutation}}, la VT de {{vehicule.plaque}} expire le {{vt.dateExpiration}}. Solde : {{facture.solde}}. {{garage.nom}}",
    });
    expect(preview.rendered).toContain("1234 AB 01");
    expect(preview.rendered).toContain("Garage Canaux Test A");
    expect(preview.rendered).not.toContain("{{");
    expect(preview.sms?.segments).toBeGreaterThanOrEqual(1);
  });

  it("isolation multi-locataire : B ne voit ni ne modifie les canaux de A", async () => {
    const listA = await a.caller.channel.list();
    expect(listA.length).toBeGreaterThan(0);
    const listB = await b.caller.channel.list();
    expect(listB.some((c) => listA.some((x) => x.id === c.id))).toBe(false);

    const target = listA[0]!;
    await expect(b.caller.channel.setActive({ id: target.id, isActive: false })).rejects.toThrow();
    await expect(b.caller.channel.test({ id: target.id })).rejects.toThrow();
    await expect(
      b.caller.channel.upsert({
        id: target.id,
        channel: "SMS",
        provider: "twilio",
        isActive: false,
        priority: 1,
        credentials: {},
      }),
    ).rejects.toThrow();
  });
});
