import { describe, expect, it } from "vitest";
import {
  assertExportAllowed,
  csvCell,
  exportableColumns,
  exportExpiry,
  exportReadme,
  exportToCsv,
  isExportExpired,
  isSensitiveColumn,
  shouldExportTable,
  tableFileName,
} from "./data-export";
import { usagePeriod } from "./usage-period";

const NOW = new Date("2026-10-20T10:00:00.000Z");

describe("CSV de l'export (RG-M15-21)", () => {
  it("UTF-8 avec BOM, séparateur ; et échappement", () => {
    const csv = exportToCsv(
      ["id", "name", "note", "createdAt", "total"],
      [
        { id: "a", name: "Kouassi; Jean", note: 'dit "OK"\nfin', createdAt: NOW, total: 185_000 },
        { id: "b", name: null, note: undefined, createdAt: null, total: 0 },
      ],
    );
    expect(csv.startsWith("\uFEFFid;name;note;createdAt;total\r\n")).toBe(true);
    expect(csv).toContain(
      'a;"Kouassi; Jean";"dit ""OK""\nfin";2026-10-20T10:00:00.000Z;185000\r\n',
    );
    expect(csv).toContain("b;;;;0\r\n");
  });

  it("sérialise le JSON et neutralise les formules", () => {
    expect(csvCell({ mon: [["08:00", "18:00"]] })).toBe('"{""mon"":[[""08:00"",""18:00""]]}"');
    expect(csvCell("=HYPERLINK(1)")).toBe('"\'=HYPERLINK(1)"');
    expect(csvCell("-1500")).toBe("-1500");
  });

  it("exclut secrets, empreintes et jetons", () => {
    for (const col of [
      "credentials",
      "passwordHash",
      "pinHash",
      "keyHash",
      "webhookVerifyToken",
      "appSecret",
      "config",
    ]) {
      expect(isSensitiveColumn(col)).toBe(true);
    }
    expect(exportableColumns(["id", "displayName", "phone", "credentials", "pinHash"])).toEqual([
      "id",
      "displayName",
      "phone",
    ]);
    expect(shouldExportTable("Customer")).toBe(true);
    expect(shouldExportTable("PortalToken")).toBe(false);
    expect(shouldExportTable("ApiKey")).toBe(false);
  });

  it("nomme les fichiers en snake_case", () => {
    expect(tableFileName("RepairOrderLine")).toBe("repair_order_line.csv");
    expect(tableFileName("Customer")).toBe("customer.csv");
  });

  it("rédige le LISEZMOI", () => {
    const text = exportReadme({
      organizationName: "Garage A",
      generatedAt: "20/10/2026",
      tables: [{ file: "customer.csv", rows: 3 }],
      photoCount: 1,
      documentCount: 2,
    });
    expect(text).toContain("customer.csv : 3 ligne(s)");
    expect(text).toContain("documents/ : 2 facture(s)");
  });
});

describe("cadence et expiration", () => {
  it("1 export par 24 h, un échec ne compte pas", () => {
    const recent = { createdAt: new Date("2026-10-20T00:00:00.000Z"), status: "READY" };
    expect(() => assertExportAllowed({ previous: [recent], now: NOW })).toThrowError(
      expect.objectContaining({ code: "export.too_frequent" }),
    );
    expect(() =>
      assertExportAllowed({ previous: [{ ...recent, status: "FAILED" }], now: NOW }),
    ).not.toThrow();
    expect(() =>
      assertExportAllowed({
        previous: [{ createdAt: new Date("2026-10-19T09:59:59.000Z"), status: "READY" }],
        now: NOW,
      }),
    ).not.toThrow();
  });

  it("lien valable 48 h", () => {
    const expiresAt = exportExpiry(NOW);
    expect(expiresAt.toISOString()).toBe("2026-10-22T10:00:00.000Z");
    expect(isExportExpired(expiresAt, new Date("2026-10-22T09:59:59.000Z"))).toBe(false);
    expect(isExportExpired(expiresAt, expiresAt)).toBe(true);
  });

  it("période mensuelle dans le fuseau de l'organisation", () => {
    expect(usagePeriod(new Date("2026-10-31T23:30:00.000Z"), "Africa/Abidjan")).toBe("2026-10");
    expect(usagePeriod(new Date("2026-10-31T23:30:00.000Z"), "Africa/Lagos")).toBe("2026-11");
  });
});
