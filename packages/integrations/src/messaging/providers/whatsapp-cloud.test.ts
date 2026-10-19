import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyWhatsappCloudError, createWhatsappCloudProvider } from "./whatsapp-cloud";

const credentials = {
  phoneNumberId: "1234567890",
  wabaId: "waba_1",
  accessToken: "token_abc",
  appSecret: "app_secret",
  verifyToken: "verify_123",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createWhatsappCloudProvider.send", () => {
  it("envoie un message texte libre et renvoie le providerMessageId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.123" }] }));
    const provider = createWhatsappCloudProvider(credentials, { fetchImpl });

    const result = await provider.send({
      organizationId: "org_1",
      to: "+2250747218890",
      channel: "WHATSAPP",
      body: "Bonjour",
      idempotencyKey: "rem:1",
    });

    expect(result).toEqual({ providerMessageId: "wamid.123" });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://graph.facebook.com/v20.0/1234567890/messages");
    expect(init.headers.Authorization).toBe("Bearer token_abc");
    expect(JSON.parse(init.body).type).toBe("text");
  });

  it("envoie un message modèle hors fenêtre 24 h avec les paramètres positionnels", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.456" }] }));
    const provider = createWhatsappCloudProvider(credentials, { fetchImpl });

    await provider.send({
      organizationId: "org_1",
      to: "+2250747218890",
      channel: "WHATSAPP",
      body: "ignoré pour un modèle",
      idempotencyKey: "rem:2",
      templateName: "excelauto_vt_j30_v1",
      templateParams: ["M. Kouassi", "2547 GH 01"],
    } as never);

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const payload = JSON.parse(init.body);
    expect(payload.type).toBe("template");
    expect(payload.template.name).toBe("excelauto_vt_j30_v1");
    expect(payload.template.components[0].parameters).toEqual([
      { type: "text", text: "M. Kouassi" },
      { type: "text", text: "2547 GH 01" },
    ]);
  });

  it("lève une erreur classée PERMANENT_RECIPIENT pour un numéro non WhatsApp (131026)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: 131026, message: "Recipient not on WhatsApp" } }, 400),
      );
    const provider = createWhatsappCloudProvider(credentials, { fetchImpl });

    await expect(
      provider.send({
        organizationId: "org_1",
        to: "+2250747218890",
        channel: "WHATSAPP",
        body: "Bonjour",
        idempotencyKey: "rem:3",
      }),
    ).rejects.toMatchObject({ category: "PERMANENT_RECIPIENT", providerCode: "131026" });
  });
});

describe("classifyWhatsappCloudError", () => {
  it.each([
    [131026, "PERMANENT_RECIPIENT"],
    [131047, "PERMANENT_TEMPLATE"],
    [132001, "PERMANENT_TEMPLATE"],
    [190, "PERMANENT_CONFIG"],
    [401, "PERMANENT_CONFIG"],
    [131048, "RATE_LIMIT"],
    [80007, "RATE_LIMIT"],
    [429, "RATE_LIMIT"],
    [999, "TEMPORARY"],
  ])("classe le code %s en %s", (code, expected) => {
    expect(classifyWhatsappCloudError(code)).toBe(expected);
  });
});

describe("createWhatsappCloudProvider.verifyWebhook", () => {
  it("accepte une signature X-Hub-Signature-256 valide", async () => {
    const provider = createWhatsappCloudProvider(credentials);
    const body = JSON.stringify({ entry: [] });
    const signature = createHmac("sha256", credentials.appSecret).update(body).digest("hex");
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": `sha256=${signature}` },
      body,
    });
    expect(await provider.verifyWebhook(req)).toBe(true);
  });

  it("rejette une signature invalide", async () => {
    const provider = createWhatsappCloudProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
      body: JSON.stringify({ entry: [] }),
    });
    expect(await provider.verifyWebhook(req)).toBe(false);
  });

  it("rejette l'absence de signature", async () => {
    const provider = createWhatsappCloudProvider(credentials);
    const req = new Request("https://example.com/webhook", { method: "POST", body: "{}" });
    expect(await provider.verifyWebhook(req)).toBe(false);
  });
});

describe("createWhatsappCloudProvider.parseWebhook", () => {
  it("convertit un statut en ProviderEvent", async () => {
    const provider = createWhatsappCloudProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1700000000" }],
                },
              },
            ],
          },
        ],
      }),
    });
    const events = await provider.parseWebhook(req);
    expect(events).toEqual([
      {
        kind: "status",
        providerMessageId: "wamid.1",
        status: "DELIVERED",
        occurredAt: new Date(1700000000000),
      },
    ]);
  });

  it("convertit un message entrant en ProviderEvent", async () => {
    const provider = createWhatsappCloudProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "2250747218890",
                      text: { body: "Oui samedi matin" },
                      timestamp: "1700000100",
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });
    const events = await provider.parseWebhook(req);
    expect(events).toEqual([
      {
        kind: "inbound",
        from: "2250747218890",
        body: "Oui samedi matin",
        occurredAt: new Date(1700000100000),
      },
    ]);
  });
});

describe("createWhatsappCloudProvider.healthCheck", () => {
  it("renvoie ok=true si l'API répond 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "1234567890" }));
    const provider = createWhatsappCloudProvider(credentials, { fetchImpl });
    expect(await provider.healthCheck()).toEqual({ ok: true });
  });

  it("renvoie ok=false si l'API échoue", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const provider = createWhatsappCloudProvider(credentials, { fetchImpl });
    const result = await provider.healthCheck();
    expect(result.ok).toBe(false);
  });
});
