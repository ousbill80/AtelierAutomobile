import { verifyWebhookSignatureHeader } from "@atelieros/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  FakeWebhookSender,
  generateApiKey,
  generateWebhookSecret,
  HttpWebhookSender,
  requestFingerprint,
  resolveWebhookSender,
  sha256Hex,
  signWebhook,
  webhookHmac,
} from "./index";

const now = new Date("2026-10-20T10:00:00Z");
const req = (url: string) => ({
  url,
  body: '{"a":1}',
  headers: { "content-type": "application/json" },
  timeoutMs: 10_000,
});

afterEach(() => FakeWebhookSender.reset());

describe("signature des webhooks (RG-M13-39)", () => {
  it("vérifiable par le destinataire, double signature pendant la rotation", () => {
    const header = signWebhook(["whsec_new", "whsec_old"], '{"a":1}', now);
    const t = Math.floor(now.getTime() / 1000);
    expect(header).toMatch(new RegExp(`^t=${t},v1=[0-9a-f]{64},v1=[0-9a-f]{64}$`));
    for (const secret of ["whsec_new", "whsec_old"]) {
      expect(
        verifyWebhookSignatureHeader({
          header,
          nowSeconds: t + 10,
          expected: (ts) => webhookHmac(secret, ts, '{"a":1}'),
        }),
      ).toBe(true);
    }
    expect(
      verifyWebhookSignatureHeader({
        header,
        nowSeconds: t,
        expected: (ts) => webhookHmac("autre", ts, '{"a":1}'),
      }),
    ).toBe(false);
  });

  it("secrets, clés et empreintes", () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateApiKey("live")).toMatch(/^ak_live_[0-9A-Za-z]{32}$/);
    expect(generateApiKey("live")).not.toBe(generateApiKey("live"));
    expect(sha256Hex("x")).toHaveLength(64);
    expect(requestFingerprint("post", "/api/v1/customers", "{}")).toBe(
      requestFingerprint("POST", "/api/v1/customers", "{}"),
    );
    expect(requestFingerprint("POST", "/api/v1/customers", "{}")).not.toBe(
      requestFingerprint("POST", "/api/v1/customers", '{"a":1}'),
    );
  });
});

describe("HttpWebhookSender (anti-SSRF)", () => {
  it("refuse un nom résolu vers une IP privée sans appeler le réseau", async () => {
    let called = false;
    const sender = new HttpWebhookSender(
      async () => {
        called = true;
        return new Response("ok");
      },
      async () => ["10.0.0.8"],
    );
    expect(await sender.send(req("https://erp.garage.ci/hook"))).toMatchObject({
      status: null,
      error: "Adresse interne refusée.",
    });
    expect(called).toBe(false);
  });

  it("envoie en POST sans suivre les redirections ; code et corps renvoyés", async () => {
    let init: RequestInit | undefined;
    const sender = new HttpWebhookSender(
      async (_url, i) => {
        init = i;
        return new Response("reçu", { status: 202 });
      },
      async () => ["41.202.10.77"],
    );
    expect(await sender.send(req("https://erp.garage.ci/hook"))).toEqual({
      status: 202,
      body: "reçu",
      error: null,
    });
    expect(init).toMatchObject({ method: "POST", redirect: "manual", body: '{"a":1}' });
  });

  it("réseau ou délai : pas de code, erreur lisible ; http refusé", async () => {
    const down = new HttpWebhookSender(
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => ["41.202.10.77"],
    );
    expect(await down.send(req("https://erp.garage.ci/hook"))).toMatchObject({
      status: null,
      error: "Destinataire injoignable.",
    });
    expect(await down.send(req("http://erp.garage.ci/hook"))).toMatchObject({
      error: "https obligatoire.",
    });
  });
});

describe("FakeWebhookSender", () => {
  it("enregistre les livraisons, réponse configurable", async () => {
    const sender = new FakeWebhookSender(() => now);
    expect(await sender.send(req("https://hooks.example.com/a"))).toMatchObject({ status: 200 });
    FakeWebhookSender.respondWith(() => ({ status: 503, body: "busy", error: null }));
    expect(await sender.send(req("https://hooks.example.com/a"))).toMatchObject({ status: 503 });
    expect(FakeWebhookSender.records()).toHaveLength(2);
  });

  it("choix du transport : fake hors production, interdit en production", () => {
    expect(resolveWebhookSender({ APP_ENV: "development" }).name).toBe("fake");
    expect(resolveWebhookSender({ APP_ENV: "production" }).name).toBe("http");
    expect(() => resolveWebhookSender({ APP_ENV: "production", WEBHOOK_SENDER: "fake" })).toThrow();
  });
});
