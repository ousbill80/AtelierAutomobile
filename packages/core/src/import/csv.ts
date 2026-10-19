/**
 * RG-M13-03/04 — Détection du séparateur CSV et de la ligne d'en-tête.
 * Fonctions pures opérant sur du texte déjà décodé (voir `encoding.ts`).
 */

export type CsvDelimiter = ";" | "," | "\t" | "|";

const DELIMITER_CANDIDATES: readonly CsvDelimiter[] = [";", ",", "\t", "|"];
const DEFAULT_DELIMITER: CsvDelimiter = ";";
const SAMPLE_LINE_COUNT = 50;

/** Découpe une ligne CSV en tenant compte des guillemets `"`. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}

function countColumns(lines: string[], delimiter: string): number[] {
  return lines.map((line) => splitCsvLine(line, delimiter).length);
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

/**
 * RG-M13-03 — choisit le séparateur donnant le nombre de colonnes le plus
 * constant (> 1) sur les 50 premières lignes non vides ; à égalité, `;`.
 */
export function detectCsvDelimiter(text: string): CsvDelimiter {
  const lines = text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, SAMPLE_LINE_COUNT);

  if (lines.length === 0) return DEFAULT_DELIMITER;

  let best: { delimiter: CsvDelimiter; variance: number; avgColumns: number } | null = null;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const counts = countColumns(lines, delimiter);
    const avgColumns = counts.reduce((sum, v) => sum + v, 0) / counts.length;
    if (avgColumns <= 1) continue; // le séparateur ne découpe rien : candidat invalide

    const v = variance(counts);

    if (
      !best ||
      v < best.variance ||
      (v === best.variance &&
        delimiter === DEFAULT_DELIMITER &&
        best.delimiter !== DEFAULT_DELIMITER)
    ) {
      best = { delimiter, variance: v, avgColumns };
    }
  }

  return best?.delimiter ?? DEFAULT_DELIMITER;
}

export function parseCsvLines(text: string, delimiter: string): string[][] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.length > 0)
    .map((line) => splitCsvLine(line, delimiter));
}

const TOTAL_ROW_PATTERN = /^(total|total g[ée]n[ée]ral)\s*:?\s*$/i;

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}

function isTotalRow(row: unknown[]): boolean {
  const firstNonEmpty = row.find(
    (cell) => cell !== null && cell !== undefined && String(cell).trim() !== "",
  );
  return firstNonEmpty !== undefined && TOTAL_ROW_PATTERN.test(String(firstNonEmpty).trim());
}

function isTextLike(cell: unknown): boolean {
  if (cell === null || cell === undefined) return false;
  const value = String(cell).trim();
  if (value === "") return false;
  // Purement numérique (y compris décimal) → pas considéré comme "texte".
  return !/^-?\d+([.,]\d+)?$/.test(value);
}

const HEADER_SEARCH_WINDOW = 10;
const HEADER_TEXT_RATIO_THRESHOLD = 0.6;

/**
 * RG-M13-04 — ligne d'en-tête = première ligne, parmi les 10 premières lignes
 * non vides et non "total", dont ≥ 60 % des cellules sont du texte non
 * numérique. Renvoie l'index (dans `rows`) de la ligne d'en-tête détectée.
 */
export function detectHeaderRowIndex(rows: unknown[][]): number {
  let candidatesChecked = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    if (isEmptyRow(row) || isTotalRow(row)) continue;

    candidatesChecked += 1;
    const nonEmptyCells = row.filter(
      (cell) => cell !== null && cell !== undefined && String(cell).trim() !== "",
    );
    const textCells = nonEmptyCells.filter(isTextLike);
    const ratio = nonEmptyCells.length === 0 ? 0 : textCells.length / nonEmptyCells.length;

    if (ratio >= HEADER_TEXT_RATIO_THRESHOLD) {
      return i;
    }

    if (candidatesChecked >= HEADER_SEARCH_WINDOW) break;
  }

  // Aucune ligne ne satisfait le seuil dans la fenêtre de recherche : on
  // retombe sur la première ligne non vide/non-total rencontrée.
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    if (!isEmptyRow(row) && !isTotalRow(row)) return i;
  }

  return 0;
}

/** Filtre les lignes totalement vides ou de type "TOTAL" (RG-M13-04). */
export function filterDataRows(rows: unknown[][]): unknown[][] {
  return rows.filter((row) => !isEmptyRow(row) && !isTotalRow(row));
}
