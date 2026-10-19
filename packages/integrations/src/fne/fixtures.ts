import type { FneInvoicePayload } from "@atelieros/core";

/** Payload FNE minimal pour les tests des adaptateurs. */
export function samplePayload(overrides: Partial<FneInvoicePayload> = {}): FneInvoicePayload {
  return {
    invoiceId: "inv_1",
    idempotencyKey: "inv_1",
    documentType: "INVOICE",
    number: "FAC-2026-000123",
    issuedAt: new Date("2026-10-19T10:00:00Z"),
    seller: {
      ncc: "1912345A",
      legalName: "Garage Yopougon SARL",
      taxRegime: "RNI",
      establishmentId: null,
      pointOfSale: null,
    },
    customer: {
      name: "Kouassi Jean-Marc",
      type: "INDIVIDUAL",
      ncc: null,
      rccm: null,
      phone: null,
      address: null,
    },
    lines: [
      {
        description: "MO Vidange",
        quantity: 1,
        unitPrice: 15_000,
        discountRate: 0,
        vatRate: 18,
        totalHt: 15_000,
        totalVat: 2_700,
        totalTtc: 17_700,
      },
    ],
    totals: { subtotal: 15_000, discountTotal: 0, vatTotal: 2_700, total: 17_700 },
    paymentMethod: null,
    originalInvoice: null,
    ...overrides,
  };
}
