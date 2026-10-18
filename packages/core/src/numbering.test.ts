import { describe, expect, it } from "vitest";
import {
  type DocumentSequenceKey,
  formatDocumentNumber,
  isFiscalDocumentType,
  nextDocumentNumber,
  sequenceKey,
  type SequenceStore,
} from "./numbering";

class InMemorySequenceStore implements SequenceStore {
  private readonly values = new Map<string, number>();

  async getAndIncrement(key: DocumentSequenceKey): Promise<number> {
    const cacheKey = JSON.stringify(key);
    const next = (this.values.get(cacheKey) ?? 0) + 1;
    this.values.set(cacheKey, next);
    return next;
  }
}

describe("formatDocumentNumber — RG-M08-01", () => {
  it.each([
    ["FAC", 2026, 123, "FAC-2026-000123"],
    ["AV", 2026, 14, "AV-2026-000014"],
    ["REC", 2026, 310, "REC-2026-000310"],
  ] as const)("%s %i %i → %s", (docType, year, value, expected) => {
    expect(formatDocumentNumber(docType, year, value)).toBe(expected);
  });

  it("refuse une valeur non entière ou négative/nulle", () => {
    expect(() => formatDocumentNumber("FAC", 2026, 0)).toThrow(/entier positif/);
    expect(() => formatDocumentNumber("FAC", 2026, -1)).toThrow(/entier positif/);
    expect(() => formatDocumentNumber("FAC", 2026, 1.5)).toThrow(/entier positif/);
  });
});

describe("isFiscalDocumentType — A4", () => {
  it.each(["FAC", "AV", "REC"] as const)("%s est fiscal (par organisation)", (docType) => {
    expect(isFiscalDocumentType(docType)).toBe(true);
  });

  it.each(["OR", "DEV", "BC", "INV", "TR", "SIN"] as const)(
    "%s est opérationnel (par site)",
    (docType) => {
      expect(isFiscalDocumentType(docType)).toBe(false);
    },
  );
});

describe("sequenceKey — A4", () => {
  it("force siteId à null pour un document fiscal même si un siteId est fourni", () => {
    expect(
      sequenceKey({ organizationId: "org_1", docType: "FAC", year: 2026, siteId: "site_1" }),
    ).toEqual({ organizationId: "org_1", docType: "FAC", year: 2026, siteId: null });
  });

  it("conserve le siteId pour un document opérationnel", () => {
    expect(
      sequenceKey({ organizationId: "org_1", docType: "OR", year: 2026, siteId: "site_1" }),
    ).toEqual({ organizationId: "org_1", docType: "OR", year: 2026, siteId: "site_1" });
  });
});

describe("nextDocumentNumber — sans trou", () => {
  it("incrémente séquentiellement sans trou pour la même clé", async () => {
    const store = new InMemorySequenceStore();
    const key = { organizationId: "org_1", docType: "OR" as const, year: 2026, siteId: "site_1" };

    expect(await nextDocumentNumber(store, key)).toBe("OR-2026-000001");
    expect(await nextDocumentNumber(store, key)).toBe("OR-2026-000002");
    expect(await nextDocumentNumber(store, key)).toBe("OR-2026-000003");
  });

  it("deux sites différents partagent le même compteur pour un document fiscal (A4)", async () => {
    const store = new InMemorySequenceStore();
    const base = { organizationId: "org_1", docType: "FAC" as const, year: 2026 };

    expect(await nextDocumentNumber(store, { ...base, siteId: "site_1" })).toBe("FAC-2026-000001");
    expect(await nextDocumentNumber(store, { ...base, siteId: "site_2" })).toBe("FAC-2026-000002");
  });

  it("deux sites différents ont des compteurs indépendants pour un document opérationnel", async () => {
    const store = new InMemorySequenceStore();
    const base = { organizationId: "org_1", docType: "OR" as const, year: 2026 };

    expect(await nextDocumentNumber(store, { ...base, siteId: "site_1" })).toBe("OR-2026-000001");
    expect(await nextDocumentNumber(store, { ...base, siteId: "site_2" })).toBe("OR-2026-000001");
  });

  it("le changement d'année repart à 1", async () => {
    const store = new InMemorySequenceStore();
    const base = { organizationId: "org_1", docType: "FAC" as const, siteId: null };

    expect(await nextDocumentNumber(store, { ...base, year: 2026 })).toBe("FAC-2026-000001");
    expect(await nextDocumentNumber(store, { ...base, year: 2027 })).toBe("FAC-2027-000001");
  });
});
