// M12 §7 — construction des 9 rapports : mêmes lignes et mêmes totaux pour l'aperçu paginé, les
// exports Excel / PDF / CSV. Les agrégats sont calculés en SQL (GROUP BY, LIMIT/OFFSET) ; les
// formules viennent de `@atelieros/core` (reports, dashboard, inventory, workshop).
import {
  agedBalanceAt,
  asOfDate,
  classifyCustomer,
  laborCostOf,
  localDay,
  OPENING_PAYMENT_REFERENCES,
  rankTopParts,
  ratio,
  REPORTS,
  reportTotals,
  resolveCustomPeriod,
  resolvePeriod,
  shiftDay,
  shiftMonths,
  startOfLocalDay,
  VALID_INVOICE_STATUSES,
  valueOf,
  visibleColumns,
  type ReportColumn,
  type ReportRow,
  type ReportSlug,
  type ResolvedPeriod,
} from "@atelieros/core";
import { Prisma, reportFacts, type SiteScope } from "@atelieros/db";
import type { ReportFilters } from "@atelieros/validators";
import { loadProductivity } from "../workshop/productivity";
import type { OrgReportContext } from "./context";
import { bucketLabel, channelLabel, methodLabel, reminderTypeLabel, RL } from "./labels";

type TenantDb = reportFacts.TenantDb;
const { customerActivities, partAggregates, siteSql, siteWhere } = reportFacts;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const VALID = Prisma.join([...VALID_INVOICE_STATUSES]);

export interface ReportParams {
  t: TenantDb;
  organizationId: string;
  org: OrgReportContext;
  scope: SiteScope;
  filters: ReportFilters;
  now: Date;
  /** `report:financial` : sans elle, colonnes de marge omises (§10). */
  financial: boolean;
}

export interface Page {
  offset: number;
  /** `null` : toutes les lignes (export). */
  limit: number | null;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  count: number;
  totals: Record<string, number>;
  /** Onglet « Synthèse » de l'Excel (balance âgée : synthèse par client). */
  summary?: { columns: ReportColumn[]; rows: ReportRow[] };
  notes?: string[];
  /** Libellés de la période / date de situation (onglet « Paramètres »). */
  period: { from?: string; to?: string; asOf?: string };
}

/** Période d'un rapport : du `from` au `to` inclus ; défaut : mois en cours. */
export function reportPeriod(filters: ReportFilters, now: Date, timeZone: string): ResolvedPeriod {
  if (filters.from && filters.to) return resolveCustomPeriod(filters.from, filters.to, timeZone);
  return resolvePeriod("month", now, timeZone);
}

/** Date de situation (balance âgée, stock) : défaut aujourd'hui, jamais dans le futur. */
export function reportAsOf(filters: ReportFilters, now: Date, timeZone: string): string {
  const today = localDay(now, timeZone);
  return filters.asOf && filters.asOf < today ? filters.asOf : today;
}

function paginate<T>(rows: T[], page: Page): T[] {
  return page.limit === null
    ? rows.slice(page.offset)
    : rows.slice(page.offset, page.offset + page.limit);
}

function limitSql(page: Page): Prisma.Sql {
  return page.limit === null
    ? Prisma.sql`OFFSET ${page.offset}`
    : Prisma.sql`LIMIT ${page.limit} OFFSET ${page.offset}`;
}

const lastIncludedDay = (p: ResolvedPeriod) => shiftDay(p.toDate, -1);

// ─── Ventes ──────────────────────────────────────────────────────────────────

/**
 * Faits de vente par ligne, signés (avoir soustrait : même règle que `signedAmount` de
 * core/reports, RG-M12-03), acomptes et lignes de déduction d'acompte exclus.
 */
function salesFactsSql(p: ReportParams, period: ResolvedPeriod): Prisma.Sql {
  const s = (col: string) =>
    Prisma.sql`CASE WHEN i.type::text = 'CREDIT_NOTE' THEN -ABS(${Prisma.raw(col)}) ELSE ${Prisma.raw(col)} END`;
  const localDate = Prisma.sql`to_char((i."issuedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${p.org.timezone}, 'YYYY-MM-DD')`;
  const where = Prisma.sql`i."organizationId" = ${p.organizationId}
    AND i.type::text IN ('INVOICE', 'CREDIT_NOTE') AND i.status::text IN (${VALID})
    AND i."issuedAt" >= ${period.from} AND i."issuedAt" < ${period.to}
    ${siteSql(p.scope, 'i."siteId"')}`;
  return Prisma.sql`
    WITH f AS (
      SELECT i.id, i.number, i.type::text AS "invoiceType", ${localDate} AS day,
             c."displayName" AS customer, st.name AS site, l.type::text AS "lineType",
             ${s('l."lineSubtotal"')} AS ht, ${s('l."lineVat"')} AS vat, ${s('l."lineTotal"')} AS ttc,
             ${s('ROUND(l.quantity * l."unitPrice") - l."lineSubtotal"')} AS discount
      FROM "Invoice" i JOIN "InvoiceLine" l ON l."invoiceId" = i.id
      JOIN "Customer" c ON c.id = i."customerId" JOIN "Site" st ON st.id = i."siteId"
      WHERE ${where} AND l."depositInvoiceId" IS NULL
      UNION ALL
      SELECT i.id, i.number, i.type::text, ${localDate}, c."displayName", st.name, 'FEE',
             ${s("i.subtotal")}, ${s('i."vatTotal"')}, ${s("i.total")}, 0
      FROM "Invoice" i JOIN "Customer" c ON c.id = i."customerId" JOIN "Site" st ON st.id = i."siteId"
      WHERE ${where} AND NOT EXISTS (SELECT 1 FROM "InvoiceLine" l WHERE l."invoiceId" = i.id)
    )`;
}

const SALES_SUMS = Prisma.sql`
  SUM(ht) FILTER (WHERE "lineType" = 'LABOR') AS labor,
  SUM(ht) FILTER (WHERE "lineType" IN ('PART', 'CONSUMABLE')) AS parts,
  SUM(ht) FILTER (WHERE "lineType" = 'SUBCONTRACT') AS subcontract,
  SUM(ht) FILTER (WHERE "lineType" = 'FEE') AS fees,
  SUM(discount) AS discount, SUM(ht) AS ht, SUM(vat) AS vat, SUM(ttc) AS ttc`;

type SalesSums = Record<
  "labor" | "parts" | "subcontract" | "fees" | "discount" | "ht" | "vat" | "ttc",
  unknown
>;

function salesAmounts(r: SalesSums) {
  return {
    labor: num(r.labor),
    parts: num(r.parts),
    subcontract: num(r.subcontract),
    fees: num(r.fees),
    discount: num(r.discount),
    ht: num(r.ht),
    vat: num(r.vat),
    ttc: num(r.ttc),
  };
}

async function salesReport(p: ReportParams, page: Page): Promise<ReportResult> {
  const period = reportPeriod(p.filters, p.now, p.org.timezone);
  const facts = salesFactsSql(p, period);
  const groupBy = p.filters.groupBy;
  const key =
    groupBy === "day"
      ? Prisma.sql`day`
      : groupBy === "month"
        ? Prisma.sql`substr(day, 1, 7)`
        : groupBy === "customer"
          ? Prisma.sql`customer`
          : Prisma.sql`id`;
  const [rows, counts, totals] = await Promise.all([
    p.t.queryRaw<
      SalesSums & {
        k: string;
        day: string;
        number: string | null;
        customer: string;
        site: string;
        invoiceType: string;
      }
    >(Prisma.sql`
      ${facts}
      SELECT ${key} AS k, MIN(day) AS day, MIN(number) AS number, MIN(customer) AS customer,
             MIN(site) AS site, MIN("invoiceType") AS "invoiceType", ${SALES_SUMS}
      FROM f GROUP BY 1 ORDER BY ${groupBy === "customer" ? Prisma.sql`ht DESC NULLS LAST, 1` : Prisma.sql`MIN(day), MIN(number)`}
      ${limitSql(page)}`),
    p.t.queryRaw<{ n: bigint }>(Prisma.sql`${facts} SELECT COUNT(DISTINCT ${key}) AS n FROM f`),
    p.t.queryRaw<SalesSums>(Prisma.sql`${facts} SELECT ${SALES_SUMS} FROM f`),
  ]);
  const docType = (t: string) => (RL.documentType as Record<string, string>)[t] ?? t;
  return {
    columns: visibleColumns("ventes", p.financial),
    rows: rows.map((r) => ({
      date: groupBy === "month" ? r.k : groupBy === "customer" ? null : r.day,
      number:
        groupBy === "none"
          ? `${r.number ?? ""}${r.invoiceType === "CREDIT_NOTE" ? ` (${docType("CREDIT_NOTE")})` : ""}`
          : null,
      customer: groupBy === "none" || groupBy === "customer" ? r.customer : null,
      site: groupBy === "none" ? r.site : null,
      ...salesAmounts(r),
    })),
    count: num(counts[0]?.n),
    totals: totals[0] ? salesAmounts(totals[0]) : {},
    period: { from: period.fromDate, to: lastIncludedDay(period) },
  };
}

// ─── Encaissements ───────────────────────────────────────────────────────────

async function collectionsReport(p: ReportParams, page: Page): Promise<ReportResult> {
  const period = reportPeriod(p.filters, p.now, p.org.timezone);
  const localDate = (col: string) =>
    Prisma.sql`to_char((${Prisma.raw(col)} AT TIME ZONE 'UTC') AT TIME ZONE ${p.org.timezone}, 'YYYY-MM-DD')`;
  const facts = Prisma.sql`
    WITH f AS (
      SELECT pa.id, ${localDate('pa."receivedAt"')} AS day, pa."receivedAt" AS at, pa.number,
             c."displayName" AS customer, pa.method::text AS method, pa.reference, pa.amount,
             u.name AS cashier,
             (SELECT string_agg(inv.number, ', ' ORDER BY inv.number)
                FROM "PaymentAllocation" al JOIN "Invoice" inv ON inv.id = al."invoiceId"
               WHERE al."paymentId" = pa.id AND al."voidedAt" IS NULL) AS invoices
      FROM "Payment" pa
      LEFT JOIN "Customer" c ON c.id = pa."customerId"
      LEFT JOIN "Membership" m ON m.id = pa."receivedById" LEFT JOIN "User" u ON u.id = m."userId"
      WHERE pa."organizationId" = ${p.organizationId}
        AND pa.status::text IN ('CONFIRMED', 'REFUNDED') AND pa."voidedAt" IS NULL
        AND pa."receivedAt" >= ${period.from} AND pa."receivedAt" < ${period.to}
        AND NOT (pa.origin::text = 'IMPORTED' AND COALESCE(pa.reference, '') IN (${Prisma.join([...OPENING_PAYMENT_REFERENCES])}))
        ${siteSql(p.scope, 'pa."siteId"')}
      UNION ALL
      SELECT r.id, ${localDate('r."createdAt"')}, r."createdAt", NULL, c."displayName",
             r.method::text, r.reference, -ABS(r.amount), u.name, NULL
      FROM "Refund" r
      JOIN "Customer" c ON c.id = r."customerId"
      LEFT JOIN "Membership" m ON m.id = r."createdById" LEFT JOIN "User" u ON u.id = m."userId"
      WHERE r."organizationId" = ${p.organizationId}
        AND r."createdAt" >= ${period.from} AND r."createdAt" < ${period.to}
        ${siteSql(p.scope, 'r."siteId"')}
    )`;
  const [rows, agg, byMethod] = await Promise.all([
    p.t.queryRaw<{
      day: string;
      number: string | null;
      customer: string | null;
      method: string;
      reference: string | null;
      amount: number;
      cashier: string | null;
      invoices: string | null;
    }>(Prisma.sql`${facts} SELECT * FROM f ORDER BY at, number NULLS LAST, id ${limitSql(page)}`),
    p.t.queryRaw<{ n: bigint; amount: bigint | null }>(
      Prisma.sql`${facts} SELECT COUNT(*) AS n, SUM(amount) AS amount FROM f`,
    ),
    p.t.queryRaw<{ method: string; amount: bigint }>(
      Prisma.sql`${facts} SELECT method, SUM(amount) AS amount FROM f GROUP BY 1 ORDER BY 2 DESC`,
    ),
  ]);
  return {
    columns: visibleColumns("encaissements", p.financial),
    rows: rows.map((r) => ({
      date: r.day,
      number: r.number ?? (RL.documentType as Record<string, string>).REFUND!,
      customer: r.customer,
      method: methodLabel(r.method),
      reference: r.reference,
      amount: num(r.amount),
      cashier: r.cashier,
      invoices: r.invoices,
    })),
    count: num(agg[0]?.n),
    totals: { amount: num(agg[0]?.amount) },
    summary: {
      columns: [
        { key: "method", kind: "text" },
        { key: "amount", kind: "money", total: true },
      ],
      rows: byMethod.map((m) => ({ method: methodLabel(m.method), amount: num(m.amount) })),
    },
    period: { from: period.fromDate, to: lastIncludedDay(period) },
  };
}

// ─── Balance âgée ────────────────────────────────────────────────────────────

async function agedBalanceReport(p: ReportParams, page: Page): Promise<ReportResult> {
  const asOf = reportAsOf(p.filters, p.now, p.org.timezone);
  const today = localDay(p.now, p.org.timezone);
  const end = startOfLocalDay(shiftDay(asOf, 1), p.org.timezone);
  // À aujourd'hui : `Invoice.balance` (même chiffre que /creances) ; à une date passée :
  // solde reconstitué (RG-M12-18).
  const live = asOf === today;
  const rows = await p.t.queryRaw<{
    id: string;
    number: string | null;
    customerId: string;
    customerName: string;
    issuedAt: Date;
    dueDate: Date | null;
    total: number;
    balance: number;
    paidAtDate: bigint | null;
    creditedAtDate: bigint | null;
    writtenOff: boolean;
  }>(Prisma.sql`
    SELECT i.id, i.number, i."customerId", c."displayName" AS "customerName", i."issuedAt",
           i."dueDate", i.total, i.balance,
           (SELECT SUM(al.amount) FROM "PaymentAllocation" al JOIN "Payment" pa ON pa.id = al."paymentId"
             WHERE al."invoiceId" = i.id AND al."voidedAt" IS NULL AND pa."voidedAt" IS NULL
               AND pa.status::text IN ('CONFIRMED', 'REFUNDED') AND pa."receivedAt" < ${end}) AS "paidAtDate",
           (SELECT SUM(ABS(cn.total)) FROM "Invoice" cn
             WHERE cn."creditedInvoiceId" = i.id AND cn.type::text = 'CREDIT_NOTE'
               AND cn.status::text <> 'DRAFT' AND cn."issuedAt" < ${end}) AS "creditedAtDate",
           (i."writtenOffAt" IS NOT NULL AND i."writtenOffAt" < ${end}) AS "writtenOff"
    FROM "Invoice" i JOIN "Customer" c ON c.id = i."customerId"
    WHERE i."organizationId" = ${p.organizationId} AND i.type::text = 'INVOICE'
      AND i."billTo"::text = 'CUSTOMER' AND i."issuedAt" < ${end}
      ${live ? Prisma.sql`AND i.status::text IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'DISPUTED') AND i.balance > 0` : Prisma.sql`AND i.status::text <> 'DRAFT'`}
      ${siteSql(p.scope, 'i."siteId"')}`);
  const aged = agedBalanceAt(
    rows.map((r) => ({
      id: r.id,
      number: r.number,
      customerId: r.customerId,
      customerName: r.customerName,
      issuedAt: r.issuedAt,
      dueDate: r.dueDate,
      total: r.total,
      paidAtDate: live ? r.total - r.balance : num(r.paidAtDate),
      creditedAtDate: live ? 0 : num(r.creditedAtDate),
      writtenOffAtDate: live ? false : r.writtenOff,
    })),
    asOfDate(asOf),
  );
  const day = (d: Date | null) => (d ? localDay(d, p.org.timezone) : null);
  const all = aged.rows.map((r) => ({
    customer: r.customerName,
    number: r.number,
    issuedAt: day(r.issuedAt),
    dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
    total: r.total,
    paid: r.paid,
    balance: r.balance,
    daysLate: r.daysLate,
    bucket: bucketLabel(r.bucket),
  }));
  const columns = visibleColumns("balance-agee", p.financial);
  return {
    columns,
    rows: paginate(all, page),
    count: all.length,
    totals: reportTotals(columns, all),
    summary: {
      columns: [
        { key: "customer", kind: "text" },
        { key: "notDue", kind: "money", total: true },
        { key: "b0_30", kind: "money", total: true },
        { key: "b31_60", kind: "money", total: true },
        { key: "b61_90", kind: "money", total: true },
        { key: "b90p", kind: "money", total: true },
        { key: "balance", kind: "money", total: true },
      ],
      rows: aged.byCustomer.map((c) => ({
        customer: c.customerName,
        ...c.buckets,
        balance: c.total,
      })),
    },
    period: { asOf },
  };
}

// ─── Rentabilité par OR ──────────────────────────────────────────────────────

async function repairOrderProfitReport(p: ReportParams, page: Page): Promise<ReportResult> {
  const period = reportPeriod(p.filters, p.now, p.org.timezone);
  const s = (col: string) =>
    Prisma.sql`CASE WHEN i.type::text = 'CREDIT_NOTE' THEN -ABS(${Prisma.raw(col)}) ELSE ${Prisma.raw(col)} END`;
  const orders = await p.t.queryRaw<{
    id: string;
    number: string;
    customer: string;
    vehicle: string;
    laborHt: bigint | null;
    partsHt: bigint | null;
    otherHt: bigint | null;
    partsCost: bigint | null;
  }>(Prisma.sql`
    SELECT ro.id, ro.number, c."displayName" AS customer,
           btrim(concat_ws(' ', v.plate, v.make, v.model)) AS vehicle,
           SUM(${s('l."lineSubtotal"')}) FILTER (WHERE l.type::text = 'LABOR') AS "laborHt",
           SUM(${s('l."lineSubtotal"')}) FILTER (WHERE l.type::text IN ('PART', 'CONSUMABLE')) AS "partsHt",
           SUM(${s('l."lineSubtotal"')}) FILTER (WHERE l.type::text IN ('FEE', 'SUBCONTRACT')) AS "otherHt",
           SUM(${s('l."costAmount"')}) FILTER (WHERE l.type::text IN ('PART', 'CONSUMABLE')) AS "partsCost"
    FROM "Invoice" i JOIN "InvoiceLine" l ON l."invoiceId" = i.id
    JOIN "RepairOrder" ro ON ro.id = i."repairOrderId"
    JOIN "Customer" c ON c.id = ro."customerId" JOIN "Vehicle" v ON v.id = ro."vehicleId"
    WHERE i."organizationId" = ${p.organizationId}
      AND i.type::text IN ('INVOICE', 'CREDIT_NOTE') AND i.status::text IN (${VALID})
      AND i."issuedAt" >= ${period.from} AND i."issuedAt" < ${period.to}
      AND l."depositInvoiceId" IS NULL
      ${siteSql(p.scope, 'i."siteId"')}
    GROUP BY ro.id, ro.number, c."displayName", v.plate, v.make, v.model
    ORDER BY ro.number`);
  const ids = orders.map((o) => o.id);
  const [labor, hours] = ids.length
    ? await Promise.all([
        p.t.queryRaw<{
          repairOrderId: string;
          hourlyCost: number | null;
          minutes: number;
        }>(Prisma.sql`
          SELECT te."repairOrderId" AS "repairOrderId", m."hourlyCost" AS "hourlyCost",
                 SUM(GREATEST(0, EXTRACT(EPOCH FROM (te."endedAt" - te."startedAt")) / 60
                     - te."pauseMinutes"))::float8 AS minutes
          FROM "TimeEntry" te JOIN "Membership" m ON m.id = te."membershipId"
          WHERE te."organizationId" = ${p.organizationId} AND te."endedAt" IS NOT NULL
            AND te."repairOrderId" IN (${Prisma.join(ids)})
          GROUP BY 1, 2`),
        p.t.queryRaw<{ repairOrderId: string; sold: number }>(Prisma.sql`
          SELECT l."repairOrderId" AS "repairOrderId", SUM(l.quantity)::float8 AS sold
          FROM "RepairOrderLine" l
          WHERE l."organizationId" = ${p.organizationId} AND l.type::text = 'LABOR'
            AND l.status::text <> 'CANCELLED' AND l."repairOrderId" IN (${Prisma.join(ids)})
          GROUP BY 1`),
      ])
    : [[], []];
  let estimated = false;
  const all = orders.map((o) => {
    const entries = labor.filter((l) => l.repairOrderId === o.id);
    const cost = laborCostOf(
      entries.map((e) => ({ minutes: num(e.minutes), hourlyCost: e.hourlyCost })),
      p.org.defaultMechanicHourlyCost,
    );
    if (cost.estimated) estimated = true;
    const laborHt = num(o.laborHt);
    const partsHt = num(o.partsHt);
    const partsCost = num(o.partsCost);
    const ht = laborHt + partsHt + num(o.otherHt);
    const margin = ht - cost.cost - partsCost;
    const workedMinutes = entries.reduce((acc, e) => acc + num(e.minutes), 0);
    return {
      number: o.number,
      customer: o.customer,
      vehicle: o.vehicle,
      laborHt,
      laborCost: cost.cost,
      partsHt,
      partsCost,
      margin,
      marginRate: ratio(margin, ht),
      soldHours: Math.round(num(hours.find((h) => h.repairOrderId === o.id)?.sold) * 100) / 100,
      workedHours: Math.round((workedMinutes / 60) * 100) / 100,
    };
  });
  const columns = visibleColumns("rentabilite-or", p.financial);
  return {
    columns,
    rows: paginate(all, page),
    count: all.length,
    totals: reportTotals(columns, all),
    notes: estimated ? [RL.preview.estimatedCost] : undefined,
    period: { from: period.fromDate, to: lastIncludedDay(period) },
  };
}

// ─── Stock valorisé ──────────────────────────────────────────────────────────

async function stockValuationReport(p: ReportParams, page: Page): Promise<ReportResult> {
  const asOf = reportAsOf(p.filters, p.now, p.org.timezone);
  const end = startOfLocalDay(shiftDay(asOf, 1), p.org.timezone);
  // `onHand` à la date = actuel − Σ mouvements postérieurs ; valorisé au CMP actuel (§7).
  const rows = await p.t.queryRaw<{
    site: string;
    sku: string;
    name: string;
    category: string | null;
    onHand: number;
    scale: number;
    averageCost: number;
  }>(Prisma.sql`
    SELECT st.name AS site, pr.sku, pr.name, pr.category,
           (sl."onHand" - COALESCE((SELECT SUM(mv.quantity) FROM "StockMovement" mv
              WHERE mv."organizationId" = ${p.organizationId} AND mv."productId" = sl."productId"
                AND mv."siteId" = sl."siteId" AND mv."createdAt" >= ${end}), 0))::int AS "onHand",
           pr."quantityScale" AS scale, pr."averageCost" AS "averageCost"
    FROM "StockLevel" sl JOIN "Product" pr ON pr.id = sl."productId" JOIN "Site" st ON st.id = sl."siteId"
    WHERE sl."organizationId" = ${p.organizationId}
      ${siteSql(p.scope, 'sl."siteId"')}
    ORDER BY st.name, pr.sku`);
  const all = rows
    .filter((r) => r.onHand !== 0)
    .map((r) => ({
      site: r.site,
      sku: r.sku,
      name: r.name,
      category: r.category,
      quantity: r.onHand / Math.max(1, r.scale),
      averageCost: r.averageCost,
      // Stock négatif : valeur 0 (RG-M07-09), quantité affichée pour correction.
      value: r.onHand > 0 ? valueOf(r.onHand, r.scale, r.averageCost) : 0,
    }));
  const columns = visibleColumns("stock-valorise", p.financial);
  return {
    columns,
    rows: paginate(all, page),
    count: all.length,
    totals: reportTotals(columns, all),
    notes: [RL.preview.valuationNote],
    period: { asOf },
  };
}

// ─── Performances des relances ───────────────────────────────────────────────

async function remindersReport(p: ReportParams, page: Page): Promise<ReportResult> {
  const period = reportPeriod(p.filters, p.now, p.org.timezone);
  // Relance → site de la facture (RG-M12-02) ; sans facture : « Tous les sites » seulement.
  const site = p.scope.siteIds
    ? Prisma.sql`AND inv."siteId" IN (${Prisma.join(p.scope.siteIds)})`
    : Prisma.empty;
  const rows = await p.t.queryRaw<{
    type: string;
    step: string;
    channel: string | null;
    sent: bigint;
    delivered: bigint;
    read: bigint;
    replied: bigint;
    booked: bigint;
    paid: bigint;
    recovered: bigint | null;
    cost: bigint | null;
  }>(Prisma.sql`
    SELECT r.type::text AS type, r."stepKey" AS step, r.channel::text AS channel,
           COUNT(*) AS sent,
           COUNT(*) FILTER (WHERE msg.status::text IN ('DELIVERED', 'READ')) AS delivered,
           COUNT(*) FILTER (WHERE msg.status::text = 'READ') AS read,
           COUNT(*) FILTER (WHERE r.outcome::text = 'REPLIED') AS replied,
           COUNT(*) FILTER (WHERE r.outcome::text IN ('APPOINTMENT_BOOKED', 'VISITED')) AS booked,
           COUNT(*) FILTER (WHERE r.outcome::text IN ('PAID', 'PARTIALLY_PAID')) AS paid,
           SUM((SELECT SUM(pat.amount) FROM "PaymentAttribution" pat
                 WHERE pat."reminderId" = r.id AND pat.source = 'reminder')) AS recovered,
           SUM(msg.cost) AS cost
    FROM "Reminder" r
    LEFT JOIN "Message" msg ON msg.id = r."messageId"
    LEFT JOIN "Invoice" inv ON inv.id = r."invoiceId"
    WHERE r."organizationId" = ${p.organizationId} AND r.status::text = 'SENT'
      AND r."sentAt" >= ${period.from} AND r."sentAt" < ${period.to}
      ${site}
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3`);
  const all = rows.map((r) => ({
    type: reminderTypeLabel(r.type),
    step: r.step,
    channel: channelLabel(r.channel),
    sent: num(r.sent),
    delivered: num(r.delivered),
    read: num(r.read),
    replied: num(r.replied),
    booked: num(r.booked),
    paid: num(r.paid),
    recovered: num(r.recovered),
    cost: num(r.cost),
  }));
  const columns = visibleColumns("relances", p.financial);
  return {
    columns,
    rows: paginate(all, page),
    count: all.length,
    totals: reportTotals(columns, all),
    period: { from: period.fromDate, to: lastIncludedDay(period) },
  };
}

// ─── Productivité ────────────────────────────────────────────────────────────

async function productivityReport(p: ReportParams, page: Page): Promise<ReportResult> {
  const period = reportPeriod(p.filters, p.now, p.org.timezone);
  const mechanics = await p.t.transaction((tx) =>
    loadProductivity(tx, {
      timeZone: p.org.timezone,
      from: period.from,
      to: period.to,
      siteId: p.scope.siteIds?.length === 1 ? p.scope.siteIds[0] : undefined,
      repairOrderWhere: siteWhere(p.scope),
      now: p.now,
    }),
  );
  const pct = (v: number | null) => (v === null ? null : v / 100);
  const all = mechanics.map((m) => ({
    mechanic: m.name,
    presenceH: m.presenceH,
    workedH: m.workedH,
    billedH: m.billedH,
    efficiency: pct(m.efficiency),
    productivity: pct(m.productivity),
    overall: pct(m.overall),
    repairOrders: m.repairOrders,
  }));
  const columns = visibleColumns("productivite", p.financial);
  return {
    columns,
    rows: paginate(all, page),
    count: all.length,
    totals: reportTotals(columns, all),
    period: { from: period.fromDate, to: lastIncludedDay(period) },
  };
}

// ─── Clients actifs / perdus ─────────────────────────────────────────────────

async function customersReport(p: ReportParams, page: Page): Promise<ReportResult> {
  const period = reportPeriod(p.filters, p.now, p.org.timezone);
  const since12 = shiftMonths(period.to, -12);
  const [activities, revenue, names] = await Promise.all([
    customerActivities(p.t, p.organizationId, p.scope, period.to),
    p.t.queryRaw<{ customerId: string; ht: bigint }>(Prisma.sql`
      SELECT i."customerId" AS "customerId",
             SUM(CASE WHEN i.type::text = 'CREDIT_NOTE' THEN -ABS(i.subtotal) ELSE i.subtotal END) AS ht
      FROM "Invoice" i
      WHERE i."organizationId" = ${p.organizationId}
        AND i.type::text IN ('INVOICE', 'CREDIT_NOTE') AND i.status::text IN (${VALID})
        AND i."issuedAt" >= ${since12} AND i."issuedAt" < ${period.to}
        ${siteSql(p.scope, 'i."siteId"')}
      GROUP BY 1`),
    p.t.customer.findMany({ where: { deletedAt: null }, select: { id: true, displayName: true } }),
  ]);
  const nameOf = new Map(names.map((c) => [c.id, c.displayName]));
  const revenueOf = new Map(revenue.map((r) => [r.customerId, num(r.ht)]));
  const all = activities
    .map((a) => ({ a, status: classifyCustomer(a, period.to) }))
    .filter(({ status }) => status !== "inactive")
    .map(({ a, status }) => ({
      customer: nameOf.get(a.customerId) ?? "",
      lastActivity: localDay(a.lastAt, p.org.timezone),
      revenue12m: revenueOf.get(a.customerId) ?? 0,
      status: (RL.customerStatus as Record<string, string>)[status] ?? status,
    }))
    .sort((x, y) => y.revenue12m - x.revenue12m || x.customer.localeCompare(y.customer));
  const columns = visibleColumns("clients", p.financial);
  return {
    columns,
    rows: paginate(all, page),
    count: all.length,
    totals: reportTotals(columns, all),
    period: { from: period.fromDate, to: lastIncludedDay(period) },
  };
}

// ─── Top pièces ──────────────────────────────────────────────────────────────

async function topPartsReport(p: ReportParams, page: Page): Promise<ReportResult> {
  const period = reportPeriod(p.filters, p.now, p.org.timezone);
  const parts = rankTopParts(
    await partAggregates(p.t, p.organizationId, p.scope, period.from, period.to),
  );
  const all = parts.map((x) => ({
    label: x.label,
    quantity: x.quantity,
    ht: x.ht,
    ...(p.financial ? { margin: x.margin } : {}),
    repairOrders: x.repairOrders,
  }));
  const columns = visibleColumns("top-pieces", p.financial);
  return {
    columns,
    rows: paginate(all, page),
    count: all.length,
    totals: reportTotals(columns, all),
    period: { from: period.fromDate, to: lastIncludedDay(period) },
  };
}

const BUILDERS: Record<ReportSlug, (p: ReportParams, page: Page) => Promise<ReportResult>> = {
  ventes: salesReport,
  encaissements: collectionsReport,
  "balance-agee": agedBalanceReport,
  "rentabilite-or": repairOrderProfitReport,
  "stock-valorise": stockValuationReport,
  relances: remindersReport,
  productivite: productivityReport,
  clients: customersReport,
  "top-pieces": topPartsReport,
};

export function buildReport(slug: ReportSlug, p: ReportParams, page: Page): Promise<ReportResult> {
  return BUILDERS[slug](p, page);
}

export { REPORTS };
