// M17 RG-M17-20 — outils de l'assistant, tous en LECTURE SEULE. Chaque outil vérifie sa
// permission et le filtre de sites de l'utilisateur, lit via `db.forTenant` (organisation
// active uniquement, RG-M17-03) et renvoie un résultat compact (≤ 10 lignes + total) dont les
// montants sont déjà formatés par le code (`…Label`, jamais par le modèle) avec des liens
// profonds. Un refus de permission est un résultat `{ denied: true }`, jamais une exception.
import {
  canReadKpi,
  daysOverdue,
  formatDate,
  formatFCFA,
  localDay,
  OPEN_INVOICE_STATUSES,
  KPI_UNIT,
  resolveCustomPeriod,
  resolvePeriod,
  shiftDay,
  startOfLocalDay,
  type KpiCode,
  type Permission,
} from "@atelieros/core";
import { db, reportFacts, type Prisma } from "@atelieros/db";
import { kpiCodeSchema } from "@atelieros/validators";
import type { AiToolCall } from "@atelieros/integrations";
import { z } from "zod";
import { loadOrgReportContext } from "../reports/context";

type TenantDb = ReturnType<typeof db.forTenant>;

export interface AssistantToolContext {
  organizationId: string;
  permissions: Set<Permission>;
  allowedSiteIds: string[] | "ALL";
  timezone: string;
  now: Date;
}

export interface ToolLink {
  label: string;
  href: string;
}

export const DENIED = { denied: true } as const;

const LIMIT = 10;

const amount = (value: number) => ({ amount: value, amountLabel: formatFCFA(value) });

/** Sites visibles : `null` = tous ; un `siteId` demandé hors du périmètre → refus. */
function siteScope(ctx: AssistantToolContext, siteId?: string): string[] | null | "DENIED" {
  if (siteId) {
    if (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(siteId)) return "DENIED";
    return [siteId];
  }
  return ctx.allowedSiteIds === "ALL" ? null : ctx.allowedSiteIds;
}

const siteWhere = (sites: string[] | null) => (sites ? { siteId: { in: sites } } : {});

function openInvoiceWhere(sites: string[] | null): Prisma.InvoiceWhereInput {
  return {
    ...siteWhere(sites),
    type: "INVOICE",
    billTo: "CUSTOMER",
    status: { in: [...OPEN_INVOICE_STATUSES] },
    balance: { gt: 0 },
  };
}

function asOf(ctx: AssistantToolContext): Date {
  return new Date(`${localDay(ctx.now, ctx.timezone)}T00:00:00.000Z`);
}

// ── Schémas d'entrée (le modèle peut se tromper : tout est revalidé) ──

const periodSchema = z.enum(["today", "yesterday", "7d", "month", "prev_month", "30d"]);

const inputs = {
  search_customers: z.object({ query: z.string().min(1).max(100) }),
  get_customer_balance: z.object({ customerId: z.string().min(1) }),
  list_receivables: z.object({
    minDaysOverdue: z.number().int().min(0).optional(),
    minAmount: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(LIMIT).optional(),
  }),
  list_vehicle_due_dates: z.object({
    kind: z.enum(["VT", "SERVICE"]),
    period: z.enum(["week", "month", "next_month"]).optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  get_kpi: z.object({
    // Codes M12 (`dashboard.kpi`) ; anciens noms du prompt v1 acceptés (fils existants).
    metric: z.union([kpiCodeSchema, z.enum(["revenue", "recovered"])]),
    period: periodSchema.optional(),
    siteId: z.string().optional(),
    compare: z.boolean().optional(),
  }),
  list_repair_orders: z.object({ status: z.string().optional(), siteId: z.string().optional() }),
  list_appointments: z.object({ date: z.string().optional() }),
  get_stock: z.object({ query: z.string().min(1).max(100) }),
  list_reminders: z.object({ status: z.string().optional(), type: z.string().optional() }),
  propose_action: z.object({
    kind: z.enum(["remind_customer", "create_appointment", "create_quote", "open_customer"]),
    customerId: z.string().optional(),
  }),
} as const;

export type AssistantToolName = keyof typeof inputs;

type Handler<K extends AssistantToolName> = (
  tx: TenantDb,
  ctx: AssistantToolContext,
  input: z.infer<(typeof inputs)[K]>,
) => Promise<unknown>;

const PERMISSIONS: Record<AssistantToolName, Permission | null> = {
  search_customers: "customer:read",
  get_customer_balance: "receivable:read",
  list_receivables: "receivable:read",
  list_vehicle_due_dates: "vehicle:read",
  get_kpi: null, // selon l'indicateur (`core/reports/kpi`, M12 §10)
  list_repair_orders: "repair_order:read",
  list_appointments: "appointment:read",
  get_stock: "stock:read",
  list_reminders: "reminder:read",
  propose_action: null, // ne fait que construire un lien ; l'écran cible vérifie ses droits
};

/** Anciens noms d'indicateurs (prompt v1) → codes M12. */
const KPI_ALIASES: Record<string, KpiCode> = {
  revenue: "revenue_ttc",
  recovered: "recovered_by_reminders",
};

const KPI_LABELS: Record<KpiCode, string> = {
  revenue_ht: "Chiffre d'affaires HT facturé",
  revenue_ttc: "Chiffre d'affaires TTC facturé",
  parts_margin: "Marge pièces",
  labor_margin: "Marge main-d'œuvre",
  gross_margin: "Marge globale",
  avg_ticket: "Panier moyen",
  collected: "Encaissements",
  receivables: "Créances clients (à ce jour)",
  recovered_by_reminders: "Encaissé grâce aux relances",
  quote_acceptance: "Taux d'acceptation des devis",
};

const KPI_LINKS: Partial<Record<KpiCode, ToolLink>> = {
  receivables: { label: "Créances", href: "/tableau-de-bord?onglet=finances" },
  recovered_by_reminders: { label: "Résultats des relances", href: "/relances/resultats" },
};

function kpiValueLabel(metric: KpiCode, value: number | null): string {
  if (value === null) return "—";
  if (KPI_UNIT[metric] === "rate") return `${(value * 100).toFixed(1).replace(".", ",")} %`;
  return formatFCFA(value);
}

const PERIOD_LABELS: Record<z.infer<typeof periodSchema>, string> = {
  today: "aujourd'hui",
  yesterday: "hier",
  "7d": "7 derniers jours",
  month: "mois en cours",
  prev_month: "mois précédent",
  "30d": "30 derniers jours",
};

/** Période M12 (avec la période précédente, pour la comparaison). « Hier » = jour local précédent. */
function resolvedPeriodOf(period: z.infer<typeof periodSchema>, ctx: AssistantToolContext) {
  if (period === "yesterday") {
    const yesterday = shiftDay(localDay(ctx.now, ctx.timezone), -1);
    return resolveCustomPeriod(yesterday, yesterday, ctx.timezone);
  }
  return resolvePeriod(period, ctx.now, ctx.timezone);
}

const handlers: { [K in AssistantToolName]: Handler<K> } = {
  async search_customers(tx, ctx, input) {
    const query = input.query.trim();
    const compact = query.replace(/[\s-]/g, "").toUpperCase();
    const customers = await tx.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { displayName: { contains: query, mode: "insensitive" } },
          { phone: { contains: query.replace(/\s/g, "") } },
          { vehicles: { some: { plateCompact: { contains: compact } } } },
        ],
      },
      take: LIMIT,
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, type: true },
    });
    const canSeeBalance = ctx.permissions.has("receivable:read");
    const balances = canSeeBalance
      ? await tx.invoice.groupBy({
          by: ["customerId"],
          where: {
            ...openInvoiceWhere(siteScope(ctx) as string[] | null),
            customerId: { in: customers.map((c) => c.id) },
          },
          _sum: { balance: true },
        })
      : [];
    return {
      count: customers.length,
      customers: customers.map((c) => {
        const balance = balances.find((b) => b.customerId === c.id)?._sum.balance ?? 0;
        return {
          id: c.id,
          name: c.displayName,
          type: c.type === "COMPANY" ? "entreprise" : "particulier",
          ...(canSeeBalance ? { balance, balanceLabel: formatFCFA(balance) } : {}),
          link: { label: c.displayName, href: `/clients/${c.id}` },
        };
      }),
    };
  },

  async get_customer_balance(tx, ctx, input) {
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (!customer) return { notFound: true };
    const sites = siteScope(ctx) as string[] | null;
    const invoices = await tx.invoice.findMany({
      where: { ...openInvoiceWhere(sites), customerId: customer.id },
      orderBy: [{ dueDate: "asc" }, { issuedAt: "asc" }],
      select: { id: true, number: true, total: true, balance: true, dueDate: true },
    });
    const today = asOf(ctx);
    const balance = invoices.reduce((s, i) => s + i.balance, 0);
    const [lastReminder, promises] = await Promise.all([
      tx.reminder.findFirst({
        where: { customerId: customer.id, status: "SENT", sentAt: { not: null } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      }),
      tx.paymentPromise.findMany({
        where: { collectionCase: { customerId: customer.id }, status: "PENDING" },
        orderBy: { promisedDate: "asc" },
        take: 3,
        select: { amount: true, promisedDate: true },
      }),
    ]);
    const rows = invoices.map((i) => ({
      number: i.number,
      ...amount(i.balance),
      daysOverdue: daysOverdue(i.dueDate, today),
      dueDate: i.dueDate ? formatDate(i.dueDate, ctx.timezone) : null,
      link: { label: i.number ?? "Facture", href: `/factures/${i.id}` },
    }));
    return {
      customer: { id: customer.id, name: customer.displayName },
      link: { label: customer.displayName, href: `/clients/${customer.id}` },
      balance,
      balanceLabel: formatFCFA(balance),
      openInvoicesCount: invoices.length,
      oldestInvoice: rows[0] ?? null,
      invoices: rows.slice(0, LIMIT),
      lastReminderDate: lastReminder?.sentAt ? formatDate(lastReminder.sentAt, ctx.timezone) : null,
      pendingPromises: promises.map((p) => ({
        ...amount(p.amount),
        promisedDate: formatDate(p.promisedDate, ctx.timezone),
      })),
    };
  },

  async list_receivables(tx, ctx, input) {
    const sites = siteScope(ctx) as string[] | null;
    const invoices = await tx.invoice.findMany({
      where: openInvoiceWhere(sites),
      select: {
        balance: true,
        dueDate: true,
        customerId: true,
        customer: { select: { displayName: true } },
      },
    });
    const today = asOf(ctx);
    const byCustomer = new Map<
      string,
      { name: string; balance: number; maxDays: number; count: number }
    >();
    for (const i of invoices) {
      const days = daysOverdue(i.dueDate, today);
      if (input.minDaysOverdue !== undefined && days < input.minDaysOverdue) continue;
      const row = byCustomer.get(i.customerId) ?? {
        name: i.customer.displayName,
        balance: 0,
        maxDays: 0,
        count: 0,
      };
      row.balance += i.balance;
      row.maxDays = Math.max(row.maxDays, days);
      row.count += 1;
      byCustomer.set(i.customerId, row);
    }
    const all = [...byCustomer.entries()]
      .filter(([, r]) => input.minAmount === undefined || r.balance >= input.minAmount)
      .sort((a, b) => b[1].balance - a[1].balance);
    const total = all.reduce((s, [, r]) => s + r.balance, 0);
    return {
      customersCount: all.length,
      total,
      totalLabel: formatFCFA(total),
      customers: all.slice(0, input.limit ?? LIMIT).map(([id, r]) => ({
        name: r.name,
        ...amount(r.balance),
        invoicesCount: r.count,
        maxDaysOverdue: r.maxDays,
        link: { label: r.name, href: `/clients/${id}` },
      })),
      seeAll: { label: "Voir les créances", href: "/creances" },
    };
  },

  async list_vehicle_due_dates(tx, ctx, input) {
    const today = localDay(ctx.now, ctx.timezone);
    let from = input.from;
    let to = input.to;
    if (!from || !to) {
      const [y, m] = today.split("-").map(Number) as [number, number];
      const month = (offset: number) => {
        const start = new Date(Date.UTC(y, m - 1 + offset, 1));
        const end = new Date(Date.UTC(y, m + offset, 0));
        return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)] as const;
      };
      if (input.period === "week") [from, to] = [today, shiftDay(today, 6)];
      else if (input.period === "next_month") [from, to] = month(1);
      else [from, to] = month(0);
    }
    const field = input.kind === "VT" ? "inspectionExpiryDate" : "nextServiceDueDate";
    const where: Prisma.VehicleWhereInput = {
      [field]: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
      customer: { deletedAt: null },
    };
    const [count, vehicles] = await Promise.all([
      tx.vehicle.count({ where }),
      tx.vehicle.findMany({
        where,
        orderBy: { [field]: "asc" },
        take: LIMIT,
        select: {
          id: true,
          plate: true,
          make: true,
          model: true,
          inspectionExpiryDate: true,
          nextServiceDueDate: true,
          customer: { select: { displayName: true } },
        },
      }),
    ]);
    return {
      kind: input.kind,
      from: formatDate(new Date(`${from}T12:00:00.000Z`), ctx.timezone),
      to: formatDate(new Date(`${to}T12:00:00.000Z`), ctx.timezone),
      count,
      vehicles: vehicles.map((v) => {
        const due = input.kind === "VT" ? v.inspectionExpiryDate : v.nextServiceDueDate;
        return {
          plate: v.plate,
          vehicle: `${v.make} ${v.model}`.trim(),
          customer: v.customer.displayName,
          dueDate: due ? formatDate(due, ctx.timezone) : null,
          link: { label: v.plate, href: `/vehicules/${v.id}` },
        };
      }),
      seeAll: { label: `Voir les ${count} échéances`, href: "/relances/echeances" },
    };
  },

  async get_kpi(tx, ctx, input) {
    // M12 §8 `dashboard.kpi` : mêmes faits et mêmes formules que le tableau de bord.
    const metric: KpiCode = KPI_ALIASES[input.metric] ?? (input.metric as KpiCode);
    if (!canReadKpi(metric, ctx.permissions)) return DENIED;
    const sites = siteScope(ctx, input.siteId);
    if (sites === "DENIED") return DENIED;
    const period = input.period ?? "month";
    const org = await loadOrgReportContext(ctx.organizationId);
    const result = await reportFacts.computeKpi(tx, {
      organizationId: ctx.organizationId,
      org,
      metric,
      scope: { siteIds: sites },
      period: resolvedPeriodOf(period, ctx),
      now: ctx.now,
      compare: input.compare ?? false,
    });
    const snapshot = metric === "receivables";
    return {
      metric,
      label: snapshot ? KPI_LABELS[metric] : `${KPI_LABELS[metric]} (${PERIOD_LABELS[period]})`,
      value: result.value,
      valueLabel: kpiValueLabel(metric, result.value),
      ...(result.estimated ? { estimated: true, note: "coût estimé" } : {}),
      ...(result.previous !== undefined
        ? {
            previous: result.previous,
            previousLabel: kpiValueLabel(metric, result.previous),
            ...(result.delta?.kind === "pct" ? { deltaPct: result.delta.pct } : {}),
          }
        : {}),
      link: KPI_LINKS[metric] ?? { label: "Tableau de bord", href: "/tableau-de-bord" },
    };
  },

  async list_repair_orders(tx, ctx, input) {
    const sites = siteScope(ctx, input.siteId);
    if (sites === "DENIED") return DENIED;
    const open = [
      "CHECKED_IN",
      "DIAGNOSING",
      "AWAITING_APPROVAL",
      "APPROVED",
      "IN_PROGRESS",
      "WAITING_PARTS",
      "QUALITY_CHECK",
      "READY",
    ] as const;
    const status = input.status?.toUpperCase();
    const where: Prisma.RepairOrderWhereInput = {
      ...siteWhere(sites),
      deletedAt: null,
      status:
        status &&
        (open as readonly string[])
          .concat(["DELIVERED", "INVOICED", "CANCELLED", "DRAFT"])
          .includes(status)
          ? (status as never)
          : { in: [...open] },
    };
    const [count, orders] = await Promise.all([
      tx.repairOrder.count({ where }),
      tx.repairOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          number: true,
          status: true,
          customer: { select: { displayName: true } },
          vehicle: { select: { plate: true } },
        },
      }),
    ]);
    return {
      count,
      repairOrders: orders.map((o) => ({
        number: o.number,
        status: o.status,
        customer: o.customer.displayName,
        plate: o.vehicle.plate,
        link: { label: o.number, href: `/ordres/${o.id}` },
      })),
      seeAll: { label: "Voir les ordres", href: "/ordres" },
    };
  },

  async list_appointments(tx, ctx, input) {
    const today = localDay(ctx.now, ctx.timezone);
    const day =
      !input.date || input.date === "today"
        ? today
        : input.date === "tomorrow"
          ? shiftDay(today, 1)
          : /^\d{4}-\d{2}-\d{2}$/.test(input.date)
            ? input.date
            : today;
    const sites = siteScope(ctx) as string[] | null;
    const where: Prisma.AppointmentWhereInput = {
      ...siteWhere(sites),
      startsAt: {
        gte: startOfLocalDay(day, ctx.timezone),
        lt: startOfLocalDay(shiftDay(day, 1), ctx.timezone),
      },
      status: { notIn: ["CANCELLED"] },
    };
    const [count, rows] = await Promise.all([
      tx.appointment.count({ where }),
      tx.appointment.findMany({
        where,
        orderBy: { startsAt: "asc" },
        take: LIMIT,
        select: {
          startsAt: true,
          status: true,
          type: true,
          customer: { select: { displayName: true } },
          vehicle: { select: { plate: true } },
        },
      }),
    ]);
    const hour = new Intl.DateTimeFormat("fr-FR", {
      timeZone: ctx.timezone,
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      date: formatDate(startOfLocalDay(day, ctx.timezone), ctx.timezone),
      count,
      appointments: rows.map((a) => ({
        time: hour.format(a.startsAt),
        customer: a.customer.displayName,
        plate: a.vehicle?.plate ?? null,
        type: a.type,
        status: a.status,
      })),
      seeAll: { label: "Voir le planning", href: "/rendez-vous" },
    };
  },

  async get_stock(tx, ctx, input) {
    const query = input.query.trim();
    const sites = siteScope(ctx) as string[] | null;
    const products = await tx.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { sku: { contains: query, mode: "insensitive" } },
          { oemReference: { contains: query, mode: "insensitive" } },
        ],
      },
      take: LIMIT,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        averageCost: true,
        stockLevels: {
          where: siteWhere(sites),
          select: { onHand: true, reserved: true, site: { select: { name: true } } },
        },
      },
    });
    const withCost = ctx.permissions.has("product:view_cost");
    return {
      count: products.length,
      products: products.map((p) => ({
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        levels: p.stockLevels.map((l) => ({
          site: l.site.name,
          onHand: l.onHand,
          available: l.onHand - l.reserved,
        })),
        ...(withCost ? { averageCostLabel: formatFCFA(p.averageCost) } : {}),
        link: { label: p.name, href: `/stock/${p.id}` },
      })),
    };
  },

  async list_reminders(tx, ctx, input) {
    const sites = siteScope(ctx) as string[] | null;
    const statuses = [
      "PLANNED",
      "NEEDS_APPROVAL",
      "QUEUED",
      "SENT",
      "FAILED",
      "SKIPPED",
      "SNOOZED",
      "CANCELLED",
    ];
    const status = input.status?.toUpperCase();
    const where: Prisma.ReminderWhereInput = {
      status: (status && statuses.includes(status) ? status : "NEEDS_APPROVAL") as never,
      ...(input.type ? { type: input.type.toUpperCase() as never } : {}),
      // Comme M12 : relance rattachée au site de sa facture ; sinon visible avec « tous les sites ».
      ...(sites ? { invoice: { siteId: { in: sites } } } : {}),
    };
    const [count, rows] = await Promise.all([
      tx.reminder.count({ where }),
      tx.reminder.findMany({
        where,
        orderBy: { scheduledFor: "asc" },
        take: LIMIT,
        select: {
          type: true,
          stepKey: true,
          status: true,
          scheduledFor: true,
          customer: { select: { displayName: true } },
        },
      }),
    ]);
    return {
      count,
      reminders: rows.map((r) => ({
        type: r.type,
        step: r.stepKey,
        status: r.status,
        customer: r.customer.displayName,
        scheduledFor: formatDate(r.scheduledFor, ctx.timezone),
      })),
      seeAll: { label: "Voir les relances du jour", href: "/relances" },
    };
  },

  async propose_action(tx, _ctx, input) {
    let customerName: string | null = null;
    if (input.customerId) {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, deletedAt: null },
        select: { displayName: true },
      });
      if (!customer) return { notFound: true };
      customerName = customer.displayName;
    }
    const q = input.customerId ? `?client=${encodeURIComponent(input.customerId)}` : "";
    const action: ToolLink =
      input.kind === "create_appointment"
        ? { label: "Créer un rendez-vous", href: `/rendez-vous/nouveau${q}` }
        : input.kind === "create_quote"
          ? { label: "Créer un devis", href: `/devis/nouveau${q}` }
          : input.kind === "remind_customer" && input.customerId
            ? { label: `Relancer ${customerName}`, href: `/clients/${input.customerId}` }
            : input.customerId
              ? { label: `Ouvrir la fiche ${customerName}`, href: `/clients/${input.customerId}` }
              : { label: "Voir les créances", href: "/creances" };
    return { action, executed: false };
  },
};

/** Définition des outils (schémas dans le prompt versionné) et exécution permissionnée. */
export function createAssistantToolExecutor(ctx: AssistantToolContext) {
  const tx = db.forTenant({ organizationId: ctx.organizationId });
  return async function execute(call: AiToolCall): Promise<unknown> {
    if (!(call.name in inputs)) return { error: "Outil inconnu." };
    const name = call.name as AssistantToolName;
    const permission = PERMISSIONS[name];
    if (permission && !ctx.permissions.has(permission)) return DENIED;
    const parsed = inputs[name].safeParse(call.input ?? {});
    if (!parsed.success) return { error: "Paramètres invalides.", details: parsed.error.message };
    return (handlers[name] as Handler<typeof name>)(tx, ctx, parsed.data as never);
  };
}

/** Liens profonds et boutons d'action présents dans les résultats d'outils (dédoublonnés). */
export function collectLinks(results: readonly unknown[]): {
  links: ToolLink[];
  actions: ToolLink[];
} {
  const links: ToolLink[] = [];
  const actions: ToolLink[] = [];
  const seen = new Set<string>();
  const isLink = (v: unknown): v is ToolLink =>
    !!v &&
    typeof v === "object" &&
    typeof (v as ToolLink).href === "string" &&
    typeof (v as ToolLink).label === "string" &&
    Object.keys(v).length === 2;
  const visit = (value: unknown, key?: string) => {
    if (isLink(value)) {
      const isAction = key === "action";
      const dedupeKey = `${isAction ? "action" : "link"}:${value.href}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        (isAction ? actions : links).push(value);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((v) => visit(v));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  results.forEach((r) => visit(r));
  return { links: links.slice(0, LIMIT), actions };
}
