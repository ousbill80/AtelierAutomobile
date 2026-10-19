import { describe, expect, it } from "vitest";
import { renderQuotePdf, type QuotePdfData } from "./quote";

const base: QuotePdfData = {
  variant: "customer",
  garage: { name: "Excellence Auto", phone: "+225 27 22 00 00 00", rccm: "CI-ABJ-1", ncc: "123A" },
  number: "DEV-YOP-2026-00017",
  version: 1,
  createdAt: "2026-10-19T09:00:00.000Z",
  validUntil: "2026-11-03",
  customer: { displayName: "Kouassi Jean-Marc" },
  vehicle: { plate: "2547 GH 01", make: "Toyota", model: "Corolla", mileage: 48200 },
  groups: [
    {
      label: "Plaquettes avant",
      priority: "URGENT",
      isOptional: false,
      total: 50740,
      lines: [
        {
          type: "LABOR",
          description: "Remplacement plaquettes AV",
          quantity: 1,
          unitPrice: 15000,
          discountRate: 0,
          total: 17700,
          payer: "CUSTOMER",
          accepted: true,
        },
        {
          type: "PART",
          description: "Jeu de plaquettes AV",
          reference: "PLQ-01",
          quantity: 1,
          unitPrice: 28000,
          discountRate: 0,
          total: 33040,
          payer: "CUSTOMER",
          accepted: true,
        },
      ],
    },
  ],
  totals: {
    subtotal: 43000,
    discountTotal: 0,
    vatTotal: 7740,
    total: 50740,
    insuranceShare: 0,
    customerShare: 50740,
    acceptedTotal: 50740,
  },
  termsText: "Devis valable 15 jours.",
  publicUrl: "http://localhost:3000/p/abc/devis",
};

describe("renderQuotePdf (M05 §7)", () => {
  it("produit les trois variantes", async () => {
    for (const variant of ["customer", "insurer", "signed"] as const) {
      const buffer = await renderQuotePdf({
        ...base,
        variant,
        acceptance:
          variant === "signed"
            ? {
                signerName: "Kouassi Jean-Marc",
                decidedAt: "20/10/2026 à 10:42",
                channel: "portal",
                hash: "3f9a0c0d1e2f3a4b5c",
                ip: "41.202.10.0",
              }
            : null,
      });
      expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    }
  });
});
