import { describe, expect, it } from "vitest";
import { CinetPayProvider, cinetPayMethod } from "./cinetpay";
import { hmacSha256Hex } from "./provider";

const credentials = { apiKey: "API-KEY-SECRET", siteId: "105", secretKey: "SECRET-KEY" };

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const next = responses.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { impl, calls };
}

const input = {
  invoiceId: "inv_1",
  reference: "FAC-2026-000412",
  amount: 85_000,
  method: "ORANGE_MONEY" as const,
  customer: { name: "Kouassi Jean-Marc", phone: "+2250747218890" },
  expiresAt: new Date("2026-10-23T10:00:00Z"),
  returnUrl: "https://app/p/tok/facture",
  notifyUrl: "https://app/api/webhooks/payments/cinetpay/org_1",
};

describe("CinetPayProvider", () => {
  it("crée le lien de paiement (XOF, mobile money, notification et retour)", async () => {
    const f = fakeFetch([
      {
        body: { code: "201", data: { payment_token: "t", payment_url: "https://checkout/pay/t" } },
      },
    ]);
    const p = new CinetPayProvider(credentials, f.impl);
    const link = await p.createPaymentLink(input);
    expect(link.url).toBe("https://checkout/pay/t");
    expect(link.providerRef).toMatch(/^FAC-2026-000412-[0-9a-f]{12}$/);
    expect(f.calls[0]!.url).toBe("https://api-checkout.cinetpay.com/v2/payment");
    expect(f.calls[0]!.body).toMatchObject({
      apikey: "API-KEY-SECRET",
      site_id: "105",
      amount: 85_000,
      currency: "XOF",
      channels: "MOBILE_MONEY",
      notify_url: input.notifyUrl,
      return_url: input.returnUrl,
      customer_phone_number: "0747218890",
    });
  });

  it("refus ou indisponibilité : erreur sans la clé", async () => {
    const refused = new CinetPayProvider(
      credentials,
      fakeFetch([{ body: { code: "608", message: "MINIMUM_REQUIRED_FIELDS" } }]).impl,
    );
    await expect(refused.createPaymentLink(input)).rejects.toThrow(/refusé.*MINIMUM/);
    const down = new CinetPayProvider(credentials, fakeFetch([{ status: 503, body: {} }]).impl);
    await expect(down.createPaymentLink(input)).rejects.toMatchObject({ transient: true });
    const offline = new CinetPayProvider(credentials, async () => {
      throw new TypeError("fetch failed");
    });
    const error = (await offline.createPaymentLink(input).catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/injoignable/);
    expect(error.message).not.toContain("API-KEY-SECRET");
  });

  it("statut confirmé par /v2/payment/check", async () => {
    const f = fakeFetch([
      {
        body: {
          code: "00",
          data: {
            status: "ACCEPTED",
            amount: "85000",
            payment_method: "OMCIV2",
            payment_date: "2026-10-20 10:05:00",
          },
        },
      },
      { body: { code: "662", data: { status: "WAITING_CUSTOMER_PAYMENT", amount: "85000" } } },
      { body: { code: "627", data: { status: "REFUSED" } } },
    ]);
    const p = new CinetPayProvider(credentials, f.impl);
    expect(await p.getStatus("ref")).toMatchObject({
      status: "PAID",
      amount: 85_000,
      method: "ORANGE_MONEY",
    });
    expect(f.calls[0]!.body).toMatchObject({ transaction_id: "ref", site_id: "105" });
    expect(await p.getStatus("ref")).toMatchObject({ status: "PENDING" });
    expect(await p.getStatus("ref")).toMatchObject({ status: "FAILED" });
  });

  it("notification : jeton x-token HMAC vérifié, référence lue, statut à relire", () => {
    const p = new CinetPayProvider(credentials);
    const fields = {
      cpm_site_id: "105",
      cpm_trans_id: "FAC-2026-000412-abc",
      cpm_trans_date: "2026-10-20 10:05:00",
      cpm_amount: "85000",
      cpm_currency: "XOF",
      payment_method: "WAVECI",
      cel_phone_num: "0747218890",
    };
    const raw = new URLSearchParams(fields).toString();
    const token = hmacSha256Hex(
      "SECRET-KEY",
      [
        "105",
        "FAC-2026-000412-abc",
        "2026-10-20 10:05:00",
        "85000",
        "XOF",
        "",
        "WAVECI",
        "0747218890",
      ].join(""),
    );
    expect(p.verifyWebhook(raw, new Headers({ "x-token": token }))).toBe(true);
    expect(p.verifyWebhook(raw, new Headers({ "x-token": "0".repeat(64) }))).toBe(false);
    expect(p.parseWebhook(raw)).toMatchObject({
      providerRef: "FAC-2026-000412-abc",
      status: "PENDING",
      amount: 85_000,
      method: "WAVE",
    });
  });

  it("moyens CinetPay → moyens AtelierOS", () => {
    expect(cinetPayMethod("OM")).toBe("ORANGE_MONEY");
    expect(cinetPayMethod("MOMO")).toBe("MTN_MOMO");
    expect(cinetPayMethod("FLOOZ")).toBe("MOOV_MONEY");
    expect(cinetPayMethod("WAVECI")).toBe("WAVE");
    expect(cinetPayMethod("VISAM")).toBe("CARD");
    expect(cinetPayMethod(null)).toBeNull();
  });
});
