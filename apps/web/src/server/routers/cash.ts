// M08 §8 — caisse (RG-M08-27..30) : ouverture, récapitulatif, dépenses, versements, clôture
// avec comptage et écart, validation de l'écart, historique ; remboursements (RG-M08-22).
import { TRPCError } from "@trpc/server";
import {
  assertCanOpenSession,
  checkExpense,
  closeCash,
  denominationsTotal,
  expectedCash,
  formatFCFA,
  isLateClose,
  type PaymentMethodLike,
} from "@atelieros/core";
import { db, type CashSession, type Prisma } from "@atelieros/db";
import {
  cashDropInputSchema,
  cashExpenseInputSchema,
  cashSessionsInputSchema,
  cashSiteInputSchema,
  closeCashInputSchema,
  createRefundInputSchema,
  openCashInputSchema,
  reviewCashInputSchema,
} from "@atelieros/validators";
import { actorOf, resolveSiteId } from "../billing/context";
import { createRefund } from "../billing/payments";
import { audit, bad, guard, loadOrgBillingContext, type Tx } from "../billing/service";
import { emitDomainEvent } from "../events/emit";
import { membersWithRoles, notify } from "../repairOrders/helpers";
import { requirePermission, requireSite, router } from "../trpc";

/** Récapitulatif d'une session : encaissements par méthode, dépenses, versements, espèces attendues. */
export async function sessionSummary(tx: Tx, session: CashSession) {
  const [payments, expenses, drops, refunds] = await Promise.all([
    tx.payment.findMany({
      where: {
        cashSessionId: session.id,
        voidedAt: null,
        status: { in: ["CONFIRMED", "PENDING", "REFUNDED"] },
      },
      select: {
        id: true,
        number: true,
        method: true,
        amount: true,
        status: true,
        receivedAt: true,
        customer: { select: { displayName: true } },
      },
      orderBy: { receivedAt: "asc" },
    }),
    tx.expense.findMany({ where: { cashSessionId: session.id }, orderBy: { paidAt: "asc" } }),
    tx.cashDrop.findMany({ where: { cashSessionId: session.id }, orderBy: { createdAt: "asc" } }),
    tx.refund.findMany({ where: { cashSessionId: session.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const byMethod: Partial<Record<PaymentMethodLike, number>> = {};
  for (const p of payments) {
    if (p.status === "PENDING") continue;
    byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
  }
  const cashPayments = byMethod.CASH ?? 0;
  const expensesTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const dropsTotal = drops.reduce((s, d) => s + d.amount, 0);
  const cashRefunds = refunds.filter((r) => r.method === "CASH").reduce((s, r) => s + r.amount, 0);
  const expected = expectedCash({
    openingFloat: session.openingFloat,
    cashPayments,
    expenses: expensesTotal,
    cashRefunds,
    drops: dropsTotal,
  });
  return {
    byMethod,
    totalReceived: Object.values(byMethod).reduce((s, v) => s + (v ?? 0), 0),
    cashPayments,
    expensesTotal,
    dropsTotal,
    cashRefunds,
    expectedCash: expected,
    payments,
    expenses,
    drops,
    refunds,
  };
}

async function loadSession(tx: Tx, ctx: { allowedSiteIds: string[] | "ALL" }, id: string) {
  const session = await tx.cashSession.findFirst({ where: { id } });
  if (!session)
    throw new TRPCError({ code: "NOT_FOUND", message: "Session de caisse introuvable." });
  requireSite(ctx, session.siteId);
  return session;
}

export const cashRouter = router({
  /** Session ouverte du site + récapitulatif ; fond proposé = compté de la dernière clôture. */
  current: requirePermission("payment:read")
    .input(cashSiteInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const siteId = await resolveSiteId(tx, ctx, input.siteId);
        const site = await tx.site.findFirstOrThrow({
          where: { id: siteId },
          select: { id: true, name: true },
        });
        const open = await tx.cashSession.findMany({
          where: { siteId, closedAt: null },
          orderBy: { openedAt: "asc" },
          include: { openedBy: { select: { user: { select: { name: true } } } } },
        });
        const session = open.find((s) => s.openedById === ctx.membership.id) ?? open[0] ?? null;
        const last = await tx.cashSession.findFirst({
          where: { siteId, closedAt: { not: null } },
          orderBy: { closedAt: "desc" },
          select: { countedCash: true },
        });
        return {
          site,
          session: session
            ? {
                ...session,
                openedByName: session.openedBy.user.name,
                ...(await sessionSummary(tx, session)),
              }
            : null,
          suggestedFloat: last?.countedCash ?? 0,
          expenseCategories: org.settings.expenseCategories,
          expenseApproval: org.settings.expenseApproval,
          timeZone: org.timeZone,
        };
      });
    }),

  open: requirePermission("cash:operate")
    .input(openCashInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const siteId = await resolveSiteId(tx, ctx, input.siteId);
        // Verrou : deux ouvertures simultanées sur le même site se sérialisent sur le site.
        await tx.site.update({ where: { id: siteId }, data: { updatedAt: org.now } });
        const openSessions = await tx.cashSession.findMany({
          where: { siteId, closedAt: null },
          select: { id: true, openedById: true, openedAt: true },
        });
        guard(() =>
          assertCanOpenSession({
            openSessions,
            membershipId: ctx.membership.id,
            oneSessionPerSite: org.settings.oneSessionPerSite,
            openingFloat: input.openingFloat,
            now: org.now,
            timeZone: org.timeZone,
          }),
        );
        const session = await tx.cashSession.create({
          data: {
            organizationId: ctx.organizationId,
            siteId,
            openedById: ctx.membership.id,
            openedAt: org.now,
            openingFloat: input.openingFloat,
          },
        });
        await audit(actorOf(ctx), "cash.opened", "CashSession", session.id, {
          siteId,
          after: { openingFloat: input.openingFloat },
        });
        return session;
      });
    }),

  expense: requirePermission("cash:expense")
    .input(cashExpenseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const session = await loadSession(tx, ctx, input.sessionId);
        const check = guard(() =>
          checkExpense({
            amount: input.amount,
            category: input.category,
            description: input.description,
            categories: org.settings.expenseCategories,
            approvalThreshold: org.settings.expenseApproval,
            canApprove: ctx.permissions.has("cash:expense_approve"),
            sessionClosed: Boolean(session.closedAt),
          }),
        );
        const expense = await tx.expense.create({
          data: {
            organizationId: ctx.organizationId,
            siteId: session.siteId,
            cashSessionId: session.id,
            category: input.category,
            amount: input.amount,
            description: input.description,
            paidAt: org.now,
            createdById: ctx.membership.id,
            attachmentId: input.attachmentId ?? null,
            approvedById: check.approved ? ctx.membership.id : null,
            approvedAt: check.approved ? org.now : null,
          },
        });
        await audit(actorOf(ctx), "cash.expense", "Expense", expense.id, {
          siteId: session.siteId,
          after: { amount: input.amount, category: input.category },
        });
        return expense;
      });
    }),

  drop: requirePermission("cash:operate")
    .input(cashDropInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const session = await loadSession(tx, ctx, input.sessionId);
        if (session.closedAt) bad("Cette caisse est clôturée.");
        const summary = await sessionSummary(tx, session);
        if (input.amount > summary.expectedCash) {
          bad(
            `Le versement dépasse les espèces attendues en caisse (${formatFCFA(summary.expectedCash)}).`,
          );
        }
        const drop = await tx.cashDrop.create({
          data: {
            organizationId: ctx.organizationId,
            siteId: session.siteId,
            cashSessionId: session.id,
            amount: input.amount,
            destination: input.destination,
            reference: input.reference ?? null,
            createdById: ctx.membership.id,
          },
        });
        await audit(actorOf(ctx), "cash.drop", "CashDrop", drop.id, {
          siteId: session.siteId,
          after: { amount: input.amount, destination: input.destination },
        });
        return drop;
      });
    }),

  /** US-M08-11 — clôture : comptage (coupures facultatives), écart, commentaire, alerte gérant. */
  close: requirePermission("cash:close")
    .input(closeCashInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const session = await loadSession(tx, ctx, input.id);
        if (session.closedAt) bad("Cette caisse est déjà clôturée.");
        const fromDenominations = input.denominations
          ? guard(() => denominationsTotal(input.denominations!))
          : null;
        if (
          fromDenominations !== null &&
          input.countedCash !== undefined &&
          fromDenominations !== input.countedCash
        ) {
          bad(
            `Le détail par coupures (${formatFCFA(fromDenominations)}) ne correspond pas au montant compté (${formatFCFA(input.countedCash)}).`,
          );
        }
        const counted = input.countedCash ?? fromDenominations;
        if (counted === null || counted === undefined) bad("Indiquez le montant compté.");
        const summary = await sessionSummary(tx, session);
        const result = guard(() =>
          closeCash({
            expected: summary.expectedCash,
            counted,
            notes: input.notes,
            varianceAlert: org.settings.varianceAlert,
          }),
        );
        const lateClose = isLateClose(session.openedAt, org.now, org.timeZone);
        const closed = await tx.cashSession.update({
          where: { id: session.id },
          data: {
            closedAt: org.now,
            closedById: ctx.membership.id,
            expectedCash: summary.expectedCash,
            countedCash: counted,
            difference: result.difference,
            notes: input.notes ?? null,
            denominations: (input.denominations ?? undefined) as Prisma.InputJsonValue | undefined,
            lateClose,
          },
        });
        if (result.alert) {
          await notify(tx, ctx.organizationId, await membersWithRoles(tx, ["OWNER"]), {
            type: "cash.variance",
            title: `Écart de caisse ${formatFCFA(result.difference)}`,
            body: input.notes ?? undefined,
            link: "/caisse/sessions",
            dedupeKey: `cash.variance:${session.id}`,
          });
        }
        await emitDomainEvent(tx as never, ctx.organizationId, "cash.session_closed", {
          sessionId: session.id,
          siteId: session.siteId,
          difference: result.difference,
          lateClose,
        });
        await audit(actorOf(ctx), "cash.closed", "CashSession", session.id, {
          siteId: session.siteId,
          after: {
            expectedCash: summary.expectedCash,
            countedCash: counted,
            difference: result.difference,
            lateClose,
          },
          reason: input.notes ?? null,
        });
        return closed;
      });
    }),

  /** Validation de l'écart par le propriétaire (`CLOSED → REVIEWED`). */
  review: requirePermission("cash:review")
    .input(reviewCashInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const session = await loadSession(tx, ctx, input.id);
        if (!session.closedAt) bad("Clôturez la caisse avant de valider l'écart.");
        if (session.reviewedAt) bad("Cet écart est déjà validé.");
        const reviewed = await tx.cashSession.update({
          where: { id: session.id },
          data: {
            reviewedById: ctx.membership.id,
            reviewedAt: org.now,
            reviewComment: input.comment,
          },
        });
        await audit(actorOf(ctx), "cash.reviewed", "CashSession", session.id, {
          siteId: session.siteId,
          after: { difference: session.difference },
          reason: input.comment,
        });
        return reviewed;
      });
    }),

  /** /caisse/sessions — historique, écarts, clôtures tardives. */
  sessions: requirePermission("payment:read")
    .input(cashSessionsInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const rows = await tenantDb.cashSession.findMany({
        where: {
          ...(ctx.allowedSiteIds !== "ALL" ? { siteId: { in: ctx.allowedSiteIds } } : {}),
          ...(input.siteId ? { siteId: input.siteId } : {}),
        },
        orderBy: [{ openedAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          site: { select: { name: true } },
          openedBy: { select: { user: { select: { name: true } } } },
          closedBy: { select: { user: { select: { name: true } } } },
        },
      });
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        items: items.map((s) => ({
          id: s.id,
          site: s.site.name,
          openedAt: s.openedAt,
          closedAt: s.closedAt,
          openedBy: s.openedBy.user.name,
          closedBy: s.closedBy?.user.name ?? null,
          openingFloat: s.openingFloat,
          expectedCash: s.expectedCash,
          countedCash: s.countedCash,
          difference: s.difference,
          lateClose: s.lateClose,
          reviewedAt: s.reviewedAt,
          notes: s.notes,
        })),
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
        timeZone: org.timeZone,
      };
    }),
});

/** M08 §8 `refund.create` — remboursement d'un trop-perçu ou d'un crédit client. */
export const refundRouter = router({
  create: requirePermission("payment:refund")
    .input(createRefundInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const siteId = await resolveSiteId(tx, ctx);
        return createRefund(tx, actorOf(ctx), org, { ...input, siteId });
      });
    }),
});
