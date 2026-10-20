// M12 §7 — exports Excel (`exceljs` : onglets « Données », « Synthèse », « Paramètres », montants
// en nombres au format `# ##0 "FCFA"`), PDF (A4 paysage) et CSV d'un rapport. Les trois
// formats partent du même `ReportResult` que l'aperçu : totaux identiques à l'écran.
import ExcelJS from "exceljs";
import {
  formatCell,
  formatDate,
  frenchDay,
  toCsv,
  type ColumnKind,
  type ReportColumn,
  type ReportRow,
  type ReportSlug,
} from "@atelieros/core";
import { renderReportPdf } from "@atelieros/pdf";
import type { ReportResult } from "./builders";
import type { OrgReportContext } from "./context";
import { columnLabel, reportTitle, RL } from "./labels";

export interface ExportMeta {
  slug: ReportSlug;
  org: OrgReportContext;
  siteName: string | null;
  userName: string;
  now: Date;
}

const NUMERIC: ReadonlySet<ColumnKind> = new Set(["money", "number", "hours", "percent"]);
const P = RL.params;

function paramLines(result: ReportResult, meta: ExportMeta): [string, string][] {
  const lines: [string, string][] = [[P.report, reportTitle(meta.slug)]];
  if (result.period.asOf) lines.push([P.asOf, frenchDay(result.period.asOf)]);
  if (result.period.from && result.period.to) {
    lines.push([P.period, `${frenchDay(result.period.from)} – ${frenchDay(result.period.to)}`]);
  }
  lines.push([P.site, meta.siteName ?? RL.sites.network]);
  lines.push([P.generatedAt, formatDate(meta.now, meta.org.timezone)]);
  lines.push([P.user, meta.userName]);
  return lines;
}

const NUM_FORMAT: Partial<Record<ColumnKind, string>> = {
  money: '# ##0 "FCFA"',
  number: "# ##0.##",
  hours: "0.00",
  percent: "0.0%",
  date: "dd/mm/yyyy",
};

function excelValue(kind: ColumnKind, value: ReportRow[string]): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  if (kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  return value;
}

function addTableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
  totals: Record<string, number> | null,
) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((c) => ({
    header: columnLabel(c.key),
    key: c.key,
    width: NUMERIC.has(c.kind) ? 16 : 28,
    style: NUM_FORMAT[c.kind] ? { numFmt: NUM_FORMAT[c.kind] } : {},
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, excelValue(c.kind, row[c.key])])));
  }
  if (totals && Object.keys(totals).length > 0) {
    const total = sheet.addRow(
      Object.fromEntries(
        columns.map((c, i) => [c.key, i === 0 ? RL.preview.total : (totals[c.key] ?? null)]),
      ),
    );
    total.font = { bold: true };
  }
  return sheet;
}

export async function toXlsx(result: ReportResult, meta: ExportMeta): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AtelierOS";
  addTableSheet(workbook, P.data, result.columns, result.rows, result.totals);
  if (result.summary) {
    const { columns, rows } = result.summary;
    const totals: Record<string, number> = {};
    for (const c of columns) {
      if (c.total) totals[c.key] = rows.reduce((acc, r) => acc + (Number(r[c.key]) || 0), 0);
    }
    addTableSheet(workbook, P.summary, columns, rows, totals);
  } else {
    addTableSheet(
      workbook,
      P.summary,
      result.columns.filter((c) => c.total),
      [result.totals],
      null,
    );
  }
  const params = workbook.addWorksheet(P.title);
  params.columns = [
    { key: "k", width: 22 },
    { key: "v", width: 48 },
  ];
  for (const [k, v] of paramLines(result, meta)) params.addRow({ k, v });
  for (const note of result.notes ?? []) params.addRow({ k: "", v: note });
  params.getColumn("k").font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

function formattedRows(columns: readonly ReportColumn[], rows: readonly ReportRow[]) {
  return rows.map((row) =>
    Object.fromEntries(columns.map((c) => [c.key, formatCell(c.kind, row[c.key] ?? null)])),
  );
}

export async function toPdf(result: ReportResult, meta: ExportMeta): Promise<Uint8Array> {
  const hasTotals = Object.keys(result.totals).length > 0;
  const pdf = await renderReportPdf({
    garage: { name: meta.org.name, legalName: meta.org.legalName, ncc: meta.org.ncc },
    title: reportTitle(meta.slug),
    params: paramLines(result, meta)
      .slice(1)
      .map(([k, v]) => `${k} : ${v}`),
    columns: result.columns.map((c) => ({
      key: c.key,
      label: columnLabel(c.key),
      numeric: NUMERIC.has(c.kind),
    })),
    rows: formattedRows(result.columns, result.rows),
    totals: hasTotals
      ? Object.fromEntries(
          result.columns.map((c) => [
            c.key,
            c.key in result.totals ? formatCell(c.kind, result.totals[c.key]!) : "",
          ]),
        )
      : null,
    totalLabel: RL.preview.total,
    notes: result.notes ?? [],
  });
  return new Uint8Array(pdf);
}

/** CSV (séparateur `;` du journal comptable M08) : montants en nombres entiers, dates dd/MM/yyyy. */
export function toCsvText(result: ReportResult): string {
  const header = result.columns.map((c) => columnLabel(c.key));
  const cell = (c: ReportColumn, v: ReportRow[string]) => {
    if (v === null || v === undefined) return "";
    if (c.kind === "date" && typeof v === "string") return formatCell("date", v);
    if (c.kind === "percent" && typeof v === "number") return Math.round(v * 1000) / 10;
    return v;
  };
  return toCsv(
    header,
    result.rows.map((r) => result.columns.map((c) => cell(c, r[c.key] ?? null))),
  );
}
