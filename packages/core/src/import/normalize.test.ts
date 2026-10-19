import { describe, expect, it } from "vitest";
import {
  normalizeImportAmount,
  normalizeImportDate,
  normalizeImportEmail,
  normalizeImportFuelType,
  normalizeImportName,
  normalizeImportPaymentMethod,
  normalizeImportPhone,
  normalizeImportText,
} from "./normalize";

const NOW = new Date("2026-10-19T00:00:00.000Z");

describe("normalizeImportPhone", () => {
  it("normalise un numéro à 10 chiffres", () => {
    expect(normalizeImportPhone("0708123456")).toEqual({
      phone: "+2250708123456",
      phone2: null,
      warnings: [],
      errors: [],
    });
  });

  it("normalise un numéro avec espaces", () => {
    expect(normalizeImportPhone("07 08 12 34 56")).toMatchObject({ phone: "+2250708123456" });
  });

  it("convertit 00225 en +225", () => {
    expect(normalizeImportPhone("00225 0708123456")).toMatchObject({ phone: "+2250708123456" });
  });

  it("convertit +33 (autre pays) en conservant le préfixe", () => {
    expect(normalizeImportPhone("+33 1 23 45 67 89")).toMatchObject({ phone: "+33123456789" });
  });

  it("signale un numéro à 8 chiffres non résolu comme avertissement (table ARTCI à compléter)", () => {
    const result = normalizeImportPhone("08123456");
    expect(result.phone).toBeNull();
    expect(result.warnings[0]).toMatch(/8 chiffres non reconnu/);
  });

  it("signale une erreur pour un numéro à 9 chiffres", () => {
    const result = normalizeImportPhone("070812345");
    expect(result.phone).toBeNull();
    expect(result.errors[0]).toMatch(/invalide/);
  });

  it("extrait deux numéros séparés par '/'", () => {
    const result = normalizeImportPhone("0708123456 / 0505112233");
    expect(result.phone).toBe("+2250708123456");
    expect(result.phone2).toBe("+2250505112233");
  });

  it("extrait deux numéros séparés par ','", () => {
    const result = normalizeImportPhone("0708123456,0505112233");
    expect(result.phone).toBe("+2250708123456");
    expect(result.phone2).toBe("+2250505112233");
  });
});

describe("normalizeImportDate", () => {
  it("parse jj/mm/aaaa", () => {
    const result = normalizeImportDate("02/11/2026", NOW);
    expect(result.date?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("parse jj-mm-aaaa", () => {
    const result = normalizeImportDate("02-11-2026", NOW);
    expect(result.date?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("parse jj.mm.aaaa", () => {
    const result = normalizeImportDate("02.11.2026", NOW);
    expect(result.date?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("parse jj/mm/aa avec aa < 50 → 20aa", () => {
    const result = normalizeImportDate("11/02/26", NOW);
    expect(result.date?.toISOString()).toBe("2026-02-11T00:00:00.000Z");
  });

  it("parse l'ISO aaaa-mm-jj", () => {
    const result = normalizeImportDate("2026-11-02", NOW);
    expect(result.date?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("parse un nombre de série Excel (système 1900)", () => {
    const result = normalizeImportDate(45963, NOW);
    expect(result.date?.toISOString()).toBe("2025-11-02T00:00:00.000Z");
  });

  it("parse un texte français avec mois abrégé", () => {
    const result = normalizeImportDate("2 nov. 2026", NOW);
    expect(result.date?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("parse un texte français avec mois complet", () => {
    const result = normalizeImportDate("02 novembre 2026", NOW);
    expect(result.date?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("n'interprète jamais mm/jj par défaut", () => {
    // 13 ne peut pas être un mois : ce format serait toujours jj/mm, jamais
    // mm/jj, donc une tentative de parser "13/02/2026" comme mm/jj échouerait ;
    // ici on vérifie simplement que le premier nombre est bien traité comme
    // le jour par défaut.
    const result = normalizeImportDate("05/02/2026", NOW);
    expect(result.date?.toISOString()).toBe("2026-02-05T00:00:00.000Z");
  });

  it("interprète mm/jj si le format américain est explicitement choisi", () => {
    const result = normalizeImportDate("11/02/2026", NOW, { americanFormat: true });
    expect(result.date?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("rejette une date hors plage (trop ancienne)", () => {
    const result = normalizeImportDate("01/01/1985", NOW);
    expect(result.date).toBeNull();
    expect(result.error).toMatch(/plage/);
  });

  it("rejette une date hors plage (trop lointaine)", () => {
    const result = normalizeImportDate("01/01/2031", NOW);
    expect(result.date).toBeNull();
    expect(result.error).toMatch(/plage/);
  });

  it("rejette une date invalide (jour hors calendrier)", () => {
    const result = normalizeImportDate("31/02/2026", NOW);
    expect(result.date).toBeNull();
    expect(result.error).toMatch(/invalide/);
  });
});

describe("normalizeImportAmount", () => {
  it("normalise '185 000'", () => {
    expect(normalizeImportAmount("185 000")).toEqual({ amount: 185000, warning: undefined });
  });

  it("normalise '185.000' (séparateur de milliers)", () => {
    expect(normalizeImportAmount("185.000")).toEqual({ amount: 185000, warning: undefined });
  });

  it("normalise '185 000 FCFA'", () => {
    expect(normalizeImportAmount("185 000 FCFA")).toEqual({ amount: 185000, warning: undefined });
  });

  it("normalise '185000,00' (décimales nulles ignorées)", () => {
    expect(normalizeImportAmount("185000,00")).toEqual({ amount: 185000, warning: undefined });
  });

  it("arrondit '185000,50' avec avertissement (décimales non nulles)", () => {
    const result = normalizeImportAmount("185000,50");
    expect(result.amount).toBe(185001);
    expect(result.warning).toMatch(/arrondi/);
  });

  it("gère un grand nombre avec plusieurs groupements de milliers", () => {
    expect(normalizeImportAmount("1.234.567")).toEqual({ amount: 1234567, warning: undefined });
  });

  it("accepte un négatif entre parenthèses", () => {
    expect(normalizeImportAmount("(185 000)")).toEqual({ amount: -185000, warning: undefined });
  });

  it("accepte un négatif avec signe moins", () => {
    expect(normalizeImportAmount("-185 000")).toEqual({ amount: -185000, warning: undefined });
  });

  it("gère XOF comme devise", () => {
    expect(normalizeImportAmount("XOF 185 000")).toEqual({ amount: 185000, warning: undefined });
  });

  it("lève une erreur pour un montant vide", () => {
    expect(() => normalizeImportAmount("")).toThrow();
  });

  it("lève une erreur pour un montant non numérique", () => {
    expect(() => normalizeImportAmount("abc")).toThrow();
  });
});

describe("normalizeImportText", () => {
  it("trim et réduit les espaces multiples", () => {
    expect(normalizeImportText("  Cocody   Abidjan  ")).toBe("Cocody Abidjan");
  });
});

describe("normalizeImportName", () => {
  it("met en Casse Titre un nom tout en majuscules", () => {
    expect(normalizeImportName("KOUASSI JEAN-MARC")).toBe("Kouassi Jean-Marc");
  });

  it("conserve la casse d'origine si elle contient déjà des minuscules", () => {
    expect(normalizeImportName("Kouassi Jean-Marc")).toBe("Kouassi Jean-Marc");
  });

  it("conserve une casse mixte inhabituelle sans la retoucher", () => {
    expect(normalizeImportName("mcDonald")).toBe("mcDonald");
  });
});

describe("normalizeImportEmail", () => {
  it("met en minuscules un email valide", () => {
    expect(normalizeImportEmail("Jean.Kouassi@GMAIL.COM")).toEqual({
      email: "jean.kouassi@gmail.com",
    });
  });

  it("renvoie une erreur pour un email invalide", () => {
    const result = normalizeImportEmail("pas-un-email");
    expect(result.email).toBeNull();
    expect(result.error).toMatch(/invalide/);
  });

  it("renvoie null sans erreur pour une cellule vide", () => {
    expect(normalizeImportEmail("")).toEqual({ email: null });
  });
});

describe("normalizeImportPaymentMethod", () => {
  it.each([
    ["espece", "CASH"],
    ["cash", "CASH"],
    ["wave", "WAVE"],
    ["OM", "ORANGE_MONEY"],
    ["orange money", "ORANGE_MONEY"],
    ["mtn", "MTN_MOMO"],
    ["momo", "MTN_MOMO"],
    ["moov", "MOOV_MONEY"],
    ["flooz", "MOOV_MONEY"],
    ["virement", "BANK_TRANSFER"],
    ["vir", "BANK_TRANSFER"],
    ["cheque", "CHEQUE"],
    ["chq", "CHEQUE"],
    ["cb", "CARD"],
    ["carte", "CARD"],
    ["autre chose", "OTHER"],
  ] as const)("reconnaît '%s' → %s", (input, expected) => {
    expect(normalizeImportPaymentMethod(input)).toBe(expected);
  });
});

describe("normalizeImportFuelType", () => {
  it.each([
    ["essence", "PETROL"],
    ["ess", "PETROL"],
    ["gasoil", "DIESEL"],
    ["gazole", "DIESEL"],
    ["diesel", "DIESEL"],
    ["electrique", "OTHER"],
  ] as const)("reconnaît '%s' → %s", (input, expected) => {
    expect(normalizeImportFuelType(input)).toBe(expected);
  });
});
