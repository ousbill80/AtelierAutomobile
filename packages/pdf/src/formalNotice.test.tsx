import { describe, expect, it } from "vitest";
import { renderFormalNoticePdf } from "./formalNotice";

describe("renderFormalNoticePdf", () => {
  it("produit un PDF", async () => {
    const pdf = await renderFormalNoticePdf({
      garage: { name: "Garage Central", city: "Abidjan", rccm: "CI-ABJ-2019-B-12345" },
      customer: { displayName: "SOTRA Logistique SARL", ncc: "1234567A" },
      issuedOn: "2026-10-18",
      deadline: "2026-10-26",
      delayDays: 8,
      invoices: [
        {
          number: "FAC-2026-000350",
          issuedAt: "2026-08-16",
          fneNumber: null,
          total: 640_000,
          balance: 640_000,
        },
      ],
      totalDue: 640_000,
      closingText:
        "À défaut de règlement dans ce délai, nous nous réservons le droit d'engager toute procédure.",
      signerName: "Kouadio N'Guessan",
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
