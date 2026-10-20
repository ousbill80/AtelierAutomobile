import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "./provider";
import { WaveProvider } from "./wave";

const credentials = { apiKey: "wave_sn_prod_SECRET", webhookSecret: "wave_whsec" };

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { impl, calls };
}

const input = {
  invoiceId: "inv_1",
  reference: "FAC-2026-000412",
  amount: 85_000,
  customer: { name: "Kouassi" },
  expiresAt: new Date("2026-10-23T10:00:00Z"),
  returnUrl: "https://app/p/tok/facture",
};

describe("WaveProvider", () => {
  it("crée une session de paiement Wave", async () => {
    const f = fakeFetch([
      { body: { id: "cos-18qq", wave_launch_url: "https://pay.wave.com/c/cos-18qq" } },
    ]);
    const p = new WaveProvider(credentials, f.impl);
    expect(await p.createPaymentLink(input)).toEqual({
      url: "https://pay.wave.com/c/cos-18qq",
      providerRef: "cos-18qq",
    });
    expect(f.calls[0]!.url).toBe("https://api.wave.com/v1/checkout/sessions");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({
      amount: "85000",
      currency: "XOF",
      client_reference: "FAC-2026-000412",
      success_url: input.returnUrl,
      error_url: input.returnUrl,
    });
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      "Bearer wave_sn_prod_SECRET",
    );
  });

  it("refus : message lisible sans la clé ; 5xx transitoire", async () => {
    const refused = new WaveProvider(
      credentials,
      fakeFetch([{ status: 400, body: { message: "Invalid amount" } }]).impl,
    );
    const error = (await refused.createPaymentLink(input).catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/Invalid amount/);
    expect(error.message).not.toContain("SECRET");
    const down = new WaveProvider(credentials, fakeFetch([{ status: 502, body: {} }]).impl);
    await expect(down.getStatus("cos")).rejects.toMatchObject({ transient: true });
  });

  it("statut : payé (montant), expiré, en attente", async () => {
    const p = new WaveProvider(
      credentials,
      fakeFetch([
        {
          body: {
            id: "cos",
            amount: "85000",
            checkout_status: "complete",
            payment_status: "succeeded",
            when_completed: "2026-10-20T10:05:00Z",
          },
        },
        {
          body: {
            id: "cos",
            amount: "85000",
            checkout_status: "expired",
            payment_status: "processing",
          },
        },
        {
          body: {
            id: "cos",
            amount: "85000",
            checkout_status: "open",
            payment_status: "processing",
          },
        },
      ]).impl,
    );
    expect(await p.getStatus("cos")).toEqual({
      status: "PAID",
      amount: 85_000,
      method: "WAVE",
      paidAt: new Date("2026-10-20T10:05:00Z"),
      payerPhone: null,
    });
    expect(await p.getStatus("cos")).toMatchObject({ status: "EXPIRED", amount: null });
    expect(await p.getStatus("cos")).toMatchObject({ status: "PENDING" });
  });

  it("webhook : signature Wave-Signature (horodatage + corps) vérifiée", () => {
    const p = new WaveProvider(credentials);
    const raw = JSON.stringify({
      type: "checkout.session.completed",
      data: {
        id: "cos-18qq",
        amount: "85000",
        checkout_status: "complete",
        payment_status: "succeeded",
      },
    });
    const sig = hmacSha256Hex("wave_whsec", `1639081943${raw}`);
    expect(p.verifyWebhook(raw, new Headers({ "wave-signature": `t=1639081943,v1=${sig}` }))).toBe(
      true,
    );
    expect(p.verifyWebhook(raw, new Headers({ "wave-signature": `t=1639081944,v1=${sig}` }))).toBe(
      false,
    );
    expect(p.verifyWebhook(raw, new Headers())).toBe(false);
    expect(p.parseWebhook(raw)).toMatchObject({
      providerRef: "cos-18qq",
      status: "PAID",
      amount: 85_000,
    });
  });
});
