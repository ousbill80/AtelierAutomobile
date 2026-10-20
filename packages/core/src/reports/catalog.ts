// M12 §7 — catalogue des 9 rapports exportables : permission requise (§10), colonnes (clé +
// nature, les libellés sont dans `fr.json`), nom de fichier. Les écrans, les exports Excel /
// PDF / CSV et les totaux lisent la même définition : un export est identique à l'écran.

export const REPORT_SLUGS = [
  "ventes",
  "encaissements",
  "balance-agee",
  "rentabilite-or",
  "stock-valorise",
  "relances",
  "productivite",
  "clients",
  "top-pieces",
] as const;
export type ReportSlug = (typeof REPORT_SLUGS)[number];

export type ReportPermission = "report:read" | "report:financial";
export type ColumnKind = "text" | "date" | "money" | "number" | "hours" | "percent";

export interface ReportColumn {
  key: string;
  kind: ColumnKind;
  /** Colonne totalisée (ligne « Total » de l'écran et des exports). */
  total?: boolean;
  /** Colonne de marge ou de coût : omise côté serveur sans `report:financial` (§10). */
  financial?: boolean;
}

export interface ReportDefinition {
  slug: ReportSlug;
  permission: ReportPermission;
  /** Filtre principal : période `[from, to]` ou date de situation `asOf`. */
  filter: "period" | "asOf";
  columns: readonly ReportColumn[];
}

const money = (key: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({
  key,
  kind: "money",
  total: true,
  ...extra,
});

export const REPORTS: Record<ReportSlug, ReportDefinition> = {
  ventes: {
    slug: "ventes",
    permission: "report:financial",
    filter: "period",
    columns: [
      { key: "date", kind: "date" },
      { key: "number", kind: "text" },
      { key: "customer", kind: "text" },
      { key: "site", kind: "text" },
      money("labor"),
      money("parts"),
      money("subcontract"),
      money("fees"),
      money("discount"),
      money("ht"),
      money("vat"),
      money("ttc"),
    ],
  },
  encaissements: {
    slug: "encaissements",
    permission: "report:financial",
    filter: "period",
    columns: [
      { key: "date", kind: "date" },
      { key: "number", kind: "text" },
      { key: "customer", kind: "text" },
      { key: "method", kind: "text" },
      { key: "reference", kind: "text" },
      money("amount"),
      { key: "cashier", kind: "text" },
      { key: "invoices", kind: "text" },
    ],
  },
  "balance-agee": {
    slug: "balance-agee",
    permission: "report:financial",
    filter: "asOf",
    columns: [
      { key: "customer", kind: "text" },
      { key: "number", kind: "text" },
      { key: "issuedAt", kind: "date" },
      { key: "dueDate", kind: "date" },
      money("total"),
      money("paid"),
      money("balance"),
      { key: "daysLate", kind: "number" },
      { key: "bucket", kind: "text" },
    ],
  },
  "rentabilite-or": {
    slug: "rentabilite-or",
    permission: "report:financial",
    filter: "period",
    columns: [
      { key: "number", kind: "text" },
      { key: "customer", kind: "text" },
      { key: "vehicle", kind: "text" },
      money("laborHt"),
      money("laborCost"),
      money("partsHt"),
      money("partsCost"),
      money("margin"),
      { key: "marginRate", kind: "percent" },
      { key: "soldHours", kind: "hours", total: true },
      { key: "workedHours", kind: "hours", total: true },
    ],
  },
  "stock-valorise": {
    slug: "stock-valorise",
    permission: "report:financial",
    filter: "asOf",
    columns: [
      { key: "site", kind: "text" },
      { key: "sku", kind: "text" },
      { key: "name", kind: "text" },
      { key: "category", kind: "text" },
      { key: "quantity", kind: "number" },
      { key: "averageCost", kind: "money" },
      money("value"),
    ],
  },
  relances: {
    slug: "relances",
    permission: "report:read",
    filter: "period",
    columns: [
      { key: "type", kind: "text" },
      { key: "step", kind: "text" },
      { key: "channel", kind: "text" },
      { key: "sent", kind: "number", total: true },
      { key: "delivered", kind: "number", total: true },
      { key: "read", kind: "number", total: true },
      { key: "replied", kind: "number", total: true },
      { key: "booked", kind: "number", total: true },
      { key: "paid", kind: "number", total: true },
      money("recovered"),
      money("cost"),
    ],
  },
  productivite: {
    slug: "productivite",
    permission: "report:read",
    filter: "period",
    columns: [
      { key: "mechanic", kind: "text" },
      { key: "presenceH", kind: "hours", total: true },
      { key: "workedH", kind: "hours", total: true },
      { key: "billedH", kind: "hours", total: true },
      { key: "efficiency", kind: "percent" },
      { key: "productivity", kind: "percent" },
      { key: "overall", kind: "percent" },
      { key: "repairOrders", kind: "number", total: true },
    ],
  },
  clients: {
    slug: "clients",
    permission: "report:read",
    filter: "period",
    columns: [
      { key: "customer", kind: "text" },
      { key: "lastActivity", kind: "date" },
      money("revenue12m"),
      { key: "status", kind: "text" },
    ],
  },
  "top-pieces": {
    slug: "top-pieces",
    permission: "report:read",
    filter: "period",
    columns: [
      { key: "label", kind: "text" },
      { key: "quantity", kind: "number", total: true },
      money("ht"),
      money("margin", { financial: true }),
      { key: "repairOrders", kind: "number" },
    ],
  },
};

export function isReportSlug(value: string): value is ReportSlug {
  return (REPORT_SLUGS as readonly string[]).includes(value);
}

/** §10 : colonnes visibles selon `report:financial` (marges omises côté serveur). */
export function visibleColumns(slug: ReportSlug, hasFinancial: boolean): ReportColumn[] {
  return REPORTS[slug].columns.filter((c) => hasFinancial || !c.financial);
}

/** §11 : au-delà, l'export est refusé (« Réduisez la période »). */
export const MAX_EXPORT_ROWS = 100_000;
/** §7 : aperçu paginé à l'écran. */
export const PREVIEW_PAGE_SIZE = 50;

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

/** Totaux des colonnes `total: true` (entiers FCFA, heures arrondies au centième). */
export function reportTotals(columns: readonly ReportColumn[], rows: readonly ReportRow[]) {
  const totals: Record<string, number> = {};
  for (const column of columns) {
    if (!column.total) continue;
    let sum = 0;
    for (const row of rows) {
      const v = row[column.key];
      if (typeof v === "number") sum += v;
    }
    totals[column.key] = column.kind === "hours" ? Math.round(sum * 100) / 100 : sum;
  }
  return totals;
}

function slugifyPart(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "site"
  );
}

/** §7 : `{slug}_{from}_{to}_{site|reseau}.{xlsx|pdf|csv}` (date de situation seule pour asOf). */
export function reportFileName(input: {
  slug: ReportSlug;
  from?: string;
  to?: string;
  asOf?: string;
  site?: string | null;
  format: "xlsx" | "pdf" | "csv";
}): string {
  const dates =
    REPORTS[input.slug].filter === "asOf" ? [input.asOf ?? ""] : [input.from ?? "", input.to ?? ""];
  const scope = input.site ? slugifyPart(input.site) : "reseau";
  return `${[input.slug, ...dates, scope].join("_")}.${input.format}`;
}

/** Valeur d'une cellule telle qu'affichée (CSV, PDF) ; l'Excel garde les nombres. */
export function formatCell(kind: ColumnKind, value: ReportCell): string {
  if (value === null || value === "") return "";
  if (typeof value === "string") {
    if (kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-");
      return `${d}/${m}/${y}`;
    }
    return value;
  }
  const group = (n: number) =>
    Math.abs(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  switch (kind) {
    case "money":
      return `${value < 0 ? "-" : ""}${group(Math.round(value))} FCFA`;
    case "percent":
      return `${(value * 100).toFixed(1).replace(".", ",")} %`;
    case "hours":
      return `${value.toFixed(2).replace(".", ",")} h`;
    default:
      return `${value < 0 ? "-" : ""}${group(value)}`;
  }
}
