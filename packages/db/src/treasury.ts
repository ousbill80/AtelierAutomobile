// M18 — services de trésorerie partagés (web et worker) : comptes par défaut (caisse de
// chaque site, coffre), projection idempotente du grand livre depuis M08 (RG-M18-03), soldes.
import {
  planProjection,
  type AccountLike,
  type MovementKindLike,
  type TreasuryAccountTypeLike,
  type Unassigned,
} from "@atelieros/core";
import type { Prisma } from "@prisma/client";
import type { ScopedTenantClient } from "./tenant";

type Tx = ScopedTenantClient;

const businessDay = (date: Date, timeZone: string) =>
  new Date(
    `${new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)}T00:00:00.000Z`,
  );

/**
 * RG-M18-01 — crée ce qui manque : une caisse par site et un coffre. Ouverture à la date de
 * création de l'organisation, solde 0 : l'historique de caisse est repris tel quel.
 */
export async function ensureTreasuryDefaults(
  tx: Tx,
  input: { organizationId: string; timeZone: string; since: Date },
): Promise<void> {
  const [sites, accounts] = await Promise.all([
    tx.site.findMany({ select: { id: true, name: true } }),
    tx.treasuryAccount.findMany({ select: { type: true, siteId: true, name: true } }),
  ]);
  const openingDate = businessDay(input.since, input.timeZone);
  const names = new Set(accounts.map((a) => a.name.toLowerCase()));
  const uniqueName = (base: string) => {
    let name = base;
    for (let i = 2; names.has(name.toLowerCase()); i += 1) name = `${base} ${i}`;
    names.add(name.toLowerCase());
    return name;
  };
  const data: Prisma.TreasuryAccountCreateManyInput[] = sites
    .filter((s) => !accounts.some((a) => a.type === "CASH_REGISTER" && a.siteId === s.id))
    .map((s) => ({
      organizationId: input.organizationId,
      siteId: s.id,
      type: "CASH_REGISTER",
      name: uniqueName(`Caisse ${s.name}`),
      ledgerAccount: "571",
      openingDate,
    }));
  if (!accounts.some((a) => a.type === "SAFE")) {
    data.push({
      organizationId: input.organizationId,
      siteId: null,
      type: "SAFE",
      name: uniqueName("Coffre"),
      ledgerAccount: "571",
      openingDate,
    });
  }
  if (data.length > 0) await tx.treasuryAccount.createMany({ data, skipDuplicates: true });
}

export interface TreasurySyncResult {
  created: number;
  unassigned: Unassigned[];
}

/** RG-M18-03 — projette dans le grand livre ce qui n'y est pas encore (idempotent). */
export async function syncTreasuryLedger(
  tx: Tx,
  input: { organizationId: string; timeZone: string; now: Date },
): Promise<TreasurySyncResult> {
  const accounts = await tx.treasuryAccount.findMany();
  if (accounts.length === 0) return { created: 0, unassigned: [] };
  const since = new Date(
    Math.min(...accounts.map((a) => a.openingDate.getTime())) - 24 * 3600 * 1000,
  );
  const [posted, payments, refunds, expenses, drops, sessions] = await Promise.all([
    tx.treasuryMovement.findMany({
      where: {
        sourceType: { not: null },
        NOT: { sourceType: { in: ["manual", "transfer", "reconciliation"] } },
      },
      select: { accountId: true, sourceType: true, sourceId: true, kind: true },
    }),
    tx.payment.findMany({
      where: { receivedAt: { gte: since } },
      select: {
        id: true,
        number: true,
        method: true,
        amount: true,
        status: true,
        voidedAt: true,
        receivedAt: true,
        siteId: true,
        reference: true,
        customer: { select: { displayName: true } },
      },
    }),
    tx.refund.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        method: true,
        amount: true,
        createdAt: true,
        siteId: true,
        reason: true,
        reference: true,
      },
    }),
    tx.expense.findMany({
      where: { status: "APPROVED", paidAt: { gte: since } },
      select: {
        id: true,
        amount: true,
        category: true,
        description: true,
        paidAt: true,
        siteId: true,
        cashSessionId: true,
        treasuryAccountId: true,
        status: true,
      },
    }),
    tx.cashDrop.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        amount: true,
        createdAt: true,
        siteId: true,
        destination: true,
        toAccountId: true,
        reference: true,
      },
    }),
    tx.cashSession.findMany({
      where: { closedAt: { gte: since }, difference: { not: 0 } },
      select: { id: true, siteId: true, closedAt: true, difference: true },
    }),
  ]);
  const plan = planProjection({
    timeZone: input.timeZone,
    now: input.now,
    accounts: accounts.map(toAccountLike),
    payments: payments.map(({ customer, ...p }) => ({
      ...p,
      customerName: customer?.displayName ?? null,
    })),
    refunds,
    expenses,
    drops,
    sessions,
    posted: posted.map((p) => ({ ...p, kind: p.kind as MovementKindLike })),
  });
  if (plan.movements.length > 0) {
    await tx.treasuryMovement.createMany({
      data: plan.movements.map((m) => ({ ...m, organizationId: input.organizationId })),
      skipDuplicates: true,
    });
  }
  return { created: plan.movements.length, unassigned: plan.unassigned };
}

export function toAccountLike(a: {
  id: string;
  name: string;
  type: string;
  siteId: string | null;
  paymentMethods: string[];
  openingDate: Date;
  archivedAt: Date | null;
}): AccountLike {
  return {
    id: a.id,
    name: a.name,
    type: a.type as TreasuryAccountTypeLike,
    siteId: a.siteId,
    paymentMethods: a.paymentMethods,
    openingDate: a.openingDate,
    archivedAt: a.archivedAt,
  };
}

/** RG-M18-04 — Σ entrées / sorties par compte, sur une fenêtre de dates éventuelle. */
export async function treasuryTotals(
  tx: Tx,
  input: { before?: Date; from?: Date; to?: Date; accountIds?: string[] } = {},
): Promise<Map<string, { in: number; out: number }>> {
  const occurredAt =
    input.before || input.from || input.to
      ? {
          ...(input.before ? { lt: input.before } : {}),
          ...(input.from ? { gte: input.from } : {}),
          ...(input.to ? { lt: input.to } : {}),
        }
      : undefined;
  const rows = await tx.treasuryMovement.groupBy({
    by: ["accountId", "direction"],
    where: {
      ...(occurredAt ? { occurredAt } : {}),
      ...(input.accountIds ? { accountId: { in: input.accountIds } } : {}),
    },
    _sum: { amount: true },
  });
  const map = new Map<string, { in: number; out: number }>();
  for (const r of rows) {
    const t = map.get(r.accountId) ?? { in: 0, out: 0 };
    if (r.direction === "IN") t.in += r._sum.amount ?? 0;
    else t.out += r._sum.amount ?? 0;
    map.set(r.accountId, t);
  }
  return map;
}
