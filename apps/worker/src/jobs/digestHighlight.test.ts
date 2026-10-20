import { randomBytes } from "node:crypto";
import { adminDb } from "@atelieros/db";
import {
  createConsoleAiProvider,
  type AiCompletionRequest,
  type AiProvider,
} from "@atelieros/integrations";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setAiProviderForTests } from "../ai";
import { sendOrganizationDigest } from "./digestOwner";

// M17 RG-M17-21 — phrase « faits marquants » du résumé quotidien (fournisseur `console`) :
// présente en offre PRO, absente en STARTER ou si l'IA est en panne (résumé jamais bloqué),
// chiffres agrégés seulement dans le prompt.

const NOW = new Date("2026-10-19T08:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("digest.owner — phrase « faits marquants » (M17)", () => {
  const orgIds: string[] = [];
  const userIds: string[] = [];

  async function garage(plan: "STARTER" | "PRO", name: string) {
    const org = await adminDb.organization.create({ data: { name, plan } });
    orgIds.push(org.id);
    const site = await adminDb.site.create({
      data: { organizationId: org.id, name: "Yopougon", code: "YOP" },
    });
    const user = await adminDb.user.create({
      data: {
        name: "Gérant",
        email: `${randomBytes(4).toString("hex")}@example.com`,
        phone: `+22507${randomBytes(4).readUInt32BE(0).toString().padStart(8, "0").slice(0, 8)}`,
      },
    });
    userIds.push(user.id);
    const owner = await adminDb.membership.create({
      data: { organizationId: org.id, userId: user.id, role: "OWNER", siteIds: [] },
    });
    await adminDb.channelConfig.create({
      data: {
        organizationId: org.id,
        channel: "WHATSAPP",
        provider: "console",
        isActive: true,
        credentials: "",
      },
    });
    const customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "SOTRA Logistique", type: "COMPANY" },
    });
    await adminDb.invoice.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        customerId: customer.id,
        number: `FAC-${randomBytes(3).toString("hex")}`,
        status: "OVERDUE",
        issuedAt: new Date(NOW.getTime() - 60 * DAY),
        dueDate: new Date("2026-09-01T00:00:00Z"),
        total: 1_240_000,
        balance: 1_240_000,
      },
    });
    return { org, owner };
  }

  const digestOf = async (organizationId: string) =>
    (await adminDb.message.findFirstOrThrow({ where: { organizationId, kind: "DIGEST" } })).body;

  beforeAll(() => setAiProviderForTests(createConsoleAiProvider()));
  afterEach(() => setAiProviderForTests(createConsoleAiProvider()));

  afterAll(async () => {
    const where = { organizationId: { in: orgIds } };
    await adminDb.messageAttempt.deleteMany({ where });
    await adminDb.message.deleteMany({ where });
    await adminDb.aiInteraction.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.channelConfig.deleteMany({ where });
    await adminDb.site.deleteMany({ where });
    await adminDb.notification.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("offre PRO : ligne 💡 avant le lien, AiInteraction daily_digest, prompt sans nom de client", async () => {
    const seen: AiCompletionRequest[] = [];
    const base = createConsoleAiProvider();
    const spy: AiProvider = {
      ...base,
      complete: (request) => {
        seen.push(request);
        return base.complete(request);
      },
    };
    setAiProviderForTests(spy);
    const { org, owner } = await garage("PRO", "Garage Digest IA");
    expect(await sendOrganizationDigest(org.id, NOW)).toBe(1);
    const lines = (await digestOf(org.id)).split("\n");
    expect(lines.at(-2)).toBe(
      "💡 1 240 000 FCFA de créances ont plus de 30 jours : pensez à valider les relances.",
    );
    expect(lines.at(-1)).toMatch(/^Détails : /);
    const interaction = await adminDb.aiInteraction.findFirstOrThrow({
      where: { organizationId: org.id, feature: "daily_digest" },
    });
    expect(interaction).toMatchObject({
      status: "OK",
      promptVersion: "v1",
      inputRef: `digest:${owner.id}:2026-10-19`,
    });
    const prompt = JSON.stringify(seen.map((r) => r.messages));
    expect(prompt).not.toContain("SOTRA");
    expect(prompt).not.toContain("Garage Digest IA");
  });

  it("offre STARTER : fonction non incluse, résumé envoyé sans phrase", async () => {
    const { org } = await garage("STARTER", "Garage Digest Starter");
    expect(await sendOrganizationDigest(org.id, NOW)).toBe(1);
    expect(await digestOf(org.id)).not.toContain("💡");
    expect(
      (
        await adminDb.aiInteraction.findFirstOrThrow({
          where: { organizationId: org.id, feature: "daily_digest" },
        })
      ).status,
    ).toBe("DISABLED");
  });

  it("IA en panne ou phrase inventée : résumé envoyé sans phrase", async () => {
    setAiProviderForTests(createConsoleAiProvider({ fail: "ERROR" }));
    const down = await garage("PRO", "Garage Digest Panne");
    expect(await sendOrganizationDigest(down.org.id, NOW)).toBe(1);
    expect(await digestOf(down.org.id)).not.toContain("💡");

    const inventing: AiProvider = {
      ...createConsoleAiProvider(),
      async complete(request) {
        return {
          text: JSON.stringify({ sentence: "Record absolu : 9 999 999 FCFA encaissés hier." }),
          toolCalls: [],
          stopReason: "end_turn",
          tokensIn: request.system.length,
          tokensOut: 20,
          model: "test",
        };
      },
    };
    setAiProviderForTests(inventing);
    const lying = await garage("PRO", "Garage Digest Invente");
    expect(await sendOrganizationDigest(lying.org.id, NOW)).toBe(1);
    expect(await digestOf(lying.org.id)).not.toContain("9 999 999");
  });
});
