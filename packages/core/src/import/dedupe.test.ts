import { describe, expect, it } from "vitest";
import {
  dedupeRowsInFile,
  resolveCustomerMatchKey,
  resolveInvoiceMatchKey,
  resolvePaymentMatchKey,
  resolveVehicleMatchKey,
} from "./dedupe";

describe("dedupeRowsInFile", () => {
  it("garde la dernière ligne quand plusieurs lignes partagent la même clé", () => {
    const rows = [
      { phone: "+2250708123456", name: "A" },
      { phone: "+2250505112233", name: "B" },
      { phone: "+2250708123456", name: "C" },
    ];
    const result = dedupeRowsInFile(rows, (row) => row.phone);

    expect(result.winners.get("+2250708123456")).toEqual({ row: rows[2], rowNumber: 3 });
    expect(result.winners.get("+2250505112233")).toEqual({ row: rows[1], rowNumber: 2 });
    expect(result.merged).toEqual([
      { rowNumber: 1, mergedWithRowNumber: 3, key: "+2250708123456" },
    ]);
  });

  it("ne fusionne jamais les lignes sans clé entre elles", () => {
    const rows = [{ phone: null }, { phone: null }];
    const result = dedupeRowsInFile(rows, (row) => row.phone);
    expect(result.winners.size).toBe(0);
    expect(result.merged).toEqual([]);
  });

  it("renvoie toutes les lignes comme gagnantes si les clés sont uniques", () => {
    const rows = [{ phone: "a" }, { phone: "b" }, { phone: "c" }];
    const result = dedupeRowsInFile(rows, (row) => row.phone);
    expect(result.winners.size).toBe(3);
    expect(result.merged).toEqual([]);
  });

  it("gère plus de deux doublons pour la même clé (la dernière gagne toujours)", () => {
    const rows = [{ k: "x" }, { k: "x" }, { k: "x" }];
    const result = dedupeRowsInFile(rows, (row) => row.k);
    expect(result.winners.get("x")?.rowNumber).toBe(3);
    expect(result.merged).toEqual([
      { rowNumber: 1, mergedWithRowNumber: 3, key: "x" },
      { rowNumber: 2, mergedWithRowNumber: 3, key: "x" },
    ]);
  });
});

describe("resolveCustomerMatchKey", () => {
  it("priorise l'ExternalRef", () => {
    expect(resolveCustomerMatchKey({ externalId: "C-001", phone: "+2250708123456" })).toEqual({
      strategy: "external_ref",
      value: "C-001",
    });
  });

  it("utilise le téléphone à défaut d'ExternalRef", () => {
    expect(resolveCustomerMatchKey({ phone: "+2250708123456", email: "a@b.com" })).toEqual({
      strategy: "phone",
      value: "+2250708123456",
    });
  });

  it("retombe sur phone2 si phone est absent", () => {
    expect(resolveCustomerMatchKey({ phone2: "+2250505112233" })).toEqual({
      strategy: "phone",
      value: "+2250505112233",
    });
  });

  it("retombe sur l'email à défaut de téléphone", () => {
    expect(resolveCustomerMatchKey({ email: "a@b.com" })).toEqual({
      strategy: "email",
      value: "a@b.com",
    });
  });

  it("retombe sur le NCC pour une entreprise sans téléphone ni email", () => {
    expect(resolveCustomerMatchKey({ ncc: "CI-12345", isCompany: true })).toEqual({
      strategy: "ncc",
      value: "CI-12345",
    });
  });

  it("ne retombe jamais sur le NCC pour un particulier", () => {
    expect(resolveCustomerMatchKey({ ncc: "CI-12345", isCompany: false })).toEqual({
      strategy: "none",
      value: null,
    });
  });

  it("renvoie 'none' sans aucune information", () => {
    expect(resolveCustomerMatchKey({})).toEqual({ strategy: "none", value: null });
  });
});

describe("resolveVehicleMatchKey", () => {
  it("priorise la plaque", () => {
    expect(resolveVehicleMatchKey({ plateCompact: "2547GH01", vin: "VF1XYZ" })).toEqual({
      strategy: "plate",
      value: "2547GH01",
    });
  });

  it("retombe sur le VIN à défaut de plaque", () => {
    expect(resolveVehicleMatchKey({ vin: "VF1XYZ" })).toEqual({ strategy: "vin", value: "VF1XYZ" });
  });
});

describe("resolveInvoiceMatchKey", () => {
  it("priorise l'ExternalRef", () => {
    expect(
      resolveInvoiceMatchKey({ externalId: "F-001", customerId: "c1", externalNumber: "FAC-1" }),
    ).toEqual({
      strategy: "external_ref",
      value: "F-001",
    });
  });

  it("retombe sur (customerId, externalNumber)", () => {
    expect(resolveInvoiceMatchKey({ customerId: "c1", externalNumber: "FAC-1" })).toEqual({
      strategy: "customer_external_number",
      value: "c1:FAC-1",
    });
  });
});

describe("resolvePaymentMatchKey", () => {
  it("priorise (provider, providerRef)", () => {
    expect(resolvePaymentMatchKey({ provider: "wave", providerRef: "tx_123" })).toEqual({
      strategy: "provider_ref",
      value: "wave:tx_123",
    });
  });

  it("retombe sur (invoice, amount, receivedAt, reference)", () => {
    expect(
      resolvePaymentMatchKey({
        invoiceId: "inv1",
        amount: 185000,
        receivedAt: "2026-10-01",
        reference: "IMPORT-SOLDE",
      }),
    ).toEqual({ strategy: "invoice_composite", value: "inv1:185000:2026-10-01:IMPORT-SOLDE" });
  });
});
