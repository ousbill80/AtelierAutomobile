import { describe, expect, it } from "vitest";
import {
  hasBlockingError,
  validateCustomerRow,
  validateInvoiceBalanceColumn,
  validateInvoiceRow,
  validatePaymentRow,
  validateProductRow,
  validateRepairOrderRow,
  validateVehicleRow,
} from "./validate";

describe("validateCustomerRow", () => {
  it("n'a pas d'erreur quand tout est présent", () => {
    expect(
      validateCustomerRow({ displayName: "Kouassi", phone: "+2250708123456", email: null }),
    ).toEqual([]);
  });

  it("exige le nom", () => {
    const issues = validateCustomerRow({ displayName: null, phone: "+2250708123456", email: null });
    expect(issues).toEqual([
      { field: "displayName", message: "Le nom du client est obligatoire.", severity: "ERROR" },
    ]);
  });

  it("exige un téléphone ou un email", () => {
    const issues = validateCustomerRow({ displayName: "Kouassi", phone: null, email: null });
    expect(issues).toEqual([
      { message: "Un téléphone ou un email est obligatoire.", severity: "ERROR" },
    ]);
  });

  it("accepte l'email seul sans téléphone", () => {
    expect(validateCustomerRow({ displayName: "Kouassi", phone: null, email: "a@b.com" })).toEqual(
      [],
    );
  });
});

describe("validateVehicleRow", () => {
  const base = {
    plate: "2547GH01",
    ownerPhone: "+2250708123456",
    ownerExternalId: null,
    ownerName: null,
    make: "Toyota",
    year: 2020,
    nowYear: 2026,
  };

  it("n'a pas d'erreur quand tout est valide", () => {
    expect(validateVehicleRow(base)).toEqual([]);
  });

  it("exige la plaque", () => {
    const issues = validateVehicleRow({ ...base, plate: null });
    expect(issues.some((i) => i.field === "plate")).toBe(true);
  });

  it("exige un propriétaire", () => {
    const issues = validateVehicleRow({ ...base, ownerPhone: null });
    expect(issues.some((i) => i.message.includes("propriétaire"))).toBe(true);
  });

  it("exige la marque", () => {
    const issues = validateVehicleRow({ ...base, make: null });
    expect(issues.some((i) => i.field === "make")).toBe(true);
  });

  it("rejette une année antérieure à 1960", () => {
    const issues = validateVehicleRow({ ...base, year: 1955 });
    expect(issues.some((i) => i.field === "year")).toBe(true);
  });

  it("rejette une année postérieure à l'année + 1", () => {
    const issues = validateVehicleRow({ ...base, year: 2028 });
    expect(issues.some((i) => i.field === "year")).toBe(true);
  });

  it("accepte l'année + 1 (prochain modèle)", () => {
    expect(validateVehicleRow({ ...base, year: 2027 })).toEqual([]);
  });
});

describe("validateInvoiceRow", () => {
  const base = {
    externalNumber: "FAC-0412",
    customerRef: "c1",
    issuedAt: new Date("2026-10-01"),
    dueDate: new Date("2026-10-30"),
    total: 185000,
    amountPaid: 185000,
  };

  it("n'a pas d'erreur quand tout est valide", () => {
    expect(validateInvoiceRow(base)).toEqual([]);
  });

  it("exige le numéro externe, le client, la date et le total", () => {
    const issues = validateInvoiceRow({
      ...base,
      externalNumber: null,
      customerRef: null,
      issuedAt: null,
      total: null,
    });
    expect(issues).toHaveLength(4);
  });

  it("rejette amountPaid > total", () => {
    const issues = validateInvoiceRow({ ...base, amountPaid: 200000 });
    expect(issues.some((i) => i.field === "amountPaid")).toBe(true);
  });

  it("rejette dueDate < issuedAt", () => {
    const issues = validateInvoiceRow({ ...base, dueDate: new Date("2026-09-30") });
    expect(issues.some((i) => i.field === "dueDate")).toBe(true);
  });
});

describe("validateInvoiceBalanceColumn", () => {
  it("accepte un solde cohérent", () => {
    expect(validateInvoiceBalanceColumn(185000, 185000, 0)).toEqual([]);
  });

  it("accepte un écart dans la tolérance de 1 FCFA", () => {
    expect(validateInvoiceBalanceColumn(185000, 184999, 2)).toEqual([]);
  });

  it("rejette un solde incohérent au-delà de la tolérance", () => {
    const issues = validateInvoiceBalanceColumn(185000, 100000, 50000);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("balance");
  });
});

describe("validatePaymentRow", () => {
  it("n'a pas d'erreur quand tout est valide", () => {
    expect(
      validatePaymentRow({ invoiceRef: "FAC-0412", amount: 185000, receivedAt: new Date() }),
    ).toEqual([]);
  });

  it("rejette un montant nul ou négatif", () => {
    expect(
      validatePaymentRow({ invoiceRef: "FAC-0412", amount: 0, receivedAt: new Date() }).some(
        (i) => i.field === "amount",
      ),
    ).toBe(true);
    expect(
      validatePaymentRow({ invoiceRef: "FAC-0412", amount: -1, receivedAt: new Date() }).some(
        (i) => i.field === "amount",
      ),
    ).toBe(true);
  });

  it("exige la facture et la date de règlement", () => {
    const issues = validatePaymentRow({ invoiceRef: null, amount: 185000, receivedAt: null });
    expect(issues).toHaveLength(2);
  });
});

describe("validateProductRow", () => {
  it("n'a pas d'erreur quand tout est valide", () => {
    expect(
      validateProductRow({ sku: "REF-1", name: "Filtre à huile", salePrice: 5000, onHand: 10 }),
    ).toEqual([]);
  });

  it("exige sku et name", () => {
    const issues = validateProductRow({ sku: null, name: null, salePrice: 0, onHand: 0 });
    expect(issues).toHaveLength(2);
  });

  it("rejette un prix négatif", () => {
    const issues = validateProductRow({ sku: "REF-1", name: "Filtre", salePrice: -1, onHand: 0 });
    expect(issues.some((i) => i.field === "salePrice")).toBe(true);
  });

  it("rejette un stock non entier", () => {
    const issues = validateProductRow({ sku: "REF-1", name: "Filtre", salePrice: 0, onHand: 1.5 });
    expect(issues.some((i) => i.field === "onHand")).toBe(true);
  });
});

describe("validateRepairOrderRow", () => {
  it("n'a pas d'erreur quand tout est valide", () => {
    expect(validateRepairOrderRow({ plate: "2547GH01", date: new Date(), mileage: 50000 })).toEqual(
      [],
    );
  });

  it("exige la plaque et la date", () => {
    const issues = validateRepairOrderRow({ plate: null, date: null, mileage: 0 });
    expect(issues).toHaveLength(2);
  });

  it("rejette un kilométrage négatif", () => {
    const issues = validateRepairOrderRow({ plate: "2547GH01", date: new Date(), mileage: -1 });
    expect(issues.some((i) => i.field === "mileage")).toBe(true);
  });
});

describe("hasBlockingError", () => {
  it("renvoie true si au moins une erreur ERROR est présente", () => {
    expect(hasBlockingError([{ message: "x", severity: "ERROR" }])).toBe(true);
  });

  it("renvoie false s'il n'y a que des avertissements", () => {
    expect(hasBlockingError([{ message: "x", severity: "WARNING" }])).toBe(false);
  });

  it("renvoie false pour un tableau vide", () => {
    expect(hasBlockingError([])).toBe(false);
  });
});
