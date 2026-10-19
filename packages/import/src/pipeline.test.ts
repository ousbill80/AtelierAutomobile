/**
 * RG-M13-01 — vérifie que les classeurs `.xlsx`/`.xls` sont bien lus (et pas
 * seulement acceptés par le typage) : construit un classeur en mémoire avec
 * chacune des deux bibliothèques utilisées à l'écriture par les outils du
 * marché (`exceljs` pour `.xlsx`, `xlsx`/SheetJS pour `.xls`), puis vérifie
 * que `parseImportFile` en retrouve les en-têtes et les lignes de données.
 */
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { detectFileFormat, parseImportFile } from "./pipeline";

describe("detectFileFormat (RG-M13-01)", () => {
  it("reconnaît csv/txt/xlsx/xls, insensible à la casse", () => {
    expect(detectFileFormat("clients.csv")).toBe("csv");
    expect(detectFileFormat("clients.TXT")).toBe("txt");
    expect(detectFileFormat("clients.xlsx")).toBe("xlsx");
    expect(detectFileFormat("clients.XLS")).toBe("xls");
  });

  it("retourne null pour un format non reconnu", () => {
    expect(detectFileFormat("clients.pdf")).toBeNull();
    expect(detectFileFormat("clients")).toBeNull();
  });
});

async function buildXlsxBytes(rows: string[][]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Clients");
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

function buildXlsBytes(rows: string[][]): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Clients");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xls" }) as Buffer;
  return new Uint8Array(buffer);
}

const SOURCE_ROWS = [
  ["Nom & Prénoms", "Téléphone", "Email"],
  ["Kouassi Jean-Marc", "0747218890", "jm.kouassi@example.com"],
  ["Ibrahim Diallo", "0505123456", "ibrahim.diallo@example.com"],
];

describe("parseImportFile — classeurs Excel (RG-M13-01)", () => {
  it("lit un classeur .xlsx (exceljs à l'écriture)", async () => {
    const bytes = await buildXlsxBytes(SOURCE_ROWS);
    const parsed = await parseImportFile(bytes, { fileName: "clients.xlsx" });

    expect(parsed.format).toBe("xlsx");
    expect(parsed.encoding).toBeNull();
    expect(parsed.delimiter).toBeNull();
    expect(parsed.headers).toEqual(["Nom & Prénoms", "Téléphone", "Email"]);
    expect(parsed.rows).toEqual([
      ["Kouassi Jean-Marc", "0747218890", "jm.kouassi@example.com"],
      ["Ibrahim Diallo", "0505123456", "ibrahim.diallo@example.com"],
    ]);
    expect(parsed.rowNumbers).toEqual([2, 3]);
  });

  it("lit un classeur .xls binaire legacy (xlsx/SheetJS à l'écriture)", () => {
    const bytes = buildXlsBytes(SOURCE_ROWS);
    return parseImportFile(bytes, { fileName: "clients.xls" }).then((parsed) => {
      expect(parsed.format).toBe("xls");
      expect(parsed.headers).toEqual(["Nom & Prénoms", "Téléphone", "Email"]);
      expect(parsed.rows).toEqual([
        ["Kouassi Jean-Marc", "0747218890", "jm.kouassi@example.com"],
        ["Ibrahim Diallo", "0505123456", "ibrahim.diallo@example.com"],
      ]);
    });
  });

  it("rejette un nom de fichier sans extension reconnue", async () => {
    await expect(parseImportFile(new Uint8Array(), { fileName: "clients.pdf" })).rejects.toThrow(
      "Format de fichier non reconnu",
    );
  });
});
