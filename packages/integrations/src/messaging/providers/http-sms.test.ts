import { describe, expect, it, vi } from "vitest";
import { classifyHttpSmsError, createHttpSmsProvider } from "./http-sms";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const credentials = {
  url: "https://sms-aggregateur.local/send",
  method: "POST" as const,
  bodyTemplate: JSON.stringify({ to: "{{to}}", text: "{{body}}" }),
  contentType: "application/json" as const,
  responseMessageIdPath: "data.id",
  webhookToken: "secret_token",
};

describe("createHttpSmsProvider.send", () => {
  it("substitue to/body dans le gabarit et lit l'id via responseMessageIdPath", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "abc123" } }));
    const provider = createHttpSmsProvider(credentials, { fetchImpl });

    const result = await provider.send({
      organizationId: "org_1",
      to: "+2250747218890",
      channel: "SMS",
      body: "Bonjour",
      idempotencyKey: "rem:1",
    });

    expect(result).toEqual({ providerMessageId: "abc123" });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(credentials.url);
    expect(JSON.parse(init.body)).toEqual({ to: "+2250747218890", text: "Bonjour" });
  });

  it("lève une erreur classée selon le code HTTP", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 429));
    const provider = createHttpSmsProvider(credentials, { fetchImpl });

    await expect(
      provider.send({
        organizationId: "org_1",
        to: "+2250747218890",
        channel: "SMS",
        body: "x",
        idempotencyKey: "rem:1",
      }),
    ).rejects.toMatchObject({ category: "RATE_LIMIT" });
  });
});

describe("classifyHttpSmsError", () => {
  it.each([
    [429, "RATE_LIMIT"],
    [401, "PERMANENT_CONFIG"],
    [403, "PERMANENT_CONFIG"],
    [400, "PERMANENT_RECIPIENT"],
    [500, "TEMPORARY"],
  ])("classe %s en %s", (status, expected) => {
    expect(classifyHttpSmsError(status)).toBe(expected);
  });
});

describe("createHttpSmsProvider.verifyWebhook", () => {
  it("accepte un jeton correct en en-tête", async () => {
    const provider = createHttpSmsProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      headers: { "x-webhook-token": "secret_token" },
    });
    expect(await provider.verifyWebhook(req)).toBe(true);
  });

  it("accepte un jeton correct en paramètre d'URL", async () => {
    const provider = createHttpSmsProvider(credentials);
    const req = new Request("https://example.com/webhook?token=secret_token");
    expect(await provider.verifyWebhook(req)).toBe(true);
  });

  it("rejette un jeton incorrect ou absent", async () => {
    const provider = createHttpSmsProvider(credentials);
    expect(await provider.verifyWebhook(new Request("https://example.com/webhook"))).toBe(false);
  });
});

describe("createHttpSmsProvider.parseWebhook", () => {
  it("convertit une notification générique en ProviderEvent", async () => {
    const provider = createHttpSmsProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({ messageId: "abc123", status: "delivered" }),
    });
    expect(await provider.parseWebhook(req)).toEqual([
      {
        kind: "status",
        providerMessageId: "abc123",
        status: "DELIVERED",
        occurredAt: expect.any(Date),
      },
    ]);
  });
});
