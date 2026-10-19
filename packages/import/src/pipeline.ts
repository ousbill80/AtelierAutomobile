/**
 * Orchestration du pipeline d'import fichier (M13). Toute la logique métier
 * pure vit dans `@atelieros/core` (encodage, CSV, mapping, normalisation,
 * dédoublonnage, politique de fusion) ; ce module ne fait qu'enchaîner ces
 * fonctions pures sur un fichier réel (lecture d'octets, feuille Excel),
 * conformément à CLAUDE.md (« Routeurs, jobs et API ne font qu'orchestrer »).
 *
 * RG-M13-01 : `.csv`/`.txt` (délimité, via `core/import/csv`), `.xlsx` (via
 * `exceljs`) et `.xls` (via `xlsx`/SheetJS, format binaire legacy) sont
 * supportés. Les cellules des classeurs Excel sont lues comme texte brut
 * (comme un export CSV) puis passent par le même pipeline de normalisation
 * — y compris pour les dates, volontairement saisies comme texte dans le
 * fixture de test, à l'image des exports « à la française » d'un logiciel
 * existant.
 */
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import {
  decodeBytes,
  detectCsvDelimiter,
  detectEncoding,
  detectHeaderRowIndex,
  filterDataRows,
  hasBlockingError,
  normalizeImportAmount,
  normalizeImportDate,
  normalizeImportEmail,
  normalizeImportName,
  normalizeImportPaymentMethod,
  normalizeImportPhone,
  normalizeImportText,
  normalizePlate,
  parseCsvLines,
  suggestColumnMapping,
  validateCustomerRow,
  validateInvoiceRow,
  validatePaymentRow,
  validateVehicleRow,
  type CsvDelimiter,
  type DetectedEncoding,
  type RowIssue,
  type SuggestedMapping,
  type TargetField,
} from "@atelieros/core";

export type FileFormat = "csv" | "txt" | "xlsx" | "xls";

/** RG-M13-01 — devine le format à partir du nom de fichier. */
export function detectFileFormat(fileName: string): FileFormat | null {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = match?.[1];
  if (ext === "csv" || ext === "txt" || ext === "xlsx" || ext === "xls") return ext;
  return null;
}

export interface ParsedImportFile {
  format: FileFormat;
  /** Non pertinent pour les classeurs Excel (toujours `null`). */
  encoding: DetectedEncoding | null;
  /** Non pertinent pour les classeurs Excel (toujours `null`). */
  delimiter: CsvDelimiter | null;
  headers: string[];
  /** Lignes de données (hors en-tête, hors lignes vides/"total"), déjà alignées sur `headers`. */
  rows: string[][];
  /** Index (base 1, dans le fichier d'origine une fois l'en-tête retiré) de chaque ligne de `rows`. */
  rowNumbers: number[];
}

function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "text" in (value as { text?: unknown })) {
    return String((value as { text: unknown }).text ?? "");
  }
  if (typeof value === "object" && "result" in (value as { result?: unknown })) {
    return String((value as { result: unknown }).result ?? "");
  }
  return String(value);
}

/** RG-M13-01 — lit un classeur `.xlsx` (première feuille non vide) en texte brut. */
async function parseXlsxSheet(bytes: Uint8Array): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  // `exceljs` embarque son propre `@types/node` (plus ancien) : son `Buffer` n'est pas
  // nominalement le même type que le `Buffer<ArrayBufferLike>` résolu ici (TS 5.9 /
  // @types/node 20), bien qu'identique à l'exécution — on cale le cast sur le type attendu
  // par la signature elle-même plutôt que sur l'ambient `Buffer` global.
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0) ?? workbook.worksheets[0];
  if (!sheet) return [];

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = cellToText(cell.value);
    });
    rows.push(values);
  });
  return rows;
}

/** RG-M13-01 — lit un classeur `.xls` (binaire legacy) via SheetJS. */
function parseXlsSheet(bytes: Uint8Array): string[][] {
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  return rows.map((row) => row.map((cell) => String(cell ?? "")));
}

function finalizeRows(allLines: string[][]): {
  headers: string[];
  rows: string[][];
  rowNumbers: number[];
} {
  const headerRowIndex = detectHeaderRowIndex(allLines);
  const headers = (allLines[headerRowIndex] ?? []).map((h) => normalizeImportText(String(h ?? "")));
  const afterHeader = allLines.slice(headerRowIndex + 1);

  const numbered = afterHeader.map((row, index) => ({
    row,
    rowNumber: headerRowIndex + 2 + index,
  }));
  const kept = filterDataRows(numbered.map((n) => n.row));
  const keptSet = new Set(kept);
  const filtered = numbered.filter((n) => keptSet.has(n.row));

  return {
    headers,
    rows: filtered.map((n) => n.row.map((cell) => String(cell ?? ""))),
    rowNumbers: filtered.map((n) => n.rowNumber),
  };
}

export interface ParseImportFileOptions {
  fileName: string;
  forcedEncoding?: DetectedEncoding;
  forcedDelimiter?: CsvDelimiter;
}

/** RG-M13-01 à 04 — lit un fichier (CSV/TXT/XLSX/XLS) et retrouve encodage, séparateur et en-tête. */
export async function parseImportFile(
  bytes: Uint8Array,
  options: ParseImportFileOptions,
): Promise<ParsedImportFile> {
  const format = detectFileFormat(options.fileName);
  if (!format) {
    throw new Error(`Format de fichier non reconnu : « ${options.fileName} ».`);
  }

  if (format === "xlsx") {
    const allLines = await parseXlsxSheet(bytes);
    const { headers, rows, rowNumbers } = finalizeRows(allLines);
    return { format, encoding: null, delimiter: null, headers, rows, rowNumbers };
  }

  if (format === "xls") {
    const allLines = parseXlsSheet(bytes);
    const { headers, rows, rowNumbers } = finalizeRows(allLines);
    return { format, encoding: null, delimiter: null, headers, rows, rowNumbers };
  }

  // csv | txt
  const encoding = detectEncoding(bytes, options.forcedEncoding);
  const text = decodeBytes(bytes, encoding);
  const delimiter = options.forcedDelimiter ?? detectCsvDelimiter(text);
  const allLines = parseCsvLines(text, delimiter);
  const { headers, rows, rowNumbers } = finalizeRows(allLines);
  return { format, encoding, delimiter, headers, rows, rowNumbers };
}

export type ImportEntityName =
  "customers" | "vehicles" | "invoices" | "payments" | "products" | "repair_orders" | "mixed";

export interface MappedRowResult {
  rowNumber: number;
  values: Record<string, unknown>;
  issues: RowIssue[];
}

const DATE_FIELDS = new Set<TargetField>([
  "vehicle.inspectionExpiryDate",
  "vehicle.lastServiceDate",
  "invoice.issuedAt",
  "invoice.dueDate",
  "payment.receivedAt",
]);

const AMOUNT_FIELDS = new Set<TargetField>([
  "invoice.total",
  "invoice.amountPaid",
  "invoice.balance",
  "payment.amount",
]);

const INTEGER_FIELDS = new Set<TargetField>([
  "vehicle.currentMileage",
  "vehicle.lastServiceMileage",
  "vehicle.year",
]);

/** Dispatcher de normalisation par champ cible (RG-M13-10 à 15). */
function normalizeTargetField(
  field: TargetField,
  raw: string,
  now: Date,
): { entries: Record<string, unknown>; warning?: string; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { entries: {} };

  switch (field) {
    case "customer.displayName":
    case "customer.firstName":
    case "customer.lastName":
      return { entries: { [field]: normalizeImportName(trimmed) } };
    case "customer.phone":
    case "customer.phone2": {
      const result = normalizeImportPhone(trimmed);
      const entries: Record<string, unknown> = {};
      if (field === "customer.phone") {
        entries["customer.phone"] = result.phone;
        if (result.phone2) entries["customer.phone2"] = result.phone2;
      } else {
        entries["customer.phone2"] = result.phone;
      }
      return { entries, warning: result.warnings[0], error: result.errors[0] };
    }
    case "customer.email": {
      const result = normalizeImportEmail(trimmed);
      return { entries: { [field]: result.email }, error: result.error };
    }
    case "customer.type":
    case "customer.ncc":
      return { entries: { [field]: normalizeImportText(trimmed) } };
    case "vehicle.plate": {
      const normalized = normalizePlate(trimmed);
      const nonStandard = normalized.plateType !== "STANDARD";
      return {
        entries: { [field]: normalized.plate, "vehicle.plateCompact": normalized.plateCompact },
        warning: nonStandard ? `Format de plaque non standard : « ${raw} ».` : undefined,
      };
    }
    case "vehicle.vin":
      return { entries: { [field]: trimmed.toUpperCase() } };
    case "payment.method":
      return { entries: { [field]: normalizeImportPaymentMethod(trimmed) } };
    default: {
      if (DATE_FIELDS.has(field)) {
        const result = normalizeImportDate(trimmed, now);
        return {
          entries: { [field]: result.date ? result.date.toISOString().slice(0, 10) : null },
          error: result.error,
        };
      }
      if (AMOUNT_FIELDS.has(field)) {
        try {
          const result = normalizeImportAmount(trimmed);
          return { entries: { [field]: result.amount }, warning: result.warning };
        } catch (err) {
          return {
            entries: { [field]: null },
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      if (INTEGER_FIELDS.has(field)) {
        const n = Number.parseInt(trimmed.replace(/\D/g, ""), 10);
        return { entries: { [field]: Number.isNaN(n) ? null : n } };
      }
      // Textes par défaut (noms, références, etc.).
      return { entries: { [field]: normalizeImportText(trimmed) } };
    }
  }
}

/** Applique la correspondance colonne → champ sur une ligne brute, puis normalise chaque valeur. */
export function mapRow(
  headers: readonly string[],
  mapping: Record<string, TargetField>,
  row: readonly string[],
  now: Date,
): { values: Record<string, unknown>; warnings: string[]; errors: string[] } {
  const values: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  headers.forEach((header, index) => {
    const field = mapping[header];
    if (!field) return;
    const raw = row[index] ?? "";
    const { entries, warning, error } = normalizeTargetField(field, String(raw), now);
    Object.assign(values, entries);
    if (warning) warnings.push(warning);
    if (error) errors.push(error);
  });

  return { values, warnings, errors };
}

function customerRefFromValues(values: Record<string, unknown>): string | null {
  return (
    (values["customer.phone"] as string | undefined) ??
    (values["customer.ncc"] as string | undefined) ??
    (values["customer.displayName"] as string | undefined) ??
    null
  );
}

/** RG-M13-16 — valide une ligne déjà mappée/normalisée, selon l'entité du job. */
export function validateMappedRow(
  entity: ImportEntityName,
  values: Record<string, unknown>,
  now: Date,
): RowIssue[] {
  switch (entity) {
    case "customers":
      return validateCustomerRow({
        displayName: (values["customer.displayName"] as string) ?? null,
        phone: (values["customer.phone"] as string) ?? null,
        email: (values["customer.email"] as string) ?? null,
      });
    case "vehicles":
      return validateVehicleRow({
        plate: (values["vehicle.plate"] as string) ?? null,
        ownerPhone: (values["customer.phone"] as string) ?? null,
        ownerExternalId: null,
        ownerName: (values["customer.displayName"] as string) ?? null,
        make: (values["vehicle.make"] as string) ?? null,
        year: (values["vehicle.year"] as number) ?? null,
        nowYear: now.getUTCFullYear(),
      });
    case "invoices": {
      const total = (values["invoice.total"] as number | null) ?? null;
      const amountPaid = (values["invoice.amountPaid"] as number | null) ?? null;
      const issuedAtRaw = values["invoice.issuedAt"] as string | undefined;
      const dueDateRaw = values["invoice.dueDate"] as string | undefined;
      return validateInvoiceRow({
        externalNumber: (values["invoice.externalNumber"] as string) ?? null,
        customerRef: customerRefFromValues(values),
        issuedAt: issuedAtRaw ? new Date(issuedAtRaw) : null,
        dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
        total,
        amountPaid,
      });
    }
    case "payments": {
      const receivedAtRaw = values["payment.receivedAt"] as string | undefined;
      return validatePaymentRow({
        invoiceRef: (values["invoice.externalNumber"] as string) ?? customerRefFromValues(values),
        amount: (values["payment.amount"] as number | null) ?? null,
        receivedAt: receivedAtRaw ? new Date(receivedAtRaw) : null,
      });
    }
    default:
      // "products" / "repair_orders" / "mixed" : hors périmètre de cette étape (voir commit).
      return [];
  }
}

export interface AnalyzedRow {
  rowNumber: number;
  values: Record<string, unknown>;
  issues: RowIssue[];
}

/** Construit les lignes mappées + validées pour une entité, à partir du fichier déjà parsé. */
export function buildAnalyzedRows(
  parsed: ParsedImportFile,
  entity: ImportEntityName,
  columns: Record<string, TargetField>,
  now: Date,
): AnalyzedRow[] {
  return parsed.rows.map((row, index) => {
    const { values, warnings, errors } = mapRow(parsed.headers, columns, row, now);
    const issues: RowIssue[] = [
      ...validateMappedRow(entity, values, now),
      ...warnings.map((message) => ({ message, severity: "WARNING" as const })),
      ...errors.map((message) => ({ message, severity: "ERROR" as const })),
    ];
    return { rowNumber: parsed.rowNumbers[index] ?? index + 1, values, issues };
  });
}

export function rowHasBlockingError(row: AnalyzedRow): boolean {
  return hasBlockingError(row.issues);
}

/** RG-M13-09 — détecte l'entité la plus probable à partir des en-têtes mappés. */
export function suggestEntity(mapping: readonly SuggestedMapping[]): ImportEntityName {
  const counts: Record<string, number> = {
    customers: 0,
    vehicles: 0,
    invoices: 0,
    payments: 0,
    products: 0,
  };
  for (const m of mapping) {
    if (!m.field) continue;
    const [prefix] = m.field.split(".");
    if (prefix === "customer") counts.customers! += 1;
    else if (prefix === "vehicle") counts.vehicles! += 1;
    else if (prefix === "invoice") counts.invoices! += 1;
    else if (prefix === "payment") counts.payments! += 1;
    else if (prefix === "product") counts.products! += 1;
  }
  const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return best && best[1] > 0 ? (best[0] as ImportEntityName) : "mixed";
}

export { suggestColumnMapping };
