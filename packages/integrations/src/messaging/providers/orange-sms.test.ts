import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyOrangeSmsError, createOrangeSmsProvider } from "./orange-sms";

const credentials = { clientId: "client_1", clientSecret: "secret_1", senderName: "EXCELAUTO" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createOrangeSmsProvider.send", () => {
  it("obtient un jeton OAuth2 puis envoie le SMS", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok_1", expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          outboundSMSMessageRequest: {
            resourceReference: { resourceURL: "https://api.orange.com/.../abc123" },
          },
        }),
      );
    const provider = createOrangeSmsProvider(credentials, { fetchImpl });

    const result = await provider.send({
      organizationId: "org_1",
      to: "+2250747218890",
      channel: "SMS",
      body: "Votre VT expire bientôt",
      idempotencyKey: "rem:1",
    });

    expect(result).toEqual({ providerMessageId: "abc123" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.orange.com/oauth/v3/token");
  });

  it("réutilise le jeton tant qu'il n'est pas expiré", async () => {
    let currentTime = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok_1", expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          outboundSMSMessageRequest: { resourceReference: { resourceURL: "https://x/1" } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          outboundSMSMessageRequest: { resourceReference: { resourceURL: "https://x/2" } },
        }),
      );
    const provider = createOrangeSmsProvider(credentials, { fetchImpl, now: () => currentTime });

    await provider.send({
      organizationId: "org_1",
      to: "+2250747218890",
      channel: "SMS",
      body: "1",
      idempotencyKey: "rem:1",
    });
    currentTime += 1000;
    await provider.send({
      organizationId: "org_1",
      to: "+2250747218890",
      channel: "SMS",
      body: "2",
      idempotencyKey: "rem:2",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 token + 2 envois, pas de second appel de token
  });

  it("lève une erreur classée sur un échec HTTP", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok_1", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({}, 400));
    const provider = createOrangeSmsProvider(credentials, { fetchImpl });

    await expect(
      provider.send({
        organizationId: "org_1",
        to: "+2250747218890",
        channel: "SMS",
        body: "x",
        idempotencyKey: "rem:1",
      }),
    ).rejects.toMatchObject({ category: "PERMANENT_RECIPIENT" });
  });
});

describe("classifyOrangeSmsError", () => {
  it.each([
    [429, "RATE_LIMIT"],
    [401, "PERMANENT_CONFIG"],
    [403, "PERMANENT_CONFIG"],
    [400, "PERMANENT_RECIPIENT"],
    [500, "TEMPORARY"],
  ])("classe %s en %s", (status, expected) => {
    expect(classifyOrangeSmsError(status)).toBe(expected);
  });
});

describe("createOrangeSmsProvider.verifyWebhook", () => {
  it("accepte une signature valide", async () => {
    const provider = createOrangeSmsProvider(credentials);
    const body = JSON.stringify({ deliveryInfoNotification: {} });
    const signature = createHmac("sha256", credentials.clientSecret).update(body).digest("hex");
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "x-orange-signature": signature },
      body,
    });
    expect(await provider.verifyWebhook(req)).toBe(true);
  });

  it("rejette une signature absente", async () => {
    const provider = createOrangeSmsProvider(credentials);
    const req = new Request("https://example.com/webhook", { method: "POST", body: "{}" });
    expect(await provider.verifyWebhook(req)).toBe(false);
  });
});

describe("createOrangeSmsProvider.parseWebhook", () => {
  it("convertit un accusé de livraison en ProviderEvent", async () => {
    const provider = createOrangeSmsProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      body: JSON.stringify({
        deliveryInfoNotification: {
          deliveryInfo: { address: "tel:+2250747218890", deliveryStatus: "DeliveredToTerminal" },
        },
      }),
    });
    const events = await provider.parseWebhook(req);
    expect(events).toEqual([
      {
        kind: "status",
        providerMessageId: "tel:+2250747218890",
        status: "DELIVERED",
        occurredAt: expect.any(Date),
      },
    ]);
  });
});
