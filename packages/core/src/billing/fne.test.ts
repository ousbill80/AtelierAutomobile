import { describe, expect, it } from "vitest";
import {
  assertCanRetryFne,
  assertFneConfigChange,
  buildFnePayload,
  classifyFneError,
  fneRetryDelayMs,
  isFneAlertDue,
  isFneRetryDue,
  planFneFailure,
  validateManualFne,
  type BuildFnePayloadInput,
} from "./fne";

const NOW = new Date("2026-10-19T10:00:00.000Z");
const MIN = 60_000;

function invoiceInput(overrides: Partial<BuildFnePayloadInput> = {}): BuildFnePayloadInput {
  return {
    invoice: {
      id: "inv_1",
      type: "INVOICE",
      number: "FAC-2026-000412",
      issuedAt: NOW,
      subtotal: 109_305,
      discountTotal: 475,
      vatTotal: 19_676,
      total: 128_981,
    },
    lines: [
      {
        description: "MO Vidange moteur",
        quantity: 1,
        unitPrice: 15_000,
        discountRate: 0,
        vatRate: 18,
        lineSubtotal: 15_000,
        lineVat: 2_700,
        lineTotal: 17_700,
      },
    ],
    organization: {
      legalName: "Garage Yopougon SARL",
      name: "Garage Yopougon",
      ncc: "1912345A",
      taxRegime: "RNI",
      establishmentId: "ETB-01",
      pointOfSale: "PDV-01",
    },
    customer: {
      displayName: "Kouassi Jean-Marc",
      type: "INDIVIDUAL",
      ncc: null,
      rccm: null,
      phone: "+2250707070707",
      address: null,
    },
    ...overrides,
  };
}

describe("buildFnePayload (RG-M08-14)", () => {
  it("construit le payload neutre d'une facture (émetteur, client, lignes, totaux, idempotence)", () => {
    const payload = buildFnePayload(invoiceInput());
    expect(payload).toMatchObject({
      invoiceId: "inv_1",
      idempotencyKey: "inv_1",
      documentType: "INVOICE",
      number: "FAC-2026-000412",
      seller: { ncc: "1912345A", legalName: "Garage Yopougon SARL", establishmentId: "ETB-01" },
      customer: { name: "Kouassi Jean-Marc", type: "INDIVIDUAL" },
      totals: { subtotal: 109_305, vatTotal: 19_676, total: 128_981 },
      originalInvoice: null,
    });
    expect(payload.lines[0]).toEqual({
      description: "MO Vidange moteur",
      quantity: 1,
      unitPrice: 15_000,
      discountRate: 0,
      vatRate: 18,
      totalHt: 15_000,
      totalVat: 2_700,
      totalTtc: 17_700,
    });
  });

  it("avoir : montants en valeur absolue et référence FNE de la facture d'origine", () => {
    const payload = buildFnePayload(
      invoiceInput({
        invoice: {
          id: "av_1",
          type: "CREDIT_NOTE",
          number: "AV-2026-000014",
          issuedAt: NOW,
          subtotal: -15_000,
          discountTotal: 0,
          vatTotal: -2_700,
          total: -17_700,
        },
        lines: [
          {
            description: "MO Vidange moteur",
            quantity: -1,
            unitPrice: 15_000,
            discountRate: 0,
            vatRate: 18,
            lineSubtotal: -15_000,
            lineVat: -2_700,
            lineTotal: -17_700,
          },
        ],
        originalInvoice: { number: "FAC-2026-000412", fneNumber: "FNE-123" },
      }),
    );
    expect(payload.documentType).toBe("CREDIT_NOTE");
    expect(payload.totals.total).toBe(17_700);
    expect(payload.lines[0]!.quantity).toBe(1);
    expect(payload.lines[0]!.totalTtc).toBe(17_700);
    expect(payload.originalInvoice).toEqual({ number: "FAC-2026-000412", fneNumber: "FNE-123" });
  });

  it("refuse un avoir dont la facture d'origine n'est pas certifiée", () => {
    expect(() =>
      buildFnePayload(
        invoiceInput({
          invoice: { ...invoiceInput().invoice, type: "CREDIT_NOTE" },
          originalInvoice: { number: "FAC-2026-000412", fneNumber: null },
        }),
      ),
    ).toThrow(/facture d'origine/);
  });

  it("refuse un brouillon et une organisation sans NCC", () => {
    expect(() =>
      buildFnePayload(invoiceInput({ invoice: { ...invoiceInput().invoice, number: null } })),
    ).toThrow(/émise/);
    expect(() =>
      buildFnePayload(
        invoiceInput({ organization: { ...invoiceInput().organization, ncc: null } }),
      ),
    ).toThrow(/NCC/);
  });

  it("raison sociale absente → nom commercial ; client entreprise", () => {
    const payload = buildFnePayload(
      invoiceInput({
        organization: { ...invoiceInput().organization, legalName: null },
        customer: { ...invoiceInput().customer, type: "COMPANY", ncc: "2001234B" },
      }),
    );
    expect(payload.seller.legalName).toBe("Garage Yopougon");
    expect(payload.customer).toMatchObject({ type: "COMPANY", ncc: "2001234B" });
  });
});

describe("reprises FNE (RG-M08-15)", () => {
  it("backoff 10 min, 30 min, 1 h, 2 h puis toutes les 6 h", () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => fneRetryDelayMs(n) / MIN)).toEqual([
      10, 30, 60, 120, 360, 360,
    ]);
    expect(fneRetryDelayMs(0)).toBe(0);
  });

  it("échec transitoire → FAILED avec prochaine tentative ; rejet → pas de reprise auto", () => {
    expect(planFneFailure({ attempts: 2, kind: "transient", message: "x", now: NOW })).toEqual({
      fneStatus: "FAILED",
      fneErrorKind: "transient",
      fneError: "x",
      fneNextRetryAt: new Date(NOW.getTime() + 30 * MIN),
    });
    expect(
      planFneFailure({ attempts: 1, kind: "rejected", message: "NCC client invalide", now: NOW })
        .fneNextRetryAt,
    ).toBeNull();
  });

  it("classe les erreurs d'adaptateur en français", () => {
    const rejected = Object.assign(new Error("NCC client invalide"), { kind: "rejected" });
    expect(classifyFneError(rejected)).toEqual({
      kind: "rejected",
      message: "Rejet de la DGI : NCC client invalide",
    });
    expect(classifyFneError(new Error("ECONNRESET"))).toMatchObject({ kind: "transient" });
    expect(classifyFneError("timeout").message).toMatch(/nouvelle tentative automatique/);
  });

  it("isFneRetryDue : en attente ou échec transitoire arrivé à échéance seulement", () => {
    const base = {
      status: "ISSUED",
      fneStatus: "FAILED" as const,
      fneErrorKind: "transient",
      fneNextRetryAt: new Date(NOW.getTime() - 1),
    };
    expect(isFneRetryDue(base, NOW)).toBe(true);
    expect(isFneRetryDue({ ...base, fneNextRetryAt: new Date(NOW.getTime() + MIN) }, NOW)).toBe(
      false,
    );
    expect(isFneRetryDue({ ...base, fneErrorKind: "rejected" }, NOW)).toBe(false);
    expect(isFneRetryDue({ ...base, fneStatus: "CERTIFIED" }, NOW)).toBe(false);
    expect(isFneRetryDue({ ...base, fneStatus: "PENDING", fneErrorKind: null }, NOW)).toBe(true);
    expect(isFneRetryDue({ ...base, fneNextRetryAt: null }, NOW)).toBe(false);
    expect(isFneRetryDue({ ...base, status: "DRAFT" }, NOW)).toBe(false);
  });

  it("« Réessayer » demande une facture non certifiée et le mode API", () => {
    expect(() =>
      assertCanRetryFne({ status: "ISSUED", fneStatus: "FAILED", mode: "api" }),
    ).not.toThrow();
    expect(() =>
      assertCanRetryFne({ status: "ISSUED", fneStatus: "CERTIFIED", mode: "api" }),
    ).toThrow(/pas en attente/);
    expect(() =>
      assertCanRetryFne({ status: "ISSUED", fneStatus: "PENDING", mode: "manual" }),
    ).toThrow(/mode FNE « API »/);
  });
});

describe("saisie manuelle (RG-M08-17)", () => {
  const pending = { status: "ISSUED", fneStatus: "PENDING" as const };

  it("numéro obligatoire et QR (contenu ou image)", () => {
    expect(
      validateManualFne(pending, { fneNumber: "  FNE-2026-0001 ", qrCode: " https://x " }),
    ).toEqual({ fneNumber: "FNE-2026-0001", qrCode: "https://x" });
    expect(validateManualFne(pending, { fneNumber: "FNE-1", hasQrImage: true })).toEqual({
      fneNumber: "FNE-1",
      qrCode: null,
    });
    expect(() => validateManualFne(pending, { fneNumber: "FNE-1" })).toThrow(/QR code/);
    expect(() => validateManualFne(pending, { fneNumber: " a ", qrCode: "x" })).toThrow(
      /numéro FNE/,
    );
  });

  it("FAILED → MANUAL autorisé ; CERTIFIED / MANUAL finaux ; brouillon et NOT_REQUIRED refusés", () => {
    expect(() =>
      validateManualFne(
        { status: "ISSUED", fneStatus: "FAILED" },
        { fneNumber: "FNE-1", qrCode: "q" },
      ),
    ).not.toThrow();
    for (const fneStatus of ["CERTIFIED", "MANUAL"] as const) {
      expect(() =>
        validateManualFne({ status: "PAID", fneStatus }, { fneNumber: "FNE-1", qrCode: "q" }),
      ).toThrow(/déjà certifiée/);
    }
    expect(() =>
      validateManualFne(
        { status: "DRAFT", fneStatus: "PENDING" },
        { fneNumber: "FNE-1", qrCode: "q" },
      ),
    ).toThrow(/Émettez/);
    expect(() =>
      validateManualFne(
        { status: "ISSUED", fneStatus: "NOT_REQUIRED" },
        { fneNumber: "FNE-1", qrCode: "q" },
      ),
    ).toThrow(/pas requise/);
  });
});

describe("signalement et paramètres (RG-M08-16, RG-M15-18)", () => {
  it("alerte au-delà d'1 h sans certification", () => {
    const inv = {
      status: "ISSUED",
      fneStatus: "PENDING" as const,
      issuedAt: new Date(NOW.getTime() - 61 * MIN),
    };
    expect(isFneAlertDue(inv, NOW)).toBe(true);
    expect(isFneAlertDue({ ...inv, issuedAt: new Date(NOW.getTime() - 60 * MIN) }, NOW)).toBe(
      false,
    );
    expect(isFneAlertDue({ ...inv, fneStatus: "MANUAL" }, NOW)).toBe(false);
    expect(isFneAlertDue({ ...inv, status: "DRAFT" }, NOW)).toBe(false);
  });

  it("désactivation avec motif, mode API avec identifiants", () => {
    expect(() =>
      assertFneConfigChange({ from: "manual", to: "disabled", hasCredentials: false }),
    ).toThrow(/arrêté n°0337/);
    expect(() =>
      assertFneConfigChange({
        from: "manual",
        to: "disabled",
        reason: "Essai",
        hasCredentials: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertFneConfigChange({ from: "disabled", to: "disabled", hasCredentials: false }),
    ).not.toThrow();
    expect(() =>
      assertFneConfigChange({ from: "manual", to: "api", hasCredentials: false }),
    ).toThrow(/identifiants DGI/);
  });
});
