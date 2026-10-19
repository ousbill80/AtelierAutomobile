import { describe, expect, it } from "vitest";
import {
  detectCompanyFromName,
  headerSignature,
  levenshteinDistance,
  matchColumn,
  normalizeHeader,
  splitVehicleName,
  suggestColumnMapping,
} from "./mapping";

describe("normalizeHeader", () => {
  it("met en minuscules, retire les accents et la ponctuation", () => {
    expect(normalizeHeader("Tél. Portable")).toBe("tel portable");
  });

  it("réduit les espaces multiples", () => {
    expect(normalizeHeader("Nom   &   Prénoms")).toBe("nom prenoms");
  });

  it("gère une chaîne déjà normalisée", () => {
    expect(normalizeHeader("telephone")).toBe("telephone");
  });
});

describe("levenshteinDistance", () => {
  it("renvoie 0 pour des chaînes identiques", () => {
    expect(levenshteinDistance("telephone", "telephone")).toBe(0);
  });

  it("compte les substitutions", () => {
    expect(levenshteinDistance("telephne", "telephone")).toBe(1);
  });

  it("compte les insertions/suppressions", () => {
    expect(levenshteinDistance("tel", "telephone")).toBe(6);
  });
});

describe("matchColumn", () => {
  it("renvoie une confiance de 1.0 pour une correspondance exacte", () => {
    expect(matchColumn("telephone")).toEqual({
      field: "customer.phone",
      confidence: 1.0,
      source: "synonym",
    });
  });

  it("renvoie une confiance de 0.8 pour une inclusion de synonyme", () => {
    const match = matchColumn("numero de telephone portable");
    expect(match?.confidence).toBe(0.8);
  });

  it("renvoie une confiance de 0.7 pour une distance de Levenshtein <= 2", () => {
    // "cel" (synonyme customer.phone) à distance 1 de "sel" (ni inclusion, ni égalité)
    const match = matchColumn("sel");
    expect(match).toMatchObject({ field: "customer.phone", confidence: 0.7 });
  });

  it("renvoie undefined si aucune correspondance", () => {
    expect(matchColumn("couleur preferee")).toBeUndefined();
  });

  it("associe 'immat' à vehicle.plate", () => {
    expect(matchColumn("immat")).toMatchObject({ field: "vehicle.plate" });
  });

  it("associe 'date vt' à vehicle.inspectionExpiryDate", () => {
    expect(matchColumn("date vt")).toMatchObject({
      field: "vehicle.inspectionExpiryDate",
      confidence: 1.0,
    });
  });
});

describe("suggestColumnMapping", () => {
  it("propose une correspondance pour chaque en-tête du fichier", () => {
    const result = suggestColumnMapping(["Nom & Prénoms", "Tél.", "Immat", "Date VT"]);
    expect(result).toEqual([
      {
        column: "Nom & Prénoms",
        field: "customer.displayName",
        confidence: 1.0,
        source: "synonym",
      },
      { column: "Tél.", field: "customer.phone", confidence: 1.0, source: "synonym" },
      { column: "Immat", field: "vehicle.plate", confidence: 1.0, source: "synonym" },
      {
        column: "Date VT",
        field: "vehicle.inspectionExpiryDate",
        confidence: 1.0,
        source: "synonym",
      },
    ]);
  });

  it("laisse une colonne sans correspondance à null", () => {
    const result = suggestColumnMapping(["Couleur préférée"]);
    expect(result).toEqual([
      { column: "Couleur préférée", field: null, confidence: 0, source: null },
    ]);
  });

  it("utilise le mapping mémorisé en priorité (RG-M13-08)", () => {
    const result = suggestColumnMapping(["Contact"], { Contact: "customer.phone" });
    expect(result).toEqual([
      { column: "Contact", field: "customer.phone", confidence: 1.0, source: "memory" },
    ]);
  });
});

describe("headerSignature", () => {
  it("produit une signature stable, indépendante de l'ordre des en-têtes", async () => {
    const sig1 = await headerSignature(["Nom", "Tél."]);
    const sig2 = await headerSignature(["Tél.", "Nom"]);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produit une signature différente pour des en-têtes différents", async () => {
    const sig1 = await headerSignature(["Nom", "Tél."]);
    const sig2 = await headerSignature(["Nom", "Email"]);
    expect(sig1).not.toBe(sig2);
  });
});

describe("detectCompanyFromName", () => {
  it("détecte une entreprise par sa forme juridique", () => {
    expect(detectCompanyFromName("GARAGE MODERNE SARL")).toBe(true);
    expect(detectCompanyFromName("TRANSPORT RAPIDE CI")).toBe(true);
  });

  it("ne détecte pas d'entreprise pour un particulier", () => {
    expect(detectCompanyFromName("Kouassi Jean-Marc")).toBe(false);
  });
});

describe("splitVehicleName", () => {
  it("découpe marque et modèle quand la marque est reconnue", () => {
    expect(splitVehicleName("Toyota Corolla")).toEqual({ make: "Toyota", model: "Corolla" });
  });

  it("gère un modèle à plusieurs mots", () => {
    expect(splitVehicleName("Land Rover Range Rover")).toEqual({
      make: "Land Rover",
      model: "Range Rover",
    });
  });

  it("renvoie le modèle seul si la marque n'est pas reconnue", () => {
    expect(splitVehicleName("VéhiculeInconnu X")).toEqual({
      make: null,
      model: "VéhiculeInconnu X",
    });
  });

  it("renvoie null, null pour une chaîne vide", () => {
    expect(splitVehicleName("   ")).toEqual({ make: null, model: null });
  });
});
