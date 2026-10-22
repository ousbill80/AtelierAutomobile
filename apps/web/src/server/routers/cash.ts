// M08 §8 — caisse (RG-M08-27..30) : ouverture, récapitulatif, dépenses (validation au-delà du
// seuil, justificatif), versements, clôture avec comptage, écart et instantané figé (Z de
// caisse), validation de l'écart, historique filtrable, écarts par caissier, réglages ;
// remboursements (RG-M08-22).
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  addDaysToKey,
  assertCanOpenSession,
  billingSettingsFrom,
  checkExpense,
  closeCash,
  decideExpense,
  denominationsTotal,
  expectedCash,
  expensesByCategory,
  formatFCFA,
  isLateClose,
  readClosingSummary,
  varianceByCashier,
  zonedInstant,
  type ClosingSummary,
  type PaymentMethodLike,
} from "@atelieros/core";
import { adminDb, db, type CashSession, type Prisma } from "@atelieros/db";
import {
  cashDropInputSchema,
  cashExpenseInputSchema,
  cashExpensesInputSchema,
  cashSessionInputSchema,
  cashSessionsInputSchema,
  cashSettingsInputSchema,
  cashSiteInputSchema,
  closeCashInputSchema,
  createRefundInputSchema,
  decideExpenseInputSchema,
  openCashInputSchema,
  reviewCashInputSchema,
  uploadExpenseReceiptInputSchema,
} from "@atelieros/validators";
import { actorOf, resolveSiteId } from "../billing/context";
import { createRefund } from "../billing/payments";
import { audit, bad, guard, loadOrgBillingContext, type Tx } from "../billing/service";
import { emitDomainEvent } from "../events/emit";
import { membersWithRoles, notify } from "../repairOrders/helpers";
import { getAttachmentStorage } from "../storage";
import { requirePermission, requireSite, router } from "../trpc";

/** Bornes UTC d'une période de dates métier (bornes incluses, fuseau de l'organisation). */
function periodRange(from: string | undefined, to: string | undefined, timeZone: string) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: zonedInstant(from, 0, timeZone) } : {}),
    ...(to ? { lt: zonedInstant(addDaysToKey(to, 1), 0, timeZone) } : {}),
  };
}

function siteScope(ctx: { allowedSiteIds: string[] | "ALL" }, siteId?: string) {
  return {
    ...(ctx.allowedSiteIds !== "ALL" ? { siteId: { in: ctx.allowedSiteIds } } : {}),
    ...(siteId ? { siteId } : {}),
  };
}

const memberName = { select: { user: { select: { name: true } } } } as const;

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
        reference: true,
        customer: { select: { displayName: true } },
        receivedBy: memberName,
      },
      orderBy: { receivedAt: "asc" },
    }),
    tx.expense.findMany({
      where: { cashSessionId: session.id },
      orderBy: { paidAt: "asc" },
      include: { createdBy: memberName, approvedBy: memberName, rejectedBy: memberName },
    }),
    tx.cashDrop.findMany({ where: { cashSessionId: session.id }, orderBy: { createdAt: "asc" } }),
    tx.refund.findMany({ where: { cashSessionId: session.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const byMethod: Partial<Record<PaymentMethodLike, number>> = {};
  let pendingCheques = 0;
  for (const p of payments) {
    if (p.status === "PENDING") {
      pendingCheques += p.amount;
      continue;
    }
    byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
  }
  const cashPayments = byMethod.CASH ?? 0;
  // RG-M08-30 : seules les dépenses validées sortent de la caisse.
  const approvedExpenses = expenses.filter((e) => e.status === "APPROVED");
  const pendingExpenses = expenses.filter((e) => e.status === "PENDING");
  const expensesTotal = approvedExpenses.reduce((s, e) => s + e.amount, 0);
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
    pendingExpensesTotal: pendingExpenses.reduce((s, e) => s + e.amount, 0),
    pendingExpensesCount: pendingExpenses.length,
    dropsTotal,
    cashRefunds,
    pendingCheques,
    expectedCash: expected,
    payments: payments.map(({ receivedBy, ...p }) => ({
      ...p,
      receivedByName: receivedBy?.user.name ?? null,
    })),
    expenses: expenses.map(({ createdBy, approvedBy, rejectedBy, ...e }) => ({
      ...e,
      createdByName: createdBy?.user.name ?? null,
      approvedByName: approvedBy?.user.name ?? null,
      rejectedByName: rejectedBy?.user.name ?? null,
      receiptUrl: e.attachmentId ? `/api/attachments/${e.attachmentId}` : null,
    })),
    drops,
    refunds,
  };
}

type SessionSummary = Awaited<ReturnType<typeof sessionSummary>>;

function toClosingSummary(
  session: CashSession,
  summary: SessionSummary,
  counted: number,
  difference: number,
): ClosingSummary {
  return {
    openingFloat: session.openingFloat,
    byMethod: Object.fromEntries(
      Object.entries(summary.byMethod).map(([method, amount]) => [method, amount ?? 0]),
    ),
    totalReceived: summary.totalReceived,
    cashPayments: summary.cashPayments,
    expensesTotal: summary.expensesTotal,
    dropsTotal: summary.dropsTotal,
    cashRefunds: summary.cashRefunds,
    expectedCash: summary.expectedCash,
    countedCash: counted,
    difference,
    pendingCheques: summary.pendingCheques,
    counts: {
      payments: summary.payments.length,
      expenses: summary.expenses.filter((e) => e.status === "APPROVED").length,
      drops: summary.drops.length,
      refunds: summary.refunds.length,
    },
  };
}

async function loadExpense(tx: Tx, ctx: { allowedSiteIds: string[] | "ALL" }, id: string) {
  const expense = await tx.expense.findFirst({ where: { id }, include: { cashSession: true } });
  if (!expense) throw new TRPCError({ code: "NOT_FOUND", message: "Dépense introuvable." });
  requireSite(ctx, expense.siteId);
  return expense;
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
            status: check.status,
            approvedById: check.approved ? ctx.membership.id : null,
            approvedAt: check.approved ? org.now : null,
          },
        });
        if (check.status === "PENDING") {
          const approvers = await tx.membership.findMany({
            where: { isActive: true, role: { in: ["OWNER", "MANAGER"] } },
            select: { id: true, role: true, siteIds: true },
          });
          await notify(
            tx,
            ctx.organizationId,
            approvers
              .filter(
                (m) =>
                  m.role === "OWNER" ||
                  m.siteIds.length === 0 ||
                  m.siteIds.includes(session.siteId),
              )
              .map((m) => m.id),
            {
              type: "cash.expense_pending",
              title: `Dépense à valider : ${formatFCFA(input.amount)}`,
              body: `${input.category} — ${input.description}`,
              link: "/caisse/depenses?status=PENDING",
              dedupeKey: `cash.expense_pending:${expense.id}`,
            },
          );
        }
        await audit(actorOf(ctx), "cash.expense", "Expense", expense.id, {
          siteId: session.siteId,
          after: { amount: input.amount, category: input.category, status: check.status },
        });
        return expense;
      });
    }),

  /** RG-M08-30 — le gérant valide ou refuse une dépense en attente (motif obligatoire au refus). */
  decideExpense: requirePermission("cash:expense_approve")
    .input(decideExpenseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const expense = await loadExpense(tx, ctx, input.id);
        const status = guard(() =>
          decideExpense({
            status: expense.status,
            decision: input.decision,
            comment: input.comment,
            sessionClosed: Boolean(expense.cashSession?.closedAt),
          }),
        );
        // Une validation ne doit pas faire passer la caisse en négatif.
        if (status === "APPROVED" && expense.cashSession) {
          const summary = await sessionSummary(tx, expense.cashSession);
          if (expense.amount > summary.expectedCash) {
            bad(
              `Espèces insuffisantes en caisse (${formatFCFA(summary.expectedCash)}) pour valider cette dépense.`,
            );
          }
        }
        const updated = await tx.expense.update({
          where: { id: expense.id },
          data:
            status === "APPROVED"
              ? {
                  status,
                  approvedById: ctx.membership.id,
                  approvedAt: org.now,
                  decisionComment: input.comment?.trim() || null,
                }
              : {
                  status,
                  rejectedById: ctx.membership.id,
                  rejectedAt: org.now,
                  decisionComment: input.comment!.trim(),
                },
        });
        await notify(tx, ctx.organizationId, [expense.createdById], {
          type: status === "APPROVED" ? "cash.expense_approved" : "cash.expense_rejected",
          title:
            status === "APPROVED"
              ? `Dépense validée : ${formatFCFA(expense.amount)}`
              : `Dépense refusée : ${formatFCFA(expense.amount)}`,
          body: input.comment?.trim() || expense.description,
          link: "/caisse",
          dedupeKey: `cash.expense_decided:${expense.id}`,
        });
        await audit(
          actorOf(ctx),
          status === "APPROVED" ? "cash.expense_approved" : "cash.expense_rejected",
          "Expense",
          expense.id,
          {
            siteId: expense.siteId,
            before: { status: expense.status },
            after: { status, amount: expense.amount },
            reason: input.comment?.trim() || null,
          },
        );
        return updated;
      });
    }),

  /** US-M08-12 — justificatif (photo ou PDF) d'une dépense de sa caisse encore ouverte. */
  uploadExpenseReceipt: requirePermission("cash:expense")
    .input(uploadExpenseReceiptInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const expense = await tenantDb.transaction((tx) => loadExpense(tx, ctx, input.expenseId));
      if (expense.cashSession?.closedAt)
        bad("Cette caisse est clôturée : la dépense n'est plus modifiable.");
      const body = Buffer.from(input.dataBase64, "base64");
      const ext = input.mimeType === "application/pdf" ? "pdf" : input.mimeType.split("/")[1];
      const key = `${ctx.organizationId}/expenses/${expense.id}/receipt-${randomUUID()}.${ext}`;
      try {
        await getAttachmentStorage().upload({
          key,
          body,
          contentType: input.mimeType,
          maxBytes: 10_000_000,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          String((error as { code: unknown }).code).startsWith("storage.")
        ) {
          bad(error.message);
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Envoi du justificatif impossible. Réessayez.",
        });
      }
      return tenantDb.transaction(async (tx) => {
        const attachment = await tx.attachment.create({
          data: {
            organizationId: ctx.organizationId,
            entity: "expense",
            entityId: expense.id,
            kind: "document",
            url: key,
            mimeType: input.mimeType,
            size: body.byteLength,
            createdById: ctx.membership.id,
          },
        });
        await tx.expense.update({
          where: { id: expense.id },
          data: { attachmentId: attachment.id },
        });
        await audit(actorOf(ctx), "cash.expense_receipt", "Expense", expense.id, {
          siteId: expense.siteId,
          after: { attachmentId: attachment.id },
        });
        return { attachmentId: attachment.id, url: `/api/attachments/${attachment.id}` };
      });
    }),

  /** /caisse/depenses — dépenses filtrées (statut, catégorie, période) + totaux par catégorie. */
  expenses: requirePermission("payment:read")
    .input(cashExpensesInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const paidAt = periodRange(input.from, input.to, org.timeZone);
      const base: Prisma.ExpenseWhereInput = {
        ...siteScope(ctx, input.siteId),
        ...(input.category ? { category: input.category } : {}),
        ...(paidAt ? { paidAt } : {}),
      };
      const where: Prisma.ExpenseWhereInput = {
        ...base,
        ...(input.status ? { status: input.status } : {}),
      };
      const [rows, totals, pendingCount] = await Promise.all([
        tenantDb.expense.findMany({
          where,
          orderBy: [{ paidAt: "desc" }, { id: "desc" }],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: {
            site: { select: { name: true } },
            cashSession: { select: { id: true, closedAt: true } },
            createdBy: memberName,
            approvedBy: memberName,
            rejectedBy: memberName,
          },
        }),
        tenantDb.expense.findMany({
          where: { ...base, status: input.status ?? "APPROVED" },
          select: { category: true, amount: true },
        }),
        tenantDb.expense.count({ where: { ...siteScope(ctx, input.siteId), status: "PENDING" } }),
      ]);
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        items: items.map((e) => ({
          id: e.id,
          site: e.site.name,
          sessionId: e.cashSession?.id ?? null,
          sessionClosed: Boolean(e.cashSession?.closedAt),
          category: e.category,
          amount: e.amount,
          description: e.description,
          paidAt: e.paidAt,
          status: e.status,
          createdByName: e.createdBy?.user.name ?? null,
          approvedByName: e.approvedBy?.user.name ?? null,
          rejectedByName: e.rejectedBy?.user.name ?? null,
          decisionComment: e.decisionComment,
          receiptUrl: e.attachmentId ? `/api/attachments/${e.attachmentId}` : null,
        })),
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
        byCategory: expensesByCategory(totals),
        total: totals.reduce((s, e) => s + e.amount, 0),
        totalStatus: input.status ?? "APPROVED",
        pendingCount,
        categories: org.settings.expenseCategories,
        timeZone: org.timeZone,
      };
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
            pendingExpenses: summary.pendingExpensesCount,
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
            closingSummary: toClosingSummary(
              session,
              summary,
              counted,
              result.difference,
            ) as unknown as Prisma.InputJsonValue,
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

  /**
   * /caisse/sessions — historique filtrable (période, statut, caissier), écarts, clôtures
   * tardives ; totaux de la sélection et écarts par caissier (M08 §11).
   */
  sessions: requirePermission("payment:read")
    .input(cashSessionsInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const openedAt = periodRange(input.from, input.to, org.timeZone);
      const statusWhere: Prisma.CashSessionWhereInput =
        input.status === "open"
          ? { closedAt: null }
          : input.status === "to_review"
            ? { closedAt: { not: null }, reviewedAt: null, difference: { not: 0 } }
            : input.status === "reviewed"
              ? { reviewedAt: { not: null } }
              : input.status === "variance"
                ? { closedAt: { not: null }, difference: { not: 0 } }
                : input.status === "late"
                  ? { lateClose: true }
                  : {};
      const base: Prisma.CashSessionWhereInput = {
        ...siteScope(ctx, input.siteId),
        ...(openedAt ? { openedAt } : {}),
        ...(input.openedById ? { openedById: input.openedById } : {}),
      };
      const where = { ...base, ...statusWhere };
      const [rows, stats, cashiers, toReview] = await Promise.all([
        tenantDb.cashSession.findMany({
          where,
          orderBy: [{ openedAt: "desc" }, { id: "desc" }],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: {
            site: { select: { name: true } },
            openedBy: memberName,
            closedBy: memberName,
            reviewedBy: memberName,
          },
        }),
        tenantDb.cashSession.findMany({
          where,
          select: {
            openedById: true,
            difference: true,
            closedAt: true,
            openedBy: memberName,
          },
        }),
        tenantDb.cashSession.findMany({
          where: siteScope(ctx, input.siteId),
          distinct: ["openedById"],
          select: { openedById: true, openedBy: memberName },
        }),
        tenantDb.cashSession.count({
          where: {
            ...siteScope(ctx, input.siteId),
            closedAt: { not: null },
            reviewedAt: null,
            difference: { not: 0 },
          },
        }),
      ]);
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const closed = stats.filter((s) => s.closedAt && s.difference !== null);
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
          reviewedBy: s.reviewedBy?.user.name ?? null,
          notes: s.notes,
          totalReceived: readClosingSummary(s.closingSummary)?.totalReceived ?? null,
        })),
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
        totals: {
          sessions: stats.length,
          closed: closed.length,
          withVariance: closed.filter((s) => s.difference !== 0).length,
          netDifference: closed.reduce((sum, s) => sum + (s.difference ?? 0), 0),
        },
        toReview,
        byCashier: varianceByCashier(
          stats.map((s) => ({
            cashierId: s.openedById,
            cashierName: s.openedBy.user.name,
            difference: s.difference,
            closedAt: s.closedAt,
          })),
        ),
        cashiers: cashiers
          .map((c) => ({ id: c.openedById, name: c.openedBy.user.name }))
          .sort((a, b) => a.name.localeCompare(b.name, "fr")),
        timeZone: org.timeZone,
      };
    }),

  /** /caisse/sessions/[id] — détail d'une session : journal, totaux par mode, Z figé. */
  session: requirePermission("payment:read")
    .input(cashSessionInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const session = await loadSession(tx, ctx, input.id);
        const [site, people, summary] = await Promise.all([
          tx.site.findFirstOrThrow({ where: { id: session.siteId }, select: { name: true } }),
          tx.cashSession.findFirstOrThrow({
            where: { id: session.id },
            select: { openedBy: memberName, closedBy: memberName, reviewedBy: memberName },
          }),
          sessionSummary(tx, session),
        ]);
        return {
          ...session,
          site: site.name,
          openedByName: people.openedBy.user.name,
          closedByName: people.closedBy?.user.name ?? null,
          reviewedByName: people.reviewedBy?.user.name ?? null,
          closing: readClosingSummary(session.closingSummary),
          summary,
          timeZone: org.timeZone,
        };
      });
    }),

  /** RG-M08-29/30 — réglages de caisse lus par l'écran Paramètres › Paiements. */
  settings: requirePermission("settings:read").query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { settings: true },
    });
    const s = billingSettingsFrom(org.settings);
    return {
      varianceAlert: s.varianceAlert,
      expenseApproval: s.expenseApproval,
      oneSessionPerSite: s.oneSessionPerSite,
      expenseCategories: s.expenseCategories,
    };
  }),

  updateSettings: requirePermission("settings:billing")
    .input(cashSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { settings: true },
      });
      const settings = (org.settings ?? {}) as Record<string, unknown>;
      const cash = (settings.cash ?? {}) as Record<string, unknown>;
      const before = billingSettingsFrom(org.settings);
      const after = {
        varianceAlert: input.varianceAlert,
        expenseApproval: input.expenseApproval,
        oneSessionPerSite: input.oneSessionPerSite,
        expenseCategories: input.expenseCategories.map((c) => c.trim()),
      };
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { settings: { ...settings, cash: { ...cash, ...after } } as Prisma.InputJsonValue },
      });
      await audit(actorOf(ctx), "settings.cash", "Organization", ctx.organizationId, {
        before: {
          varianceAlert: before.varianceAlert,
          expenseApproval: before.expenseApproval,
          oneSessionPerSite: before.oneSessionPerSite,
          expenseCategories: before.expenseCategories,
        },
        after,
      });
      return after;
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
