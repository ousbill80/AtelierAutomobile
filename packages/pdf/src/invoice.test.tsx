import { describe, expect, it } from "vitest";
import { renderInvoicePdf, renderReceiptPdf, type InvoicePdfData } from "./invoice";

const invoice: InvoicePdfData = {
  kind: "INVOICE",
  number: "FAC-2026-000415",
  issuedAt: "2026-10-19T10:00:00.000Z",
  dueDate: "2026-10-19",
  garage: {
    name: "Excellence Auto",
    legalName: "Excellence Auto SARL",
    address: "Yopougon",
    phone: "+225 27 22 00 00 00",
    rccm: "CI-ABJ-2019-B-12345",
    ncc: "1912345A",
    taxRegime: "RNI",
  },
  customer: { displayName: "Kouassi Jean-Marc" },
  vehicle: { plate: "2547 GH 01", make: "Toyota", model: "Corolla", mileage: 84500 },
  lines: [
    {
      type: "LABOR",
      description: "MO Vidange moteur",
      quantity: 1,
      unitPrice: 15000,
      discountRate: 0,
      vatRate: 18,
      lineSubtotal: 15000,
      lineTotal: 17700,
    },
  ],
  totals: { subtotal: 15000, discountTotal: 0, vatTotal: 2700, total: 17700 },
  amountPaid: 0,
  balance: 17700,
  vatEnabled: true,
  paymentTerms: "Paiement comptant à réception.",
  fne: { status: "PENDING" },
};

describe("invoice and receipt PDFs", () => {
  it("renders an issued invoice, a draft and a credit note", async () => {
    for (const data of [
      invoice,
      { ...invoice, number: null },
      { ...invoice, kind: "CREDIT_NOTE" as const, creditedInvoiceNumber: "FAC-2026-000412" },
    ]) {
      const pdf = await renderInvoicePdf(data);
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    }
  });

  it("renders a receipt", async () => {
    const pdf = await renderReceiptPdf({
      number: "REC-2026-000310",
      receivedAt: "19/10/2026 10:00",
      garage: { name: "Excellence Auto" },
      customer: "Kouassi Jean-Marc",
      method: "Espèces",
      amount: 100000,
      status: "CONFIRMED",
      allocations: [{ invoiceNumber: "FAC-2026-000415", amount: 100000, balanceAfter: 85000 }],
      unallocated: 0,
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
