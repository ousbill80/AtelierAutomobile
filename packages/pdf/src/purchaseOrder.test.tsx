import { describe, expect, it } from "vitest";
import { renderPurchaseOrderPdf } from "./purchaseOrder";

describe("renderPurchaseOrderPdf (US-M07-07)", () => {
  it("produit un PDF non vide", async () => {
    const buffer = await renderPurchaseOrderPdf({
      garage: { name: "Excellence Auto" },
      site: { name: "Yopougon" },
      supplier: { name: "CFAO Motors", phone: "+2250747218890" },
      number: "BC-YOP-2026-00008",
      orderedAt: "19/10/2026",
      lines: [
        {
          sku: "FH-TOY-001",
          name: "Filtre à huile",
          unit: "pièce",
          quantity: 20,
          quantityScale: 1,
          unitCost: 3600,
          total: 72_000,
        },
        {
          sku: "HU-5W30",
          name: "Huile 5W30",
          unit: "litre",
          quantity: 45,
          quantityScale: 10,
          unitCost: 4000,
          total: 18_000,
        },
      ],
      total: 90_000,
    });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
