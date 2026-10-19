import { describe, expect, it } from "vitest";
import { renderRepairOrderPdf, type RepairOrderPdfData } from "./repairOrder";

const base: RepairOrderPdfData = {
  kind: "reception",
  garage: { name: "Excellence Auto", phone: "+225 27 22 00 00 00" },
  number: "OR-YOP-2026-00042",
  createdAt: "2026-10-19T09:00:00.000Z",
  promisedAt: "2026-10-19T17:00:00.000Z",
  customer: { displayName: "Kouassi Jean-Marc", phone: "+2250707070707" },
  vehicle: { plate: "2547 GH 01", make: "Toyota", model: "Corolla", year: 2016 },
  mileageIn: 48200,
  fuelLevel: 3,
  complaint: "Bruit au freinage à l'avant + vidange",
  damages: [
    { n: 1, view: "LEFT", x: 0.2, y: 0.4, zone: "Aile AVG", type: "SCRATCH", severity: "LIGHT" },
  ],
  noDamage: false,
  items: [{ label: "Roue de secours", present: true }],
  keysCount: 2,
  belongings: "Sac noir dans le coffre",
  warningLights: [],
  authorizationCeiling: 50000,
  returnOldParts: false,
  lines: [
    {
      type: "LABOR",
      description: "Vidange moteur + filtre",
      quantity: 0.5,
      unitPrice: 15000,
      discountRate: 0,
      total: 8850,
      approval: "APPROVED",
      isCustomerSupplied: false,
    },
  ],
  totals: { subtotal: 7500, vatTotal: 1350, total: 8850 },
  signature: { status: "Signé", signerName: "Kouassi Jean-Marc" },
  photos: [],
  photoCount: 4,
};

describe("renderRepairOrderPdf", () => {
  it.each(["reception", "workshop", "full", "delivery"] as const)(
    "génère le PDF %s",
    async (kind) => {
      const pdf = await renderRepairOrderPdf({
        ...base,
        kind,
        checkOut:
          kind === "delivery"
            ? {
                mileage: 48210,
                fuelLevel: 3,
                itemsConfirmed: true,
                oldPartsReturned: false,
                collectedBy: "Kouassi Jean-Marc",
                at: "2026-10-20T10:00:00.000Z",
              }
            : null,
      });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    },
  );
});
