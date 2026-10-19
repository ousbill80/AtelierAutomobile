import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyTwilioError, createTwilioProvider } from "./twilio";

const credentials = { accountSid: "AC123", authToken: "auth_token", senderId: "+12025550123" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createTwilioProvider.send", () => {
  it("envoie un SMS en Basic Auth et form-urlencoded", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ sid: "SM123" }));
    const provider = createTwilioProvider(credentials, { fetchImpl });

    const result = await provider.send({
      organizationId: "org_1",
      to: "+2250747218890",
      channel: "SMS",
      body: "Bonjour",
      idempotencyKey: "rem:1",
    });

    expect(result).toEqual({ providerMessageId: "SM123" });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("AC123:auth_token").toString("base64")}`,
    );
    const params = new URLSearchParams(init.body);
    expect(params.get("To")).toBe("+2250747218890");
    expect(params.get("Body")).toBe("Bonjour");
  });

  it("lève une erreur classée pour un numéro invalide (21211)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 21211, message: "Invalid To" }, 400));
    const provider = createTwilioProvider(credentials, { fetchImpl });

    await expect(
      provider.send({
        organizationId: "org_1",
        to: "123",
        channel: "SMS",
        body: "x",
        idempotencyKey: "rem:1",
      }),
    ).rejects.toMatchObject({ category: "PERMANENT_RECIPIENT", providerCode: "21211" });
  });
});

describe("classifyTwilioError", () => {
  it.each([
    [21211, "PERMANENT_RECIPIENT"],
    [21614, "PERMANENT_RECIPIENT"],
    [21610, "PERMANENT_RECIPIENT"],
    [20003, "PERMANENT_CONFIG"],
    [20404, "PERMANENT_CONFIG"],
    [429, "RATE_LIMIT"],
    [14107, "RATE_LIMIT"],
    [99999, "TEMPORARY"],
  ])("classe %s en %s", (code, expected) => {
    expect(classifyTwilioError(code)).toBe(expected);
  });
});

describe("createTwilioProvider.verifyWebhook", () => {
  it("accepte une signature X-Twilio-Signature valide", async () => {
    const provider = createTwilioProvider(credentials);
    const url = "https://example.com/webhook";
    const bodyParams = new URLSearchParams({ MessageSid: "SM1", MessageStatus: "delivered" });
    const sortedKeys = [...bodyParams.keys()].sort();
    const data = sortedKeys.reduce((acc, key) => acc + key + bodyParams.get(key), url);
    const signature = createHmac("sha1", credentials.authToken).update(data).digest("base64");

    const req = new Request(url, {
      method: "POST",
      headers: { "x-twilio-signature": signature },
      body: bodyParams.toString(),
    });
    expect(await provider.verifyWebhook(req)).toBe(true);
  });

  it("rejette une signature absente", async () => {
    const provider = createTwilioProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      body: "MessageSid=SM1",
    });
    expect(await provider.verifyWebhook(req)).toBe(false);
  });
});

describe("createTwilioProvider.parseWebhook", () => {
  it("convertit un accusé de statut en ProviderEvent", async () => {
    const provider = createTwilioProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      body: new URLSearchParams({ MessageSid: "SM1", MessageStatus: "delivered" }).toString(),
    });
    const events = await provider.parseWebhook(req);
    expect(events).toEqual([
      {
        kind: "status",
        providerMessageId: "SM1",
        status: "DELIVERED",
        occurredAt: expect.any(Date),
      },
    ]);
  });

  it("convertit un SMS entrant en ProviderEvent", async () => {
    const provider = createTwilioProvider(credentials);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      body: new URLSearchParams({ From: "+2250747218890", Body: "Oui samedi matin" }).toString(),
    });
    const events = await provider.parseWebhook(req);
    expect(events).toEqual([
      {
        kind: "inbound",
        from: "+2250747218890",
        body: "Oui samedi matin",
        occurredAt: expect.any(Date),
      },
    ]);
  });
});
