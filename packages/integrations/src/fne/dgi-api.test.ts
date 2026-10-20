import { describe, expect, it } from "vitest";
import { DgiApiFneProvider, type FetchLike } from "./dgi-api";
import { samplePayload } from "./fixtures";

const credentials = { baseUrl: "https://fne.example.test/api/", apiKey: "sk_test_secret" };

function fakeFetch(
  status: number,
  body: unknown,
  calls: { url: string; init: RequestInit }[] = [],
) {
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return impl;
}

describe("DgiApiFneProvider", () => {
  it("envoie le payload traduit avec la clé d'idempotence et lit le certificat", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = new DgiApiFneProvider(
      credentials,
      fakeFetch(
        200,
        { fneNumber: "FNE-0001", qrCode: "https://dgi/qr/1", signedAt: "2026-10-19T10:01:00Z" },
        calls,
      ),
    );
    const result = await provider.certify(samplePayload());
    expect(result).toMatchObject({
      fneNumber: "FNE-0001",
      qrCode: "https://dgi/qr/1",
      signedAt: new Date("2026-10-19T10:01:00Z"),
    });
    expect(calls[0]!.url).toBe("https://fne.example.test/api/invoices/certify");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("inv_1");
    expect(headers.authorization).toBe("Bearer sk_test_secret");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      invoiceType: "sale",
      reference: "FAC-2026-000123",
      totals: { ttc: 17_700 },
    });
  });

  it("avoir : type remboursement et référence de la facture d'origine", () => {
    const provider = new DgiApiFneProvider(credentials, fakeFetch(200, {}));
    const body = provider.toDgiBody(
      samplePayload({
        documentType: "CREDIT_NOTE",
        originalInvoice: { number: "FAC-2026-000100", fneNumber: "FNE-0100" },
      }),
    );
    expect(body).toMatchObject({
      invoiceType: "refund",
      originalInvoice: { reference: "FAC-2026-000100", fneNumber: "FNE-0100" },
    });
  });

  it("5xx / 429 → transitoire ; 4xx → rejet ; réseau → transitoire, sans divulguer la clé", async () => {
    await expect(
      new DgiApiFneProvider(credentials, fakeFetch(503, {})).certify(samplePayload()),
    ).rejects.toMatchObject({ kind: "transient" });
    await expect(
      new DgiApiFneProvider(credentials, fakeFetch(429, {})).certify(samplePayload()),
    ).rejects.toMatchObject({ kind: "transient" });
    await expect(
      new DgiApiFneProvider(
        credentials,
        fakeFetch(422, { message: "NCC client invalide" }),
      ).certify(samplePayload()),
    ).rejects.toMatchObject({ kind: "rejected", message: "NCC client invalide" });
    const failing = new DgiApiFneProvider(credentials, async () => {
      throw new TypeError("fetch failed sk_test_secret");
    });
    const error = await failing.certify(samplePayload()).catch((e: Error) => e);
    expect(error).toMatchObject({ kind: "transient" });
    expect((error as Error).message).not.toContain("sk_test_secret");
  });

  it("réponse incomplète → transitoire ; healthCheck lit le statut d'authentification", async () => {
    await expect(
      new DgiApiFneProvider(credentials, fakeFetch(200, { fneNumber: "x" })).certify(
        samplePayload(),
      ),
    ).rejects.toMatchObject({ kind: "transient" });
    await expect(
      new DgiApiFneProvider(credentials, fakeFetch(200, {})).healthCheck(),
    ).resolves.toEqual({
      ok: true,
      detail: "Identifiants DGI acceptés.",
    });
    await expect(
      new DgiApiFneProvider(credentials, fakeFetch(401, {})).healthCheck(),
    ).resolves.toMatchObject({ ok: false, detail: expect.stringMatching(/refusés/) });
  });
});
