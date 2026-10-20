import { describe, expect, it } from "vitest";
import { isFileStable, matchesFilePattern, processedFolder, ruleForFile } from "./watch";

describe("dossier surveillé (RG-M13-29)", () => {
  it("motifs * et ?, insensibles à la casse, caractères spéciaux littéraux", () => {
    expect(matchesFilePattern("export_2026-10-18.csv", "export_*.csv")).toBe(true);
    expect(matchesFilePattern("EXPORT_2026.CSV", "export_*.csv")).toBe(true);
    expect(matchesFilePattern("export_2026.xlsx", "export_*.csv")).toBe(false);
    expect(matchesFilePattern("clients1.csv", "clients?.csv")).toBe(true);
    expect(matchesFilePattern("clients12.csv", "clients?.csv")).toBe(false);
    expect(matchesFilePattern("factures(1).csv", "factures(1).csv")).toBe(true);
    expect(matchesFilePattern("facturesX1Y.csv", "factures(1).csv")).toBe(false);
  });

  it("la première règle qui correspond l'emporte", () => {
    const rules = [
      { pattern: "factures*.csv", entity: "invoices" as const },
      { pattern: "*.csv", entity: "customers" as const },
    ];
    expect(ruleForFile("factures_oct.csv", rules)?.entity).toBe("invoices");
    expect(ruleForFile("clients.csv", rules)?.entity).toBe("customers");
    expect(ruleForFile("notes.txt", rules)).toBeNull();
  });

  it("fichier stable depuis 60 s et dossier de rangement daté", () => {
    const now = new Date("2026-10-19T02:00:00Z");
    expect(isFileStable(new Date("2026-10-19T01:59:00Z"), now)).toBe(true);
    expect(isFileStable(new Date("2026-10-19T01:59:30Z"), now)).toBe(false);
    expect(processedFolder("2026-10-19")).toBe("traites/2026-10-19");
  });
});
