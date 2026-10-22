// M18 — trésorerie : vue d'ensemble (soldes, alertes), comptes, grand livre (projection
// idempotente depuis M08 à chaque lecture, RG-M18-03), virements, mouvements manuels et
// contre-passations, dépenses hors caisse, rapprochements, rapports par période.
import { TRPCError } from "@trpc/server";
import {
  DEFAULT_LEDGER_BY_TYPE,
  DEFAULT_TREASURY_CATEGORIES,
  accountBalance,
  addDaysToKey,
  checkAccount,
  checkArchive,
  checkExpense,
  checkManualMovement,
  checkReversal,
  checkTransfer,
  formatFCFA,
  localDateKey,
  maskAccountRef,
  methodName,
  periodReport,
  reconcile,
  zonedInstant,
  type MovementKindLike,
  type TreasuryAccountTypeLike,
} from "@atelieros/core";
import {
  adminDb,
  db,
  ensureTreasuryDefaults,
  syncTreasuryLedger,
  toAccountLike,
  treasuryTotals,
  type Prisma,
} from "@atelieros/db";
import {
  createTreasuryAccountInputSchema,
  treasuryAccountDetailInputSchema,
  treasuryExpenseInputSchema,
  treasuryIdInputSchema,
  treasuryJournalInputSchema,
  treasuryMovementInputSchema,
  treasuryReconcileInputSchema,
  treasuryReportInputSchema,
  treasuryReverseInputSchema,
  treasuryTransferInputSchema,
  updateTreasuryAccountInputSchema,
  uploadExpenseReceiptInputSchema,
  type TreasuryReportInput,
} from "@atelieros/validators";
import { actorOf, resolveSiteId, type OrgCtx } from "../billing/context";
import {
  audit,
  bad,
  guard,
  loadOrgBillingContext,
  type OrgBillingContext,
  type Tx,
} from "../billing/service";
import { emitDomainEvent } from "../events/emit";
import { membersWithRoles, notify } from "../repairOrders/helpers";
import { requirePermission, router } from "../trpc";
import { storeExpenseReceipt } from "./cash";

type Account = Prisma.TreasuryAccountGetPayload<object>;

/** Bornes UTC d'une période de dates métier (bornes incluses). */
function periodRange(from: string | undefined, to: string | undefined, timeZone: string) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: zonedInstant(from, 0, timeZone) } : {}),
    ...(to ? { lt: zonedInstant(addDaysToKey(to, 1), 0, timeZone) } : {}),
  };
}

/** Instant d'une écriture saisie à une date : maintenant si c'est aujourd'hui, sinon midi. */
function occurredAtFor(date: string | undefined, org: OrgBillingContext): Date {
  const today = localDateKey(org.now, org.timeZone);
  if (!date || date === today) return org.now;
  if (date > today) bad("La date ne peut pas être dans le futur.");
  return zonedInstant(date, 12 * 60, org.timeZone);
}

const businessDate = (key: string) => new Date(`${key}T00:00:00.000Z`);

/** Prépare la trésorerie d'une organisation : comptes par défaut + projection du grand livre. */
async function prepare(tx: Tx, ctx: OrgCtx, org: OrgBillingContext) {
  const { createdAt } = await adminDb.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { createdAt: true },
  });
  await ensureTreasuryDefaults(tx, {
    organizationId: ctx.organizationId,
    timeZone: org.timeZone,
    since: createdAt,
  });
  return syncTreasuryLedger(tx, {
    organizationId: ctx.organizationId,
    timeZone: org.timeZone,
    now: org.now,
  });
}

async function balancesOf(tx: Tx, accounts: Account[], before?: Date) {
  const totals = await treasuryTotals(tx, before ? { before } : {});
  return new Map(
    accounts.map((a) => {
      const t = totals.get(a.id) ?? { in: 0, out: 0 };
      return [a.id, accountBalance(a.openingBalance, t.in, t.out)];
    }),
  );
}

async function loadAccount(tx: Tx, id: string) {
  const account = await tx.treasuryAccount.findFirst({ where: { id } });
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Compte introuvable." });
  return account;
}

async function balanceOf(tx: Tx, account: Account) {
  return (await balancesOf(tx, [account])).get(account.id) ?? account.openingBalance;
}

function accountView<E extends object = object>(a: Account, balance: number, extra?: E) {
  return {
    id: a.id,
    name: a.name,
    type: a.type as TreasuryAccountTypeLike,
    siteId: a.siteId,
    paymentMethods: a.paymentMethods as string[],
    bankName: a.bankName,
    accountRef: maskAccountRef(a.accountRef),
    ledgerAccount: a.ledgerAccount,
    openingBalance: a.openingBalance,
    openingDate: a.openingDate.toISOString().slice(0, 10),
    archived: Boolean(a.archivedAt),
    balance,
    ...(extra ?? ({} as E)),
  };
}

/** Lien vers la source d'un mouvement projeté (reçu, session de caisse). */
function sourceHref(m: { sourceType: string | null; sourceId: string | null }) {
  if (!m.sourceId) return null;
  if (m.sourceType === "payment") return `/api/caisse/recus/${m.sourceId}/pdf`;
  if (m.sourceType === "cash_session") return `/caisse/sessions/${m.sourceId}`;
  return null;
}

const ORDER = ["CASH_REGISTER", "SAFE", "BANK", "MOBILE_MONEY", "OTHER"];
const byOrder = (a: Account, b: Account) =>
  ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.name.localeCompare(b.name, "fr");

async function buildReport(tx: Tx, org: OrgBillingContext, input: TreasuryReportInput) {
  const accounts = (await tx.treasuryAccount.findMany()).sort(byOrder);
  const selected = input.accountId ? accounts.filter((a) => a.id === input.accountId) : accounts;
  if (input.accountId && selected.length === 0)
    throw new TRPCError({ code: "NOT_FOUND", message: "Compte introuvable." });
  const ids = selected.map((a) => a.id);
  const from = zonedInstant(input.from, 0, org.timeZone);
  const to = zonedInstant(addDaysToKey(input.to, 1), 0, org.timeZone);
  const included = (a: Account) => a.openingDate <= businessDate(input.to);
  const [before, during, movements] = await Promise.all([
    treasuryTotals(tx, { before: from, accountIds: ids }),
    treasuryTotals(tx, { from, to, accountIds: ids }),
    tx.treasuryMovement.findMany({
      where: { accountId: { in: ids }, occurredAt: { gte: from, lt: to } },
      select: {
        accountId: true,
        direction: true,
        kind: true,
        amount: true,
        occurredAt: true,
        category: true,
      },
    }),
  ]);
  const openingOf = (a: Account) => {
    const t = before.get(a.id) ?? { in: 0, out: 0 };
    return (included(a) ? a.openingBalance : 0) + t.in - t.out;
  };
  const opening = selected.reduce((s, a) => s + openingOf(a), 0);
  const report = periodReport({
    opening,
    movements: movements.map((m) => ({ ...m, kind: m.kind as MovementKindLike })),
    from: input.from,
    to: input.to,
    groupBy: input.groupBy,
    timeZone: org.timeZone,
    excludeInternal: !input.accountId,
  });
  return {
    ...report,
    accounts: selected.map((a) => {
      const t = during.get(a.id) ?? { in: 0, out: 0 };
      const o = openingOf(a);
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        opening: o,
        inflow: t.in,
        outflow: t.out,
        closing: o + t.in - t.out,
      };
    }),
    accountName: input.accountId ? (selected[0]?.name ?? null) : null,
    timeZone: org.timeZone,
  };
}

export { buildReport as buildTreasuryReport, prepare as prepareTreasury };

export const treasuryRouter = router({
  /** /tresorerie — total, comptes et soldes, flux du mois, alertes, derniers mouvements. */
  overview: requirePermission("treasury:read").query(async ({ ctx }) => {
    const org = await loadOrgBillingContext(ctx.organizationId);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.transaction(async (tx) => {
      const sync = await prepare(tx, ctx, org);
      const accounts = (
        await tx.treasuryAccount.findMany({ include: { site: { select: { name: true } } } })
      ).sort(byOrder);
      const monthStart = zonedInstant(
        `${localDateKey(org.now, org.timeZone).slice(0, 7)}-01`,
        0,
        org.timeZone,
      );
      const [balances, month, recent, lastRecs, pendingExpenses, sites] = await Promise.all([
        balancesOf(tx, accounts),
        treasuryTotals(tx, { from: monthStart }),
        tx.treasuryMovement.findMany({
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: 8,
          include: { account: { select: { name: true } } },
        }),
        tx.treasuryReconciliation.findMany({
          orderBy: { statementDate: "desc" },
          distinct: ["accountId"],
          select: { accountId: true, statementDate: true, difference: true },
        }),
        tx.expense.count({ where: { status: "PENDING", treasuryAccountId: { not: null } } }),
        tx.site.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ]);
      const active = accounts.filter((a) => !a.archivedAt);
      const unassignedByMethod = new Map<string, { count: number; amount: number }>();
      for (const u of sync.unassigned) {
        const k = u.reason === "no_destination" ? "DROP" : (u.method ?? "OTHER");
        const row = unassignedByMethod.get(k) ?? { count: 0, amount: 0 };
        row.count += 1;
        row.amount += u.amount;
        unassignedByMethod.set(k, row);
      }
      return {
        total: active.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0),
        monthIn: [...month.values()].reduce((s, t) => s + t.in, 0),
        monthOut: [...month.values()].reduce((s, t) => s + t.out, 0),
        accounts: accounts.map((a) => {
          const m = month.get(a.id) ?? { in: 0, out: 0 };
          const rec = lastRecs.find((r) => r.accountId === a.id);
          return accountView(a, balances.get(a.id) ?? a.openingBalance, {
            site: a.site?.name ?? null,
            monthIn: m.in,
            monthOut: m.out,
            lastReconciliation: rec
              ? { date: rec.statementDate.toISOString().slice(0, 10), difference: rec.difference }
              : null,
          });
        }),
        alerts: {
          unassigned: [...unassignedByMethod.entries()].map(([method, v]) => ({ method, ...v })),
          negative: active
            .filter((a) => (balances.get(a.id) ?? 0) < 0)
            .map((a) => ({ id: a.id, name: a.name, balance: balances.get(a.id) ?? 0 })),
          pendingExpenses,
        },
        recent: recent.map((m) => ({
          id: m.id,
          account: m.account.name,
          direction: m.direction,
          kind: m.kind,
          amount: m.amount,
          occurredAt: m.occurredAt,
          label: m.label,
        })),
        categories: {
          income: [...DEFAULT_TREASURY_CATEGORIES.income],
          expense: [
            ...new Set([...DEFAULT_TREASURY_CATEGORIES.expense, ...org.settings.expenseCategories]),
          ],
          adjustment: [...DEFAULT_TREASURY_CATEGORIES.adjustment],
        },
        expenseApproval: org.settings.expenseApproval,
        sites,
        timeZone: org.timeZone,
        today: localDateKey(org.now, org.timeZone),
      };
    });
  }),

  /** Liste légère des comptes actifs (sélecteurs). */
  accounts: requirePermission("treasury:read").query(async ({ ctx }) => {
    const org = await loadOrgBillingContext(ctx.organizationId);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.transaction(async (tx) => {
      await prepare(tx, ctx, org);
      const accounts = (await tx.treasuryAccount.findMany({ where: { archivedAt: null } })).sort(
        byOrder,
      );
      const balances = await balancesOf(tx, accounts);
      return accounts.map((a) => accountView(a, balances.get(a.id) ?? a.openingBalance));
    });
  }),

  createAccount: requirePermission("treasury:manage")
    .input(createTreasuryAccountInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const others = await tx.treasuryAccount.findMany();
        if (input.siteId) await resolveSiteId(tx, ctx, input.siteId);
        guard(() =>
          checkAccount({
            account: {
              name: input.name,
              type: input.type,
              siteId: input.siteId ?? null,
              paymentMethods: input.paymentMethods,
            },
            others: others.map(toAccountLike),
            openingBalance: input.openingBalance,
          }),
        );
        const account = await tx.treasuryAccount.create({
          data: {
            organizationId: ctx.organizationId,
            name: input.name.trim(),
            type: input.type,
            siteId: input.type === "CASH_REGISTER" ? (input.siteId ?? null) : null,
            paymentMethods: input.paymentMethods,
            bankName: input.bankName || null,
            accountRef: input.accountRef || null,
            ledgerAccount: input.ledgerAccount || DEFAULT_LEDGER_BY_TYPE[input.type],
            openingBalance: input.openingBalance,
            openingDate: businessDate(input.openingDate),
            createdById: ctx.membership.id,
          },
        });
        await audit(actorOf(ctx), "treasury.account_created", "TreasuryAccount", account.id, {
          after: {
            name: account.name,
            type: account.type,
            paymentMethods: account.paymentMethods,
            openingBalance: account.openingBalance,
            openingDate: input.openingDate,
          },
        });
        return { id: account.id };
      });
    }),

  updateAccount: requirePermission("treasury:manage")
    .input(updateTreasuryAccountInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const account = await loadAccount(tx, input.id);
        if (account.archivedAt) bad("Ce compte est archivé.");
        const others = await tx.treasuryAccount.findMany();
        guard(() =>
          checkAccount({
            account: {
              id: account.id,
              name: input.name,
              type: account.type as TreasuryAccountTypeLike,
              siteId: account.siteId,
              paymentMethods: input.paymentMethods,
            },
            others: others.map(toAccountLike),
            openingBalance: account.openingBalance,
          }),
        );
        const updated = await tx.treasuryAccount.update({
          where: { id: account.id },
          data: {
            name: input.name.trim(),
            paymentMethods: input.paymentMethods,
            bankName: input.bankName || null,
            ...(input.accountRef ? { accountRef: input.accountRef } : {}),
            ledgerAccount: input.ledgerAccount || account.ledgerAccount,
          },
        });
        await audit(actorOf(ctx), "treasury.account_updated", "TreasuryAccount", account.id, {
          before: { name: account.name, paymentMethods: account.paymentMethods },
          after: { name: updated.name, paymentMethods: updated.paymentMethods },
        });
        return { id: updated.id };
      });
    }),

  archiveAccount: requirePermission("treasury:manage")
    .input(treasuryIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        await prepare(tx, ctx, org);
        const account = await loadAccount(tx, input.id);
        if (account.archivedAt) bad("Ce compte est déjà archivé.");
        const balance = await balanceOf(tx, account);
        guard(() => checkArchive(balance, account.type as TreasuryAccountTypeLike));
        await tx.treasuryAccount.update({
          where: { id: account.id },
          data: { archivedAt: org.now, paymentMethods: [] },
        });
        await audit(actorOf(ctx), "treasury.account_archived", "TreasuryAccount", account.id, {
          before: { paymentMethods: account.paymentMethods },
        });
        return { id: account.id };
      });
    }),

  /** /tresorerie/journal — toutes les entrées et sorties, filtrées, avec totaux. */
  journal: requirePermission("treasury:read")
    .input(treasuryJournalInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        await prepare(tx, ctx, org);
        const occurredAt = periodRange(input.from, input.to, org.timeZone);
        const where: Prisma.TreasuryMovementWhereInput = {
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(input.flow ? { direction: input.flow } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
          ...(occurredAt ? { occurredAt } : {}),
          ...(input.q
            ? {
                OR: [
                  { label: { contains: input.q, mode: "insensitive" } },
                  { reference: { contains: input.q, mode: "insensitive" } },
                  { category: { contains: input.q, mode: "insensitive" } },
                ],
              }
            : {}),
        };
        const [rows, sums] = await Promise.all([
          tx.treasuryMovement.findMany({
            where,
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            take: input.limit + 1,
            ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
            include: { account: { select: { name: true, type: true } } },
          }),
          tx.treasuryMovement.groupBy({
            by: ["direction"],
            where,
            _sum: { amount: true },
            _count: true,
          }),
        ]);
        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const reversed = new Set(
          (
            await tx.treasuryMovement.findMany({
              where: { reversalOfId: { in: items.map((m) => m.id) } },
              select: { reversalOfId: true },
            })
          ).map((r) => r.reversalOfId),
        );
        const sum = (d: "IN" | "OUT") => sums.find((s) => s.direction === d)?._sum.amount ?? 0;
        const count = sums.reduce((s, r) => s + r._count, 0);
        return {
          items: items.map((m) => ({
            id: m.id,
            accountId: m.accountId,
            account: m.account.name,
            accountType: m.account.type,
            direction: m.direction,
            kind: m.kind,
            amount: m.amount,
            occurredAt: m.occurredAt,
            label: m.label,
            category: m.category,
            categoryLabel:
              m.kind === "PAYMENT" || m.kind === "REFUND" || m.kind === "PAYMENT_REVERSAL"
                ? methodName(m.category ?? "")
                : m.category,
            reference: m.reference,
            href: sourceHref(m),
            reversible:
              (m.kind === "INCOME" || m.kind === "ADJUSTMENT" || m.kind === "TRANSFER") &&
              !m.reversalOfId &&
              !reversed.has(m.id),
            isReversal: Boolean(m.reversalOfId),
            reversed: reversed.has(m.id),
          })),
          nextCursor: hasMore ? items[items.length - 1]!.id : null,
          totals: { inflow: sum("IN"), outflow: sum("OUT"), count },
          timeZone: org.timeZone,
        };
      });
    }),

  /** RG-M18-05 — virement entre deux comptes (deux mouvements liés). */
  transfer: requirePermission("treasury:manage")
    .input(treasuryTransferInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        await prepare(tx, ctx, org);
        const [from, to] = await Promise.all([
          tx.treasuryAccount.findFirst({ where: { id: input.fromAccountId } }),
          tx.treasuryAccount.findFirst({ where: { id: input.toAccountId } }),
        ]);
        const fromBalance = from ? await balanceOf(tx, from) : 0;
        guard(() =>
          checkTransfer({
            from: from ? toAccountLike(from) : null,
            to: to ? toAccountLike(to) : null,
            amount: input.amount,
            fromBalance,
          }),
        );
        const occurredAt = occurredAtFor(input.date, org);
        const transfer = await tx.treasuryTransfer.create({
          data: {
            organizationId: ctx.organizationId,
            fromAccountId: from!.id,
            toAccountId: to!.id,
            amount: input.amount,
            occurredAt,
            reference: input.reference || null,
            notes: input.notes || null,
            createdById: ctx.membership.id,
          },
        });
        const common = {
          organizationId: ctx.organizationId,
          kind: "TRANSFER" as const,
          amount: input.amount,
          occurredAt,
          reference: input.reference || null,
          category: null,
          sourceType: "transfer",
          sourceId: transfer.id,
          transferId: transfer.id,
          createdById: ctx.membership.id,
        };
        const note = input.notes ? ` — ${input.notes}` : "";
        await tx.treasuryMovement.createMany({
          data: [
            {
              ...common,
              accountId: from!.id,
              direction: "OUT",
              label: `Virement vers ${to!.name}${note}`,
              counterpartAccountId: to!.id,
            },
            {
              ...common,
              accountId: to!.id,
              direction: "IN",
              label: `Virement depuis ${from!.name}${note}`,
              counterpartAccountId: from!.id,
            },
          ],
        });
        await audit(actorOf(ctx), "treasury.transfer", "TreasuryTransfer", transfer.id, {
          after: { from: from!.name, to: to!.name, amount: input.amount },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "treasury.transfer_created", {
          transferId: transfer.id,
          amount: input.amount,
        });
        return {
          id: transfer.id,
          overdraft: from!.type === "BANK" && input.amount > fromBalance,
        };
      });
    }),

  /** RG-M18-06 — entrée diverse ou ajustement (motif, catégorie, audit). */
  createMovement: requirePermission("treasury:manage")
    .input(treasuryMovementInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        await prepare(tx, ctx, org);
        const account = await tx.treasuryAccount.findFirst({ where: { id: input.accountId } });
        const balance = account ? await balanceOf(tx, account) : 0;
        guard(() =>
          checkManualMovement({
            account: account ? toAccountLike(account) : null,
            direction: input.direction,
            kind: input.kind,
            amount: input.amount,
            category: input.category,
            label: input.label,
            balance,
          }),
        );
        const movement = await tx.treasuryMovement.create({
          data: {
            organizationId: ctx.organizationId,
            accountId: account!.id,
            siteId: account!.siteId,
            direction: input.direction,
            kind: input.kind,
            amount: input.amount,
            occurredAt: occurredAtFor(input.date, org),
            label: input.label,
            category: input.category,
            reference: input.reference || null,
            sourceType: "manual",
            createdById: ctx.membership.id,
          },
        });
        await audit(actorOf(ctx), "treasury.movement", "TreasuryMovement", movement.id, {
          after: {
            account: account!.name,
            direction: input.direction,
            kind: input.kind,
            amount: input.amount,
            category: input.category,
          },
          reason: input.label,
        });
        return { id: movement.id };
      });
    }),

  /** RG-M18-06 — contre-passation d'un mouvement manuel ou d'un virement (les deux jambes). */
  reverseMovement: requirePermission("treasury:manage")
    .input(treasuryReverseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const movement = await tx.treasuryMovement.findFirst({ where: { id: input.id } });
        if (!movement)
          throw new TRPCError({ code: "NOT_FOUND", message: "Mouvement introuvable." });
        const legs = movement.transferId
          ? await tx.treasuryMovement.findMany({
              where: { transferId: movement.transferId, reversalOfId: null },
            })
          : [movement];
        const alreadyReversed =
          (await tx.treasuryMovement.count({
            where: { reversalOfId: { in: legs.map((l) => l.id) } },
          })) > 0;
        guard(() =>
          checkReversal(
            {
              kind: movement.kind as MovementKindLike,
              reversalOfId: movement.reversalOfId,
              alreadyReversed,
            },
            input.reason,
          ),
        );
        for (const leg of legs) {
          await tx.treasuryMovement.create({
            data: {
              organizationId: ctx.organizationId,
              accountId: leg.accountId,
              siteId: leg.siteId,
              direction: leg.direction === "IN" ? "OUT" : "IN",
              kind: leg.kind,
              amount: leg.amount,
              occurredAt: org.now,
              label: `Contre-passation : ${leg.label} — ${input.reason}`,
              category: leg.category,
              reference: leg.reference,
              sourceType: "manual",
              transferId: leg.transferId,
              counterpartAccountId: leg.counterpartAccountId,
              reversalOfId: leg.id,
              createdById: ctx.membership.id,
            },
          });
        }
        await audit(actorOf(ctx), "treasury.reversed", "TreasuryMovement", movement.id, {
          before: { amount: movement.amount, kind: movement.kind },
          reason: input.reason,
        });
        return { reversed: legs.length };
      });
    }),

  /** US-M18-04 — dépense payée hors caisse (banque, mobile money…), validation au-delà du seuil. */
  expense: requirePermission("treasury:manage")
    .input(treasuryExpenseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        await prepare(tx, ctx, org);
        const account = await tx.treasuryAccount.findFirst({ where: { id: input.accountId } });
        if (!account || account.archivedAt) bad("Compte introuvable ou archivé.");
        if (account!.type === "CASH_REGISTER")
          bad("Une dépense en espèces de la caisse se saisit depuis la caisse du site.");
        const categories = [
          ...new Set([...DEFAULT_TREASURY_CATEGORIES.expense, ...org.settings.expenseCategories]),
        ];
        const check = guard(() =>
          checkExpense({
            amount: input.amount,
            category: input.category,
            description: input.description,
            categories,
            approvalThreshold: org.settings.expenseApproval,
            canApprove: ctx.permissions.has("cash:expense_approve"),
            sessionClosed: false,
          }),
        );
        if (check.status === "APPROVED" && account!.type !== "BANK") {
          const balance = await balanceOf(tx, account!);
          if (input.amount > balance)
            bad(`Solde insuffisant sur « ${account!.name} » (${formatFCFA(balance)} disponibles).`);
        }
        const siteId = account!.siteId ?? (await resolveSiteId(tx, ctx));
        const expense = await tx.expense.create({
          data: {
            organizationId: ctx.organizationId,
            siteId,
            cashSessionId: null,
            treasuryAccountId: account!.id,
            category: input.category,
            amount: input.amount,
            description: input.description,
            paidAt: occurredAtFor(input.date, org),
            createdById: ctx.membership.id,
            status: check.status,
            approvedById: check.approved ? ctx.membership.id : null,
            approvedAt: check.approved ? org.now : null,
          },
        });
        if (check.status === "PENDING") {
          await notify(tx, ctx.organizationId, await membersWithRoles(tx, ["OWNER", "MANAGER"]), {
            type: "cash.expense_pending",
            title: `Dépense à valider : ${formatFCFA(input.amount)}`,
            body: `${input.category} — ${input.description} (${account!.name})`,
            link: "/caisse/depenses?status=PENDING",
            dedupeKey: `cash.expense_pending:${expense.id}`,
          });
        }
        await audit(actorOf(ctx), "treasury.expense", "Expense", expense.id, {
          siteId,
          after: {
            amount: input.amount,
            category: input.category,
            account: account!.name,
            status: check.status,
          },
        });
        await syncTreasuryLedger(tx, {
          organizationId: ctx.organizationId,
          timeZone: org.timeZone,
          now: org.now,
        });
        return { id: expense.id, status: expense.status };
      });
    }),

  uploadExpenseReceipt: requirePermission("treasury:manage")
    .input(uploadExpenseReceiptInputSchema)
    .mutation(({ ctx, input }) => storeExpenseReceipt(ctx, input)),

  /** RG-M18-07 — rapprochement avec un relevé ; ajustement facultatif de l'écart. */
  reconcile: requirePermission("treasury:manage")
    .input(treasuryReconcileInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        await prepare(tx, ctx, org);
        const account = await loadAccount(tx, input.accountId);
        if (account.archivedAt) bad("Ce compte est archivé.");
        if (input.statementDate > localDateKey(org.now, org.timeZone))
          bad("La date du relevé ne peut pas être dans le futur.");
        if (businessDate(input.statementDate) < account.openingDate)
          bad("La date du relevé précède l'ouverture du compte.");
        const end = zonedInstant(addDaysToKey(input.statementDate, 1), 0, org.timeZone);
        const computed =
          (await balancesOf(tx, [account], end)).get(account.id) ?? account.openingBalance;
        const result = guard(() => reconcile(input.statementBalance, computed));
        if (input.postAdjustment && !result.balanced && !input.notes?.trim())
          bad("Indiquez le motif de l'ajustement.");
        const rec = await tx.treasuryReconciliation.create({
          data: {
            organizationId: ctx.organizationId,
            accountId: account.id,
            statementDate: businessDate(input.statementDate),
            statementBalance: input.statementBalance,
            computedBalance: computed,
            difference: result.difference,
            notes: input.notes || null,
            createdById: ctx.membership.id,
          },
        });
        if (input.postAdjustment && !result.balanced) {
          await tx.treasuryMovement.create({
            data: {
              organizationId: ctx.organizationId,
              accountId: account.id,
              siteId: account.siteId,
              direction: result.difference > 0 ? "IN" : "OUT",
              kind: "ADJUSTMENT",
              amount: Math.abs(result.difference),
              occurredAt: new Date(end.getTime() - 1000),
              label: `Écart de rapprochement au ${input.statementDate.split("-").reverse().join("/")} — ${input.notes}`,
              category: "Écart de rapprochement",
              sourceType: "reconciliation",
              sourceId: rec.id,
              reconciliationId: rec.id,
              createdById: ctx.membership.id,
            },
          });
        }
        await audit(actorOf(ctx), "treasury.reconciled", "TreasuryReconciliation", rec.id, {
          after: {
            account: account.name,
            statementDate: input.statementDate,
            statementBalance: input.statementBalance,
            computedBalance: computed,
            difference: result.difference,
            adjusted: input.postAdjustment && !result.balanced,
          },
          reason: input.notes ?? null,
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "treasury.reconciled", {
          reconciliationId: rec.id,
          difference: result.difference,
        });
        return { id: rec.id, computedBalance: computed, difference: result.difference };
      });
    }),

  /** /tresorerie/comptes/[id] — compte, solde, série 30 jours, rapprochements. */
  account: requirePermission("treasury:read")
    .input(treasuryAccountDetailInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        await prepare(tx, ctx, org);
        const account = await tx.treasuryAccount.findFirst({
          where: { id: input.id },
          include: { site: { select: { name: true } } },
        });
        if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Compte introuvable." });
        const today = localDateKey(org.now, org.timeZone);
        const from = addDaysToKey(today, -29);
        const [balance, reconciliations, report] = await Promise.all([
          balanceOf(tx, account),
          tx.treasuryReconciliation.findMany({
            where: { accountId: account.id },
            orderBy: { statementDate: "desc" },
            take: 12,
          }),
          buildReport(tx, org, { from, to: today, accountId: account.id, groupBy: "day" }),
        ]);
        return {
          ...accountView(account, balance, { site: account.site?.name ?? null }),
          last30: {
            from,
            to: today,
            series: report.series,
            inflow: report.inflow,
            outflow: report.outflow,
          },
          reconciliations: reconciliations.map((r) => ({
            id: r.id,
            statementDate: r.statementDate.toISOString().slice(0, 10),
            statementBalance: r.statementBalance,
            computedBalance: r.computedBalance,
            difference: r.difference,
            notes: r.notes,
          })),
          timeZone: org.timeZone,
          today,
        };
      });
    }),

  /** RG-M18-08 — rapport d'une période (tous comptes ou un compte). */
  report: requirePermission("treasury:read")
    .input(treasuryReportInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        await prepare(tx, ctx, org);
        return buildReport(tx, org, input);
      });
    }),
});
