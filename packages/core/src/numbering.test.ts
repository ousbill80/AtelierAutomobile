import { describe, expect, it } from "vitest";
import {
  assertStartValueIncrease,
  DEFAULT_NUMBERING_CONFIG,
  type DocumentSequenceKey,
  formatDocumentNumber,
  isFiscalDocumentType,
  type NumberingConfig,
  nextDocumentNumber,
  renderNumberingPattern,
  sequenceKey,
  type SequenceStore,
  validateNumberingConfig,
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

describe("renderNumberingPattern — RG-M15-12", () => {
  it("US-M15-06 : préfixe « F », 4 chiffres → « F-2026-0413 » (prochain numéro = lastValue + 1)", () => {
    const config: NumberingConfig = {
      prefix: "F",
      pattern: "{TYPE}-{AAAA}-{N}",
      padding: 4,
      perSite: false,
      resetYearly: true,
    };
    expect(renderNumberingPattern(config, { year: 2026, value: 413 })).toBe("F-2026-0413");
  });

  it("rend le jeton {SITE} et un pas de 5 chiffres par défaut (OR)", () => {
    expect(
      renderNumberingPattern(DEFAULT_NUMBERING_CONFIG.OR, {
        siteCode: "YOP",
        year: 2026,
        value: 7,
      }),
    ).toBe("OR-YOP-2026-00007");
  });

  it("{SITE} est vide pour un document fiscal (A4, siteCode non fourni)", () => {
    expect(renderNumberingPattern(DEFAULT_NUMBERING_CONFIG.FAC, { year: 2026, value: 123 })).toBe(
      "FAC-2026-000123",
    );
  });

  it("refuse une valeur non entière ou négative/nulle", () => {
    const config = DEFAULT_NUMBERING_CONFIG.FAC;
    expect(() => renderNumberingPattern(config, { year: 2026, value: 0 })).toThrow(
      /entier positif/,
    );
    expect(() => renderNumberingPattern(config, { year: 2026, value: -1 })).toThrow(
      /entier positif/,
    );
  });
});

describe("validateNumberingConfig — RG-M15-12", () => {
  it("accepte les configs par défaut pour tous les docType", () => {
    for (const [docType, config] of Object.entries(DEFAULT_NUMBERING_CONFIG)) {
      expect(() =>
        validateNumberingConfig(docType as keyof typeof DEFAULT_NUMBERING_CONFIG, config),
      ).not.toThrow();
    }
  });

  it("refuse un pattern sans jeton de séquence {N…}", () => {
    expect(() =>
      validateNumberingConfig("OR", {
        prefix: "OR",
        pattern: "{TYPE}-{AAAA}",
        padding: 5,
        perSite: true,
        resetYearly: true,
      }),
    ).toThrow(/jeton de numéro séquentiel/);
  });

  it("refuse resetYearly sans {AAAA} dans le pattern", () => {
    expect(() =>
      validateNumberingConfig("OR", {
        prefix: "OR",
        pattern: "{TYPE}-{N}",
        padding: 5,
        perSite: true,
        resetYearly: true,
      }),
    ).toThrow(/\{AAAA\}/);
  });

  it.each(["FAC", "AV", "REC"] as const)(
    "%s (fiscal, A4) refuse resetYearly = false",
    (docType) => {
      expect(() =>
        validateNumberingConfig(docType, {
          ...DEFAULT_NUMBERING_CONFIG[docType],
          resetYearly: false,
        }),
      ).toThrow(/réinitialiser chaque année/);
    },
  );

  it.each(["FAC", "AV", "REC"] as const)("%s (fiscal, A4) refuse perSite = true", (docType) => {
    expect(() =>
      validateNumberingConfig(docType, { ...DEFAULT_NUMBERING_CONFIG[docType], perSite: true }),
    ).toThrow(/par organisation, pas par site/);
  });

  it("refuse un padding hors de la plage 1-10", () => {
    expect(() =>
      validateNumberingConfig("OR", { ...DEFAULT_NUMBERING_CONFIG.OR, padding: 0 }),
    ).toThrow(/compris entre 1 et 10/);
    expect(() =>
      validateNumberingConfig("OR", { ...DEFAULT_NUMBERING_CONFIG.OR, padding: 11 }),
    ).toThrow(/compris entre 1 et 10/);
  });
});

describe("assertStartValueIncrease — RG-M15-06/RG-M15-12", () => {
  it("accepte une nouvelle valeur strictement supérieure à la dernière valeur utilisée", () => {
    expect(() => assertStartValueIncrease(100, 101)).not.toThrow();
  });

  it("refuse une valeur de départ inférieure ou égale à la dernière valeur utilisée", () => {
    expect(() => assertStartValueIncrease(100, 100)).toThrow(/doit être supérieure/);
    expect(() => assertStartValueIncrease(100, 99)).toThrow(/doit être supérieure/);
  });
});
