import { describe, expect, it } from "vitest";
import { analyzeSearchQuery, loosenPlate, matchRank } from "./index";

describe("analyzeSearchQuery (RG-M02-19)", () => {
  it("numéro de téléphone avec espaces → téléphone puis document", () => {
    const a = analyzeSearchQuery(" 07 08 12 39 87 ");
    expect(a.kinds).toEqual(["PHONE", "DOCUMENT"]);
    expect(a.digits).toBe("0708123987");
  });

  it("numéro au format international → téléphone", () => {
    expect(analyzeSearchQuery("+225 07 08 12 39 87").kinds[0]).toBe("PHONE");
  });

  it("nombre court (< 4 chiffres) → numéro de document uniquement", () => {
    expect(analyzeSearchQuery("42").kinds).toEqual(["DOCUMENT"]);
  });

  it.each(["OR-YOP-2026-00042", "dev-2026", "FAC-2026-000123", "av-1", "REC-2026", "BC-YOP"])(
    "préfixe de document %s → document",
    (q) => {
      const a = analyzeSearchQuery(q);
      expect(a.kinds).toEqual(["DOCUMENT"]);
      expect(a.documentPrefix).not.toBeNull();
      expect(a.documentNumber).toBe(q.toUpperCase());
    },
  );

  it("plaque avec espaces → plaque puis nom (VIN, n° de flotte)", () => {
    const a = analyzeSearchQuery("2547 gh 01");
    expect(a.kinds).toEqual(["PLATE", "NAME"]);
    expect(a.plateCompact).toBe("2547GH01");
  });

  it("plaque saisie avec un O à la place d'un 0 : forme tolérante identique", () => {
    expect(analyzeSearchQuery("2547 GH O1").plateLoose).toBe(
      analyzeSearchQuery("2547GH01").plateLoose,
    );
  });

  it("nom avec accents → nom", () => {
    expect(analyzeSearchQuery("Kouassi Amani").kinds).toEqual(["NAME"]);
    expect(analyzeSearchQuery("N'Guessan").kinds).toEqual(["NAME"]);
  });

  it("lettres seules de 4 caractères ou plus → nom, pas plaque", () => {
    expect(analyzeSearchQuery("SOTRA").kinds).toEqual(["NAME"]);
  });

  it("un téléphone ne contient jamais de lettres : « 1234 AB 01 » est une plaque", () => {
    expect(analyzeSearchQuery("1234 AB 01").kinds[0]).toBe("PLATE");
  });
});

describe("loosenPlate", () => {
  it("remplace O par 0 et I par 1", () => {
    expect(loosenPlate("WW45I2OI")).toBe("WW451201");
  });
});

describe("matchRank", () => {
  it("exact > préfixe > reste, sans tenir compte de la casse", () => {
    expect(matchRank("Kouassi", "kouassi")).toBe(3);
    expect(matchRank("Kouassi Amani", "kouassi")).toBe(2);
    expect(matchRank("Amani Kouassi", "kouassi")).toBe(1);
  });
});
