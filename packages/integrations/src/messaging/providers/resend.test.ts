import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyResendError, createResendProvider } from "./resend";

const credentials = {
  apiKey: "re_123",
  fromEmail: "contact@garage.ci",
  fromName: "Garage Excellence Auto",
  webhookSecret: `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createResendProvider.send", () => {
  it("envoie un email avec from/to/subject/html", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "email_123" }));
    const provider = createResendProvider(credentials, { fetchImpl });

    const result = await provider.send({
      organizationId: "org_1",
      to: "client@example.com",
      channel: "EMAIL",
      body: "<p>Bonjour</p>",
      idempotencyKey: "inv:1",
      subject: "Votre facture",
    } as never);

    expect(result).toEqual({ providerMessageId: "email_123" });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(init.body);
    expect(payload.from).toBe("Garage Excellence Auto <contact@garage.ci>");
    expect(payload.subject).toBe("Votre facture");
    expect(payload.html).toBe("<p>Bonjour</p>");
  });

  it("utilise un objet par défaut si absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "email_456" }));
    const provider = createResendProvider(credentials, { fetchImpl });

    await provider.send({
      organizationId: "org_1",
      to: "client@example.com",
      channel: "EMAIL",
      body: "<p>Bonjour</p>",
      idempotencyKey: "inv:2",
    });

    const payload = JSON.parse(fetchImpl.mock.calls[0]?.[1].body);
    expect(payload.subject).toBe("AtelierOS");
  });

  it("lève une erreur PERMANENT_RECIPIENT sur un rebond (422)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "Invalid recipient email" }, 422));
    const provider = createResendProvider(credentials, { fetchImpl });

    await expect(
      provider.send({
        organizationId: "org_1",
        to: "bad@example.com",
        channel: "EMAIL",
        body: "x",
        idempotencyKey: "inv:3",
      }),
    ).rejects.toMatchObject({ category: "PERMANENT_RECIPIENT" });
  });
});

describe("classifyResendError", () => {
  it.each([
    [401, undefined, "PERMANENT_CONFIG"],
    [403, undefined, "PERMANENT_CONFIG"],
    [429, undefined, "RATE_LIMIT"],
    [422, "bounced recipient", "PERMANENT_RECIPIENT"],
    [422, "something else", "TEMPORARY"],
    [500, undefined, "TEMPORARY"],
  ])("classe (%s, %s) en %s", (status, message, expected) => {
    expect(classifyResendError(status, message)).toBe(expected);
  });
});

describe("createResendProvider.verifyWebhook", () => {
  it("accepte une signature Svix valide", async () => {
    const provider = createResendProvider(credentials);
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "email_123" } });
    const svixId = "msg_1";
    const svixTimestamp = "1700000000";
    const secretBytes = Buffer.from(credentials.webhookSecret.split("_").pop() ?? "", "base64");
    const signature = createHmac("sha256", secretBytes)
      .update(`${svixId}.${svixTimestamp}.${body}`)
      .digest("base64");

    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": `v1,${signature}`,
      },
      body,
    });
    expect(await provider.verifyWebhook(req)).toBe(true);
  });

  it("refuse sans secret de signature configuré", async () => {
    const provider = createResendProvider({ ...credentials, webhookSecret: undefined });
    const req = new Request("https://example.com/webhook", { method: "POST", body: "{}" });
    expect(await provider.verifyWebhook(req)).toBe(false);
  });

  it("refuse une signature invalide", async () => {
    const provider = createResendProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "svix-id": "msg_1",
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,deadbeef",
      },
      body: "{}",
    });
    expect(await provider.verifyWebhook(req)).toBe(false);
  });
});

describe("createResendProvider.parseWebhook", () => {
  it("convertit email.delivered en statut DELIVERED", async () => {
    const provider = createResendProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({
        type: "email.delivered",
        data: { email_id: "email_123" },
        created_at: "2026-01-01",
      }),
    });
    expect(await provider.parseWebhook(req)).toEqual([
      {
        kind: "status",
        providerMessageId: "email_123",
        status: "DELIVERED",
        occurredAt: expect.any(Date),
      },
    ]);
  });

  it("ignore un type d'événement non reconnu", async () => {
    const provider = createResendProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({ type: "email.opened", data: {} }),
    });
    expect(await provider.parseWebhook(req)).toEqual([]);
  });
});
