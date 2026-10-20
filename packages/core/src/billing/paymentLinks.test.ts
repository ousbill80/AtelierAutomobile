import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import { billingSettingsFrom } from "./settings";
import {
  checkPaymentLink,
  invoicePortalExpiry,
  invoiceSendBlocker,
  isConfirmationOverdue,
  isInvoicePayable,
  linkPaymentAllocation,
  paymentMismatchMessage,
  planPaymentLink,
  portalPaymentMethods,
  reconcileWindowStart,
} from "./paymentLinks";

const now = new Date("2026-10-20T10:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);
const open = { status: "PARTIALLY_PAID", balance: 85_000 };

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return isDomainError(error) ? error.code : "other";
  }
  return undefined;
}

describe("planPaymentLink (RG-M08-23)", () => {
  it("lien du solde, expiration 72 h par défaut", () => {
    expect(planPaymentLink({ invoice: open, reuse: false, openLinks: [], now })).toEqual({
      action: "create",
      amount: 85_000,
      expiresAt: hours(72),
      replaceIds: [],
    });
  });

  it("montant modifiable vers le bas seulement, durée bornée", () => {
    expect(
      planPaymentLink({
        invoice: open,
        amount: 50_000,
        expiresInHours: 24,
        reuse: false,
        openLinks: [],
        now,
      }),
    ).toMatchObject({ amount: 50_000, expiresAt: hours(24) });
    const plan = (amount: number) => () =>
      planPaymentLink({ invoice: open, amount, reuse: false, openLinks: [], now });
    expect(code(plan(90_000))).toBe("payment_link.invalid_amount");
    expect(code(plan(0))).toBe("payment_link.invalid_amount");
    expect(code(plan(10.5))).toBe("payment_link.invalid_amount");
    expect(
      code(() =>
        planPaymentLink({ invoice: open, expiresInHours: 0, reuse: false, openLinks: [], now }),
      ),
    ).toBe("payment_link.invalid_expiry");
    expect(
      code(() =>
        planPaymentLink({ invoice: open, expiresInHours: 721, reuse: false, openLinks: [], now }),
      ),
    ).toBe("payment_link.invalid_expiry");
  });

  it("facture soldée, annulée, en litige ou brouillon : pas de lien", () => {
    for (const invoice of [
      { status: "PAID", balance: 0 },
      { status: "VOID", balance: 85_000 },
      { status: "DISPUTED", balance: 85_000 },
      { status: "WRITTEN_OFF", balance: 85_000 },
      { status: "DRAFT", balance: 85_000 },
    ]) {
      expect(code(() => planPaymentLink({ invoice, reuse: false, openLinks: [], now }))).toBe(
        "payment_link.not_payable",
      );
    }
  });

  const links = [
    { id: "old", amount: 85_000, status: "PENDING", expiresAt: hours(5), method: null },
    { id: "wave", amount: 85_000, status: "PENDING", expiresAt: hours(5), method: "WAVE" },
    { id: "part", amount: 20_000, status: "PENDING", expiresAt: hours(5), method: null },
    { id: "gone", amount: 85_000, status: "PENDING", expiresAt: hours(-1), method: null },
    { id: "paid", amount: 85_000, status: "CONFIRMED", expiresAt: hours(5), method: null },
  ];

  it("conseiller : un nouveau lien remplace l'ancien lien actif du même montant", () => {
    expect(planPaymentLink({ invoice: open, reuse: false, openLinks: links, now })).toMatchObject({
      action: "create",
      replaceIds: ["old", "wave"],
    });
  });

  it("portail : lien en attente du même montant et du même moyen réutilisé (RG-M14-14)", () => {
    expect(
      planPaymentLink({ invoice: open, method: "WAVE", reuse: true, openLinks: links, now }),
    ).toEqual({ action: "reuse", linkId: "wave" });
    expect(
      planPaymentLink({ invoice: open, method: "MTN_MOMO", reuse: true, openLinks: links, now }),
    ).toMatchObject({ action: "create", replaceIds: ["old", "wave"] });
    // Un lien expiré n'est jamais réutilisé.
    expect(
      planPaymentLink({ invoice: open, reuse: true, openLinks: [links[3]!], now }),
    ).toMatchObject({ action: "create", replaceIds: [] });
  });
});

describe("checkPaymentLink (RG-M08-24/25)", () => {
  const link = { amount: 85_000, expiresAt: hours(72) };

  it("payé : montant réellement confirmé, écart signalé", () => {
    expect(checkPaymentLink({ link, provider: { status: "PAID", amount: 85_000 }, now })).toEqual({
      action: "confirm",
      amount: 85_000,
      mismatch: false,
    });
    expect(checkPaymentLink({ link, provider: { status: "PAID", amount: 80_000 }, now })).toEqual({
      action: "confirm",
      amount: 80_000,
      mismatch: true,
    });
    expect(checkPaymentLink({ link, provider: { status: "PAID" }, now })).toMatchObject({
      amount: 85_000,
    });
    expect(
      code(() => checkPaymentLink({ link, provider: { status: "PAID", amount: -5 }, now })),
    ).toBe("payment_link.invalid_confirmed_amount");
  });

  it("échec, expiration chez le fournisseur ou 24 h après l'expiration : FAILED", () => {
    expect(checkPaymentLink({ link, provider: { status: "FAILED" }, now })).toEqual({
      action: "fail",
      reason: "failed",
    });
    expect(checkPaymentLink({ link, provider: { status: "EXPIRED" }, now })).toEqual({
      action: "fail",
      reason: "expired",
    });
    const expired = { amount: 85_000, expiresAt: hours(-23) };
    expect(checkPaymentLink({ link: expired, provider: { status: "PENDING" }, now })).toEqual({
      action: "keep",
    });
    const old = { amount: 85_000, expiresAt: hours(-24) };
    expect(checkPaymentLink({ link: old, provider: { status: "PENDING" }, now })).toEqual({
      action: "fail",
      reason: "expired",
    });
  });

  it("fenêtre de rapprochement : expirés depuis moins de 24 h", () => {
    expect(reconcileWindowStart(now)).toEqual(hours(-24));
  });
});

describe("linkPaymentAllocation (RG-M08-24 étape 5)", () => {
  it("solde 85 000, paiement 85 000 : tout affecté", () => {
    expect(linkPaymentAllocation({ amount: 85_000, invoiceBalance: 85_000 })).toEqual({
      allocated: 85_000,
      unallocated: 0,
      probableDuplicate: false,
    });
  });
  it("trop-perçu : 90 000 sur 85 000 → 5 000 non affectés", () => {
    expect(linkPaymentAllocation({ amount: 90_000, invoiceBalance: 85_000 })).toMatchObject({
      allocated: 85_000,
      unallocated: 5_000,
    });
  });
  it("facture déjà soldée (payée en espèces) : paiement en double probable", () => {
    expect(linkPaymentAllocation({ amount: 85_000, invoiceBalance: 0 })).toEqual({
      allocated: 0,
      unallocated: 85_000,
      probableDuplicate: true,
    });
  });
  it("message d'écart en FCFA", () => {
    expect(paymentMismatchMessage(85_000, 80_000)).toContain("80 000 FCFA");
  });
});

describe("portail facture (M14)", () => {
  it("moyens proposés : union des fournisseurs actifs, ordre Wave, OM, MTN, Moov, Carte", () => {
    expect(
      portalPaymentMethods([
        { methods: ["CARD", "MTN_MOMO", "ORANGE_MONEY"] },
        { methods: ["WAVE", "CASH"] },
      ]),
    ).toEqual(["WAVE", "ORANGE_MONEY", "MTN_MOMO", "CARD"]);
    expect(portalPaymentMethods([])).toEqual([]);
  });

  it("bouton payer : solde > 0 et facture ouverte (RG-M14-14)", () => {
    expect(isInvoicePayable({ status: "ISSUED", balance: 185_000 })).toBe(true);
    expect(isInvoicePayable({ status: "OVERDUE", balance: 1 })).toBe(true);
    expect(isInvoicePayable({ status: "PAID", balance: 0 })).toBe(false);
    expect(isInvoicePayable({ status: "DISPUTED", balance: 185_000 })).toBe(false);
  });

  it("expiration du lien : 180 j après émission, 30 j après paiement complet (RG-M14-03)", () => {
    expect(invoicePortalExpiry({ issuedAt: now })).toEqual(hours(180 * 24));
    expect(invoicePortalExpiry({ issuedAt: now, paidAt: hours(48) })).toEqual(hours(48 + 30 * 24));
  });

  it("2 min sans confirmation : message « ne repayez pas » (RG-M14-15)", () => {
    expect(isConfirmationOverdue(now, new Date(now.getTime() + 119_000))).toBe(false);
    expect(isConfirmationOverdue(now, new Date(now.getTime() + 120_000))).toBe(true);
  });
});

describe("invoiceSendBlocker (US-M08-14)", () => {
  it("brouillon et facture annulée non envoyables", () => {
    expect(
      invoiceSendBlocker({ status: "DRAFT", fneStatus: "PENDING", blockSendUntilCertified: false }),
    ).toMatch(/Émettez/);
    expect(
      invoiceSendBlocker({
        status: "VOID",
        fneStatus: "CERTIFIED",
        blockSendUntilCertified: false,
      }),
    ).toMatch(/annulée/);
  });
  it("FNE en attente : envoi autorisé par défaut, bloqué si paramétré (RG-M08-16)", () => {
    expect(
      invoiceSendBlocker({
        status: "ISSUED",
        fneStatus: "PENDING",
        blockSendUntilCertified: false,
      }),
    ).toBeNull();
    expect(
      invoiceSendBlocker({ status: "ISSUED", fneStatus: "PENDING", blockSendUntilCertified: true }),
    ).toMatch(/certifiée/);
    expect(
      invoiceSendBlocker({ status: "PAID", fneStatus: "MANUAL", blockSendUntilCertified: true }),
    ).toBeNull();
  });
});

describe("numéros marchands (RG-M15-17)", () => {
  it("lus dans settings.payments.merchantNumbers, vides par défaut", () => {
    expect(billingSettingsFrom({}).merchantNumbers).toEqual({
      wave: null,
      orangeMoney: null,
      mtn: null,
      moov: null,
    });
    expect(
      billingSettingsFrom({ payments: { merchantNumbers: { wave: " +2250700000000 ", mtn: "" } } })
        .merchantNumbers,
    ).toMatchObject({ wave: "+2250700000000", mtn: null });
  });
});

describe("messages client", () => {
  it("reçu : montant, facture et reste à payer", async () => {
    const { paymentReceiptMessage } = await import("./paymentLinks");
    expect(
      paymentReceiptMessage({
        garageName: "Garage Yopougon",
        paymentNumber: "REC-2026-000310",
        amount: 85_000,
        invoiceNumber: "FAC-2026-000412",
        balanceAfter: 0,
      }),
    ).toBe(
      "Garage Yopougon — reçu REC-2026-000310 : 85 000 FCFA reçus pour la facture FAC-2026-000412. Votre facture est soldée. Merci !",
    );
    expect(
      paymentReceiptMessage({
        garageName: "G",
        paymentNumber: "REC-1",
        amount: 100_000,
        invoiceNumber: "FAC-1",
        balanceAfter: 85_000,
      }),
    ).toContain("Reste à payer : 85 000 FCFA.");
  });

  it("envoi de facture : lien portail et lien de paiement si solde dû", async () => {
    const { invoiceSendMessage } = await import("./paymentLinks");
    const text = invoiceSendMessage({
      customerName: "M. Kouassi",
      garageName: "Garage Yopougon",
      invoiceNumber: "FAC-2026-000412",
      total: 185_000,
      balance: 185_000,
      portalUrl: "https://app/p/tok/facture",
      paymentUrl: "https://pay/x",
    });
    expect(text).toContain("FAC-2026-000412 de 185 000 FCFA");
    expect(text).toContain("payez-la ici : https://app/p/tok/facture");
    expect(text).toContain("Payer 185 000 FCFA par mobile money : https://pay/x");
    const paid = invoiceSendMessage({
      customerName: "M. Kouassi",
      garageName: "G",
      invoiceNumber: "FAC-1",
      total: 1000,
      balance: 0,
      portalUrl: "https://app/p/t/facture",
    });
    expect(paid).not.toContain("payez");
    expect(paid).not.toContain("Reste");
  });
});
