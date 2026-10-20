// M12 — faits agrégés en base (GROUP BY sur requêtes indexées, jamais toutes les lignes en
// mémoire). Chaque fonction renvoie des numérateurs / dénominateurs ; les formules restent dans
// `@atelieros/core` (reports, dashboard). Requêtes via `db.forTenant` (Prisma ou `queryRaw`
// sous RLS), toujours filtrées par organisation et par site (RG-M12-02).
import {
  capacityMinutes,
  collectedByMethod,
  daysOf,
  normalizeDescription,
  OPENING_PAYMENT_REFERENCES,
  OPEN_INVOICE_STATUSES,
  QUOTE_DECIDED_STATUSES,
  VALID_INVOICE_STATUSES,
  type CollectedSummary,
  type CustomerActivity,
  type OpeningHours,
  type PartAggregate,
  type QuoteDecisionAggregate,
  type ReceivableInvoiceLike,
  type RevenueAggregateRow,
  type WorkedMinutesByMechanic,
} from "@atelieros/core";
import { Prisma } from "@prisma/client";
import type { db } from "../tenant";

/** `siteIds = null` : « Tous les sites » (faits non attribuables inclus), RG-M12-02. */
export type SiteScope = { siteIds: string[] | null };

export type TenantDb = ReturnType<typeof db.forTenant>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** `AND <colonne> IN (…)` si le périmètre est restreint. */
export function siteSql(scope: SiteScope, column: string): Prisma.Sql {
  return scope.siteIds
    ? Prisma.sql`AND ${Prisma.raw(column)} IN (${Prisma.join(scope.siteIds)})`
    : Prisma.empty;
}

export function siteWhere(scope: SiteScope): { siteId?: { in: string[] } } {
  return scope.siteIds ? { siteId: { in: scope.siteIds } } : {};
}

const VALID = Prisma.join([...VALID_INVOICE_STATUSES]);

/** RG-M12-03 : facture valide (INVOICE ou avoir) émise dans `[from, to)`. */
function validInvoiceSql(
  organizationId: string,
  scope: SiteScope,
  from: Date,
  to: Date,
): Prisma.Sql {
  return Prisma.sql`i."organizationId" = ${organizationId}
    AND i.type::text IN ('INVOICE', 'CREDIT_NOTE')
    AND i.status::text IN (${VALID})
    AND i."issuedAt" >= ${from} AND i."issuedAt" < ${to}
    ${siteSql(scope, 'i."siteId"')}`;
}

/**
 * RG-M12-05 à 08 — sommes par (type de facture, type de ligne). Les lignes de déduction
 * d'acompte sont exclues (l'acompte n'est jamais du CA, la facture finale reprend les lignes) ;
 * une facture importée sans lignes est comptée sur son en-tête.
 */
export async function revenueAggregates(
  t: TenantDb,
  organizationId: string,
  scope: SiteScope,
  from: Date,
  to: Date,
): Promise<RevenueAggregateRow[]> {
  const where = validInvoiceSql(organizationId, scope, from, to);
  const rows = await t.queryRaw<{
    invoiceType: string;
    lineType: string | null;
    subtotal: bigint;
    total: bigint;
    cost: bigint;
    uncosted: bigint;
  }>(Prisma.sql`
    SELECT i.type::text AS "invoiceType", l.type::text AS "lineType",
           SUM(l."lineSubtotal") AS subtotal, SUM(l."lineTotal") AS total,
           SUM(l."costAmount") AS cost,
           COUNT(*) FILTER (WHERE l.type::text IN ('PART', 'CONSUMABLE')
                            AND l."costAmount" = 0 AND l."lineSubtotal" <> 0) AS uncosted
    FROM "Invoice" i JOIN "InvoiceLine" l ON l."invoiceId" = i.id
    WHERE ${where} AND l."depositInvoiceId" IS NULL
    GROUP BY 1, 2
    UNION ALL
    SELECT i.type::text, NULL, SUM(i.subtotal), SUM(i.total), 0, 0
    FROM "Invoice" i
    WHERE ${where}
      AND NOT EXISTS (SELECT 1 FROM "InvoiceLine" l WHERE l."invoiceId" = i.id)
    GROUP BY 1`);
  return rows.map((r) => ({
    invoiceType: r.invoiceType,
    lineType: r.lineType,
    subtotal: num(r.subtotal),
    total: num(r.total),
    cost: num(r.cost),
    uncostedLines: num(r.uncosted),
  }));
}

/** CA HT par jour local (graphique « CA HT par jour », M12 §7) — agrégats bruts par type. */
export async function revenueByDay(
  t: TenantDb,
  organizationId: string,
  scope: SiteScope,
  from: Date,
  to: Date,
  timeZone: string,
): Promise<{ day: string; invoiceType: string; subtotal: number }[]> {
  const where = validInvoiceSql(organizationId, scope, from, to);
  const localDay = Prisma.sql`to_char((i."issuedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`;
  const rows = await t.queryRaw<{ day: string; invoiceType: string; subtotal: bigint }>(Prisma.sql`
    SELECT ${localDay} AS day, i.type::text AS "invoiceType", SUM(l."lineSubtotal") AS subtotal
    FROM "Invoice" i JOIN "InvoiceLine" l ON l."invoiceId" = i.id
    WHERE ${where} AND l."depositInvoiceId" IS NULL
    GROUP BY 1, 2
    UNION ALL
    SELECT ${localDay}, i.type::text, SUM(i.subtotal)
    FROM "Invoice" i
    WHERE ${where}
      AND NOT EXISTS (SELECT 1 FROM "InvoiceLine" l WHERE l."invoiceId" = i.id)
    GROUP BY 1, 2`);
  return rows.map((r) => ({ day: r.day, invoiceType: r.invoiceType, subtotal: num(r.subtotal) }));
}

/** RG-M12-11 : dénominateur du panier moyen (factures INVOICE valides, avoirs exclus). */
export function invoiceCount(t: TenantDb, scope: SiteScope, from: Date, to: Date) {
  return t.invoice.count({
    where: {
      ...siteWhere(scope),
      type: "INVOICE",
      status: { in: [...VALID_INVOICE_STATUSES] },
      issuedAt: { gte: from, lt: to },
    },
  });
}

/** RG-M12-09 : minutes pointées (terminées) par mécanicien sur les OR des factures de la période. */
export async function laborMinutesOfInvoicedOrders(
  t: TenantDb,
  organizationId: string,
  scope: SiteScope,
  from: Date,
  to: Date,
): Promise<WorkedMinutesByMechanic[]> {
  const rows = await t.queryRaw<{ minutes: number | null; hourlyCost: number | null }>(Prisma.sql`
    SELECT m."hourlyCost" AS "hourlyCost",
           SUM(GREATEST(0, EXTRACT(EPOCH FROM (te."endedAt" - te."startedAt")) / 60
               - te."pauseMinutes"))::float8 AS minutes
    FROM "TimeEntry" te JOIN "Membership" m ON m.id = te."membershipId"
    WHERE te."organizationId" = ${organizationId} AND te."endedAt" IS NOT NULL
      AND te."repairOrderId" IN (
        SELECT i."repairOrderId" FROM "Invoice" i
        WHERE ${validInvoiceSql(organizationId, scope, from, to)}
          AND i.type::text = 'INVOICE' AND i."repairOrderId" IS NOT NULL)
    GROUP BY te."membershipId", m."hourlyCost"`);
  return rows.map((r) => ({ minutes: num(r.minutes), hourlyCost: r.hourlyCost }));
}

/** RG-M12-20 : encaissements confirmés par mode, remboursements déduits. */
export async function collected(
  t: TenantDb,
  scope: SiteScope,
  from: Date,
  to: Date,
): Promise<CollectedSummary> {
  const [payments, refunds] = await Promise.all([
    t.payment.groupBy({
      by: ["method"],
      where: {
        ...siteWhere(scope),
        status: { in: ["CONFIRMED", "REFUNDED"] },
        voidedAt: null,
        receivedAt: { gte: from, lt: to },
        NOT: { origin: "IMPORTED", reference: { in: [...OPENING_PAYMENT_REFERENCES] } },
      },
      _sum: { amount: true },
    }),
    t.refund.groupBy({
      by: ["method"],
      where: { ...siteWhere(scope), createdAt: { gte: from, lt: to } },
      _sum: { amount: true },
    }),
  ]);
  return collectedByMethod(
    payments.map((p) => ({ method: p.method, amount: p._sum.amount ?? 0 })),
    refunds.map((r) => ({ method: r.method, amount: r._sum.amount ?? 0 })),
  );
}

/** RG-M12-12 : OR ouverts et livrés sur la période. */
export async function repairOrderCounts(t: TenantDb, scope: SiteScope, from: Date, to: Date) {
  const [opened, delivered] = await Promise.all([
    t.repairOrder.count({
      where: {
        ...siteWhere(scope),
        createdAt: { gte: from, lt: to },
        status: { not: "CANCELLED" },
        deletedAt: null,
        origin: { not: "IMPORTED" },
      },
    }),
    t.repairOrder.count({
      where: { ...siteWhere(scope), deliveredAt: { gte: from, lt: to }, deletedAt: null },
    }),
  ]);
  return { opened, delivered };
}

/**
 * RG-M12-13 — dernière version de chaque devis (`supersededAt` nul), décidée dans la période
 * (`decidedAt`), ou expirée avec `validUntil` dans la période (dates locales).
 */
export async function quoteDecisions(
  t: TenantDb,
  scope: SiteScope,
  period: { from: Date; to: Date; fromDate: string; toDate: string },
): Promise<QuoteDecisionAggregate[]> {
  const rows = await t.quote.groupBy({
    by: ["status"],
    where: {
      ...siteWhere(scope),
      supersededAt: null,
      deletedAt: null,
      status: { in: [...QUOTE_DECIDED_STATUSES] },
      OR: [
        { status: { not: "EXPIRED" }, decidedAt: { gte: period.from, lt: period.to } },
        {
          status: "EXPIRED",
          validUntil: {
            gte: new Date(`${period.fromDate}T00:00:00.000Z`),
            lt: new Date(`${period.toDate}T00:00:00.000Z`),
          },
        },
      ],
    },
    _count: { _all: true },
    _sum: { total: true, acceptedTotal: true },
  });
  return rows.map((r) => ({
    status: r.status,
    count: r._count._all,
    total: r._sum.total ?? 0,
    acceptedTotal: r._sum.acceptedTotal ?? 0,
  }));
}

export interface SiteWorkload {
  workedMinutes: number;
  plannedMinutes: number;
}

/** RG-M12-14 : heures pointées (site de l'OR) et heures planifiées (RDV avec pont) par site. */
export async function workloadBySite(
  t: TenantDb,
  organizationId: string,
  scope: SiteScope,
  from: Date,
  to: Date,
): Promise<Map<string, SiteWorkload>> {
  const [worked, planned] = await Promise.all([
    t.queryRaw<{ siteId: string; minutes: number }>(Prisma.sql`
      SELECT ro."siteId" AS "siteId",
             SUM(GREATEST(0, EXTRACT(EPOCH FROM (te."endedAt" - te."startedAt")) / 60
                 - te."pauseMinutes"))::float8 AS minutes
      FROM "TimeEntry" te JOIN "RepairOrder" ro ON ro.id = te."repairOrderId"
      WHERE te."organizationId" = ${organizationId} AND te."endedAt" IS NOT NULL
        AND te."startedAt" >= ${from} AND te."startedAt" < ${to}
        ${siteSql(scope, 'ro."siteId"')}
      GROUP BY 1`),
    t.queryRaw<{ siteId: string; minutes: number }>(Prisma.sql`
      SELECT a."siteId" AS "siteId",
             SUM(EXTRACT(EPOCH FROM (a."endsAt" - a."startsAt")) / 60)::float8 AS minutes
      FROM "Appointment" a
      WHERE a."organizationId" = ${organizationId} AND a."bayId" IS NOT NULL
        AND a.status::text NOT IN ('CANCELLED', 'NO_SHOW')
        AND a."startsAt" >= ${from} AND a."startsAt" < ${to}
        ${siteSql(scope, 'a."siteId"')}
      GROUP BY 1`),
  ]);
  const map = new Map<string, SiteWorkload>();
  const entry = (siteId: string) => {
    const e = map.get(siteId) ?? { workedMinutes: 0, plannedMinutes: 0 };
    map.set(siteId, e);
    return e;
  };
  for (const w of worked) entry(w.siteId).workedMinutes += Math.round(num(w.minutes));
  for (const p of planned) entry(p.siteId).plannedMinutes += Math.round(num(p.minutes));
  return map;
}

export interface SiteInfo {
  id: string;
  name: string;
  code: string;
  /** Capacité en minutes sur la période ; null si le site n'a pas d'horaires. */
  capacity: number | null;
}

/** RG-M12-14 : capacité = ponts actifs (hors lavage) × heures d'ouverture, fériés exclus. */
export async function sitesWithCapacity(
  t: TenantDb,
  scope: SiteScope,
  period: { fromDate: string; toDate: string },
  timeZone: string,
): Promise<SiteInfo[]> {
  const [sites, bays, holidays] = await Promise.all([
    t.site.findMany({
      where: { isActive: true, ...(scope.siteIds ? { id: { in: scope.siteIds } } : {}) },
      select: { id: true, name: true, code: true, openingHours: true },
      orderBy: { name: "asc" },
    }),
    t.bay.groupBy({
      by: ["siteId"],
      where: { isActive: true, type: { not: "WASH" }, ...siteWhere(scope) },
      _count: { _all: true },
    }),
    t.holiday.findMany({ select: { date: true, siteId: true } }),
  ]);
  const bayCount = new Map(bays.map((b) => [b.siteId, b._count._all]));
  const days = daysOf(period.fromDate, period.toDate);
  return sites.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    capacity: capacityMinutes({
      days,
      timeZone,
      openingHours: s.openingHours as OpeningHours,
      holidays,
      siteId: s.id,
      activeBays: bayCount.get(s.id) ?? 0,
    }),
  }));
}

/**
 * RG-M12-15 : heures vendues (lignes LABOR `DONE` des OR facturés dans la période) et heures
 * pointées sur ces mêmes lignes, par site et par mécanicien (`assignedToId`).
 */
export async function soldAndWorkedHours(
  t: TenantDb,
  organizationId: string,
  scope: SiteScope,
  from: Date,
  to: Date,
): Promise<{ siteId: string; mechanicId: string | null; sold: number; worked: number }[]> {
  const rows = await t.queryRaw<{
    siteId: string;
    mechanicId: string | null;
    sold: number;
    worked: number;
  }>(Prisma.sql`
    SELECT ro."siteId" AS "siteId", l."assignedToId" AS "mechanicId",
           SUM(l.quantity)::float8 AS sold,
           COALESCE(SUM(w.minutes), 0)::float8 / 60 AS worked
    FROM "RepairOrderLine" l
    JOIN "RepairOrder" ro ON ro.id = l."repairOrderId"
    LEFT JOIN (
      SELECT te."repairOrderLineId" AS id,
             SUM(GREATEST(0, EXTRACT(EPOCH FROM (te."endedAt" - te."startedAt")) / 60
                 - te."pauseMinutes")) AS minutes
      FROM "TimeEntry" te
      WHERE te."organizationId" = ${organizationId} AND te."endedAt" IS NOT NULL
        AND te."repairOrderLineId" IS NOT NULL
      GROUP BY 1) w ON w.id = l.id
    WHERE l."organizationId" = ${organizationId} AND l.type::text = 'LABOR'
      AND l.status::text = 'DONE'
      AND ro."invoicedAt" >= ${from} AND ro."invoicedAt" < ${to}
      ${siteSql(scope, 'ro."siteId"')}
    GROUP BY 1, 2`);
  return rows.map((r) => ({
    siteId: r.siteId,
    mechanicId: r.mechanicId,
    sold: num(r.sold),
    worked: num(r.worked),
  }));
}

/**
 * RG-M12-25 — première et dernière activité (facture valide `issuedAt`, OR non annulé
 * `createdAt`) de chaque client, avant la fin de période.
 */
export async function customerActivities(
  t: TenantDb,
  organizationId: string,
  scope: SiteScope,
  to: Date,
): Promise<CustomerActivity[]> {
  const rows = await t.queryRaw<{ customerId: string; firstAt: Date; lastAt: Date }>(Prisma.sql`
    SELECT a."customerId" AS "customerId", MIN(a.at) AS "firstAt", MAX(a.at) AS "lastAt"
    FROM (
      SELECT i."customerId", i."issuedAt" AS at FROM "Invoice" i
      WHERE i."organizationId" = ${organizationId} AND i.type::text = 'INVOICE'
        AND i.status::text IN (${VALID}) AND i."issuedAt" < ${to}
        ${siteSql(scope, 'i."siteId"')}
      UNION ALL
      SELECT ro."customerId", ro."createdAt" FROM "RepairOrder" ro
      WHERE ro."organizationId" = ${organizationId} AND ro.status::text <> 'CANCELLED'
        AND ro."deletedAt" IS NULL AND ro."createdAt" < ${to}
        ${siteSql(scope, 'ro."siteId"')}
    ) a
    GROUP BY 1`);
  return rows;
}

/** RG-M12-26 — lignes PART des factures valides, par produit (sinon désignation normalisée). */
export async function partAggregates(
  t: TenantDb,
  organizationId: string,
  scope: SiteScope,
  from: Date,
  to: Date,
  limit?: number,
): Promise<PartAggregate[]> {
  const sign = Prisma.sql`CASE WHEN i.type::text = 'CREDIT_NOTE' THEN -1 ELSE 1 END`;
  const rows = await t.queryRaw<{
    productId: string | null;
    description: string;
    label: string;
    quantity: number;
    ht: bigint;
    cost: bigint;
    repairOrders: bigint;
  }>(Prisma.sql`
    SELECT l."productId" AS "productId",
           CASE WHEN l."productId" IS NULL THEN lower(btrim(l.description)) END AS description,
           COALESCE(MAX(p.name), MIN(l.description)) AS label,
           SUM(${sign} * ABS(l.quantity))::float8 AS quantity,
           SUM(${sign} * ABS(l."lineSubtotal")) AS ht,
           SUM(${sign} * ABS(l."costAmount")) AS cost,
           COUNT(DISTINCT i."repairOrderId") AS "repairOrders"
    FROM "Invoice" i JOIN "InvoiceLine" l ON l."invoiceId" = i.id
    LEFT JOIN "Product" p ON p.id = l."productId"
    WHERE ${validInvoiceSql(organizationId, scope, from, to)}
      AND l.type::text = 'PART' AND l."depositInvoiceId" IS NULL
    GROUP BY 1, 2
    ORDER BY ht DESC, quantity DESC
    ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}`);
  return rows.map((r) => ({
    key: r.productId ?? `desc:${r.description ?? normalizeDescription(r.label)}`,
    productId: r.productId,
    label: r.label,
    quantity: num(r.quantity),
    ht: num(r.ht),
    cost: num(r.cost),
    repairOrders: num(r.repairOrders),
  }));
}

/** RG-M12-17 : factures clients ouvertes (créances) du périmètre, nom du client inclus. */
export async function loadReceivableInvoices(
  t: TenantDb,
  scope: SiteScope,
): Promise<ReceivableInvoiceLike[]> {
  const rows = await t.invoice.findMany({
    where: {
      ...siteWhere(scope),
      type: "INVOICE",
      billTo: "CUSTOMER",
      status: { in: [...OPEN_INVOICE_STATUSES] },
      balance: { gt: 0 },
    },
    select: {
      id: true,
      type: true,
      status: true,
      billTo: true,
      balance: true,
      dueDate: true,
      number: true,
      customerId: true,
      customer: { select: { displayName: true } },
    },
  });
  return rows.map((r) => ({ ...r, customerName: r.customer.displayName }));
}

/**
 * RG-M12-22 (A10) : attributions M09 (`PaymentAttribution`) des paiements confirmés reçus dans
 * `[from, to)`. Chaque allocation compte sur le site de sa facture (M12 §11).
 */
export async function loadAttributions(t: TenantDb, scope: SiteScope, from: Date, to: Date) {
  const rows = await t.paymentAttribution.findMany({
    where: {
      source: "reminder",
      paymentAllocation: {
        payment: { status: "CONFIRMED", receivedAt: { gte: from, lt: to } },
        ...(scope.siteIds ? { invoice: { siteId: { in: scope.siteIds } } } : {}),
      },
    },
    select: {
      source: true,
      amount: true,
      paymentAllocation: { select: { payment: { select: { receivedAt: true } } } },
    },
  });
  return rows.map((r) => ({
    source: r.source,
    amount: r.amount,
    // Filtré sur `payment` ci-dessus : une attribution vient toujours d'un paiement (jamais d'un crédit).
    receivedAt: r.paymentAllocation.payment!.receivedAt,
  }));
}
