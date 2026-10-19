import { describe, expect, it } from "vitest";
import { detectCsvDelimiter, detectHeaderRowIndex, filterDataRows, parseCsvLines } from "./csv";

describe("detectCsvDelimiter", () => {
  it("détecte le point-virgule (export Excel FR)", () => {
    const text = "Nom;Tel;Immat\nKouassi;0708123456;2547GH01\nTraoré;0505112233;1234AB02";
    expect(detectCsvDelimiter(text)).toBe(";");
  });

  it("détecte la virgule", () => {
    const text = "name,phone,plate\nJohn,0708123456,2547GH01\nJane,0505112233,1234AB02";
    expect(detectCsvDelimiter(text)).toBe(",");
  });

  it("détecte la tabulation", () => {
    const text = "Nom\tTel\tImmat\nKouassi\t0708123456\t2547GH01\nTraoré\t0505112233\t1234AB02";
    expect(detectCsvDelimiter(text)).toBe("\t");
  });

  it("détecte le pipe", () => {
    const text = "Nom|Tel|Immat\nKouassi|0708123456|2547GH01\nTraoré|0505112233|1234AB02";
    expect(detectCsvDelimiter(text)).toBe("|");
  });

  it("choisit ';' à égalité (défaut Excel FR)", () => {
    // Une seule colonne, aucun séparateur n'en découpe plusieurs de façon
    // cohérente : à égalité, le point-virgule est préféré.
    const text = "ligne1\nligne2\nligne3";
    expect(detectCsvDelimiter(text)).toBe(";");
  });

  it("gère les champs entre guillemets contenant le séparateur", () => {
    const text = 'Nom;Adresse\n"Kouassi";"Cocody, Abidjan"\n"Traoré";"Marcory, Abidjan"';
    expect(detectCsvDelimiter(text)).toBe(";");
  });

  it("ignore les lignes vides lors de la détection", () => {
    const text = "Nom;Tel\n\nKouassi;0708123456\n\nTraoré;0505112233";
    expect(detectCsvDelimiter(text)).toBe(";");
  });
});

describe("parseCsvLines", () => {
  it("découpe les lignes selon le séparateur donné", () => {
    const text = "Nom;Tel\nKouassi;0708123456";
    expect(parseCsvLines(text, ";")).toEqual([
      ["Nom", "Tel"],
      ["Kouassi", "0708123456"],
    ]);
  });

  it("gère les guillemets doublés comme un guillemet littéral", () => {
    const text = 'Nom\n"Kouassi ""Le Pro""'; // CSV: "" à l'intérieur de guillemets = "
    expect(parseCsvLines(text, ";")).toEqual([["Nom"], ['Kouassi "Le Pro"']]);
  });

  it("gère un séparateur dans un champ entre guillemets", () => {
    const text = 'Nom;Adresse\n"Kouassi";"Cocody, Abidjan"';
    expect(parseCsvLines(text, ";")).toEqual([
      ["Nom", "Adresse"],
      ["Kouassi", "Cocody, Abidjan"],
    ]);
  });
});

describe("detectHeaderRowIndex", () => {
  it("détecte la ligne d'en-tête en première position", () => {
    const rows = [
      ["Nom", "Téléphone", "Immatriculation"],
      ["Kouassi Jean-Marc", "0708123456", "2547 GH 01"],
    ];
    expect(detectHeaderRowIndex(rows)).toBe(0);
  });

  it("ignore les lignes vides avant l'en-tête", () => {
    const rows = [
      [],
      ["", "", ""],
      ["Nom", "Téléphone", "Immatriculation"],
      ["Kouassi Jean-Marc", "0708123456", "2547 GH 01"],
    ];
    expect(detectHeaderRowIndex(rows)).toBe(2);
  });

  it("ignore une ligne de titre/logo avant l'en-tête réel si elle n'est pas majoritairement textuelle", () => {
    const rows = [
      ["123", "", ""],
      ["Nom", "Téléphone", "Immatriculation"],
      ["Kouassi Jean-Marc", "0708123456", "2547 GH 01"],
    ];
    // La première ligne a 1 seule cellule non vide et numérique (ratio texte = 0),
    // donc elle est écartée au profit de la ligne 1.
    expect(detectHeaderRowIndex(rows)).toBe(1);
  });

  it("ignore les lignes de total", () => {
    const rows = [
      ["Nom", "Montant"],
      ["Kouassi", "185000"],
      ["TOTAL", "185000"],
    ];
    expect(detectHeaderRowIndex(rows)).toBe(0);
  });

  it("recherche seulement dans les 10 premières lignes", () => {
    const filler = Array.from({ length: 11 }, (_, i) => [String(i), String(i)]);
    const rows = [...filler, ["Nom", "Téléphone"]];
    // La ligne d'en-tête réelle est à l'index 11, hors de la fenêtre de
    // recherche (10 lignes) : on retombe sur la première ligne non vide.
    expect(detectHeaderRowIndex(rows)).toBe(0);
  });
});

describe("filterDataRows", () => {
  it("retire les lignes vides et les lignes de total", () => {
    const rows = [
      ["Nom", "Montant"],
      ["Kouassi", "185000"],
      [],
      ["Total général", "185000"],
      ["Traoré", "90000"],
    ];
    expect(filterDataRows(rows)).toEqual([
      ["Nom", "Montant"],
      ["Kouassi", "185000"],
      ["Traoré", "90000"],
    ]);
  });
});
