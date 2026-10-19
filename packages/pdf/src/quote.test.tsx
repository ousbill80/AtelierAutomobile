import { describe, expect, it } from "vitest";
import { renderQuotePdf, type QuotePdfData } from "./quote";

const base: QuotePdfData = {
  variant: "customer",
  garage: { name: "Garage Excellence Auto", phone: "+225 27 22 00 00 00", rccm: "CI-ABJ-2015-B-12345", ncc: "1234567A" },
  number: "DEV-YOP-2026-00017",
  version: 1,
  createdAt: "2026-10-19T09:00:00.000Z",
  validUntil: "2026-11-03",
  customer: { displayName: "Kouassi Jean-Marc", phone: "+2250747218890" },
  vehicle: { plate: "2547 GH 01", make: "Toyota", model: "Corolla", year: 2016 },
  groups: [
    {
      label: "Plaquettes avant",
      priority: "URGENT",
      isOptional: false,
      explanation: "Vos plaquettes sont usées : à remplacer pour freiner en sécurité.",
      total: 50_740,
      accepted: true,
      lines: [
        { type: "LABOR", description: "Remplacement plaquettes AV", quantity: 1, unitPrice: 15_000, discountRate: 0, vatRate: 18, total: 17_700, payer: "CUSTOMER", isOptional: false, accepted: true, hours: 1, rate: 15_000 },
        { type: "PART", description: "Jeu de plaquettes AV", quantity: 1, unitPrice: 28_000, discountRate: 0, vatRate: 18, total: 33_040, payer: "CUSTOMER", isOptional: false, accepted: true, reference: "PLQ-COR" },
      ],
    },
    {
      label: "Amortisseurs arrière",
      priority: "WATCH",
      isOptional: true,
      total: 141_600,
      accepted: false,
      lines: [
        { type: "LABOR", description: "Remplacement amortisseurs AR", quantity: 2, unitPrice: 15_000, discountRate: 0, vatRate: 18, total: 35_400, payer: "CUSTOMER", isOptional: true, accepted: false },
      ],
    },
  ],
  totals: { subtotal: 171_000, discountTotal: 0, vatTotal: 30_780, total: 201_780, acceptedTotal: 60_180, insuranceShare: 0, customerShare: 201_780, deductible: 0 },
  terms: "Devis valable 15 jours. Pièces commandées spécialement non reprises.",
  status: "PARTIALLY_ACCEPTED",
  decision: { signerName: "Kouassi Jean-Marc", decidedAt: "2026-10-20T10:42:00.000Z", channel: "portal", hash: "3f9a1b2c3d4e5f60" },
  publicUrl: "http://localhost:3000/p/abc/devis",
};

describe("renderQuotePdf (M05 §7)", () => {
  it("produit un PDF client, expertise et signé", async () => {
    for (const variant of ["customer", "insurer", "signed"] as const) {
      const pdf = await renderQuotePdf({ ...base, variant, insurer: variant === "insurer" ? { name: "NSIA Assurances", claimNumber: "SIN-42" } : null });
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.byteLength).toBeGreaterThan(1500);
    }
  });
});
