// M09 §8 — routeur `collections` : balance âgée, dossiers, promesses, appels, litiges,
// pauses, escalade, pertes, contrôle du crédit, relevé de compte. Toute la logique de
// décision est dans `@atelieros/core` (receivables) ; ici on orchestre (forTenant + permissions).
import { TRPCError } from "@trpc/server";
import {
  addDays,
  ageBucket,
  agingSummary,
  buildStatement,
  creditCheck,
  customerExposure,
  daysOverdue,
  diffDays,
  isUnreachable,
  MAX_PAUSE_DAYS,
  OPEN_INVOICE_STATUSES,
  promisePausedUntil,
  statusAfterResume,
  validatePromiseInstallments,
  type AgingInvoice,
} from "@atelieros/core";
import { db, syncCustomerReceivables, type Prisma, type ScopedTenantClient } from "@atelieros/db";
import {
  addNoteInputSchema,
  addPromiseInputSchema,
  agingSummaryInputSchema,
  assignCaseInputSchema,
  cancelPromiseInputSchema,
  caseIdInputSchema,
  creditCheckInputSchema,
  escalateCaseInputSchema,
  listCasesInputSchema,
  listInvoicesInputSchema,
  logCallInputSchema,
  openDisputeInputSchema,
  pauseCaseInputSchema,
  resolveDisputeInputSchema,
  reverseWriteOffInputSchema,
  setCreditLimitInputSchema,
  statementInputSchema,
  writeOffInputSchema,
} from "@atelieros/validators";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { emitDomainEvent } from "../events/emit";
import {
  isoToDate,
  loadOrgCollectionContext,
  notFound,
  rethrowDomain,
} from "../receivables/helpers";
import { requirePermission, router } from "../trpc";

const ACTIVE_STATUSES = ["OPEN", "PROMISED", "PAUSED", "DISPUTED", "ESCALATED"] as const;
const CANCELLABLE_REMINDERS = ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] as const;

type Scoped = ScopedTenantClient;

async function getActiveCase(tx: Scoped, caseId: string) {
  const kase = await tx.collectionCase.findFirst({ where: { id: caseId } });
  if (!kase) notFound();
  return kase;
}

async function cancelPendingReceivableReminders(tx: Scoped, customerId: string, reason: string) {
  await tx.reminder.updateMany({
    where: { customerId, type: "RECEIVABLE", status: { in: [...CANCELLABLE_REMINDERS] } },
    data: { status: "CANCELLED", skippedReason: reason },
  });
}

function tabWhere(tab: string): Prisma.CollectionCaseWhereInput {
  switch (tab) {
    case "TO_HANDLE":
      return {
        OR: [
          { status: "ESCALATED" },
          { unreachableCount: { gte: 3 } },
          { status: "OPEN", brokenPromiseCount: { gt: 0 } },
        ],
      };
    case "PROMISES":
      return { status: "PROMISED" };
    case "DISPUTES":
      return { status: "DISPUTED" };
    case "WRITTEN_OFF":
      return { status: "CLOSED_WRITTEN_OFF" };
    default:
      return { status: { in: [...ACTIVE_STATUSES] } };
  }
}

export const collectionsRouter = router({
  agingSummary: requirePermission("receivable:read")
    .input(agingSummaryInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      const asOf = input.asOf ? isoToDate(input.asOf) : org.today;
      const customerFilter = input.customerType ? { customer: { type: input.customerType } } : {};
      const siteFilter = input.siteId ? { siteId: input.siteId } : {};
      const [invoices, credits, recovered, lastImport] = await Promise.all([
        tenantDb.invoice.findMany({
          where: {
            billTo: "CUSTOMER",
            status: { in: [...OPEN_INVOICE_STATUSES] },
            ...customerFilter,
            ...siteFilter,
          },
          select: {
            id: true,
            customerId: true,
            type: true,
            status: true,
            billTo: true,
            balance: true,
            dueDate: true,
          },
        }),
        tenantDb.payment.aggregate({
          where: { unallocated: { gt: 0 }, status: "CONFIRMED", ...siteFilter },
          _sum: { unallocated: true },
        }),
        recoveredThisMonth(tenantDb, org.now),
        tenantDb.invoice.findFirst({
          where: { origin: "IMPORTED" },
          orderBy: { updatedAt: "desc" },
          select: { updatedAt: true },
        }),
      ]);
      const summary = agingSummary({
        invoices: invoices as AgingInvoice[],
        unallocatedCredits: [credits._sum.unallocated ?? 0],
        asOf,
      });
      return {
        ...summary,
        asOf: asOf.toISOString().slice(0, 10),
        recoveredThisMonth: recovered,
        // M09 §11 : en mode REMINDERS_ONLY, bandeau « Soldes du … ».
        importedBalancesAt:
          org.operatingMode === "REMINDERS_ONLY" ? (lastImport?.updatedAt ?? null) : null,
      };
    }),

  listCases: requirePermission("receivable:read")
    .input(listCasesInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      const where: Prisma.CollectionCaseWhereInput = {
        AND: [
          tabWhere(input.tab),
          input.search
            ? { customer: { displayName: { contains: input.search, mode: "insensitive" } } }
            : {},
          input.bucket ? bucketCaseWhere(input.bucket) : {},
        ],
      };
      const rows = await tenantDb.collectionCase.findMany({
        where,
        orderBy: [{ overdueDue: "desc" }, { id: "asc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          customer: {
            select: {
              id: true,
              displayName: true,
              type: true,
              phone: true,
              riskScore: true,
              creditHold: true,
            },
          },
          promises: { where: { status: "PENDING" }, orderBy: { promisedDate: "asc" }, take: 1 },
        },
      });
      const hasMore = rows.length > input.limit;
      const items = rows.slice(0, input.limit).map((c) => ({
        id: c.id,
        status: c.status,
        stage: c.stage,
        customer: c.customer,
        totalDue: c.totalDue,
        overdueDue: c.overdueDue,
        maxDaysOverdue: c.oldestDueDate
          ? daysOverdue(c.oldestDueDate, org.today)
          : c.maxDaysOverdue,
        lastContactAt: c.lastContactAt,
        nextActionAt: c.nextActionAt,
        nextPromise: c.promises[0] ?? null,
        unreachable: isUnreachable(c.unreachableCount),
        brokenPromiseCount: c.brokenPromiseCount,
      }));
      return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
    }),

  listInvoices: requirePermission("receivable:read")
    .input(listInvoicesInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      const rows = await tenantDb.invoice.findMany({
        where: {
          billTo: "CUSTOMER",
          type: { in: ["INVOICE", "DEPOSIT"] },
          status: input.status ? input.status : { in: [...OPEN_INVOICE_STATUSES] },
          ...(input.customerId ? { customerId: input.customerId } : {}),
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: { customer: { select: { id: true, displayName: true, type: true } } },
      });
      const mapped = rows.map((i) => {
        const days = daysOverdue(i.dueDate, org.today);
        return {
          id: i.id,
          number: i.number,
          customer: i.customer,
          issuedAt: i.issuedAt,
          dueDate: i.dueDate,
          total: i.total,
          amountPaid: i.amountPaid,
          balance: i.balance,
          status: i.status,
          daysOverdue: days,
          bucket: ageBucket(days),
          fneNumber: i.fneNumber,
          writtenOffAt: i.writtenOffAt,
        };
      });
      const filtered = input.bucket ? mapped.filter((i) => i.bucket === input.bucket) : mapped;
      const hasMore = rows.length > input.limit;
      return {
        items: filtered.slice(0, input.limit),
        nextCursor: hasMore ? rows[input.limit - 1]!.id : null,
      };
    }),

  getCase: requirePermission("receivable:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      const kase = await tenantDb.collectionCase.findFirst({
        where: { id: input.id },
        include: {
          customer: {
            include: { contacts: { where: { receivesInvoices: true } } },
          },
          assignedTo: { select: { id: true, user: { select: { name: true } } } },
          promises: { orderBy: { promisedDate: "asc" } },
          notes: {
            orderBy: { createdAt: "desc" },
            include: { createdBy: { select: { user: { select: { name: true } } } } },
          },
        },
      });
      if (!kase) notFound();
      const [invoices, payments, reminders] = await Promise.all([
        tenantDb.invoice.findMany({
          where: {
            customerId: kase.customerId,
            billTo: "CUSTOMER",
            type: { in: ["INVOICE", "DEPOSIT"] },
            OR: [{ status: { in: [...OPEN_INVOICE_STATUSES] } }, { collectionCaseId: kase.id }],
          },
          orderBy: { dueDate: "asc" },
        }),
        tenantDb.payment.findMany({
          where: { customerId: kase.customerId, receivedAt: { gte: addDays(kase.createdAt, -1) } },
          orderBy: { receivedAt: "desc" },
          include: { allocations: { select: { invoiceId: true, amount: true } } },
        }),
        tenantDb.reminder.findMany({
          where: {
            customerId: kase.customerId,
            type: "RECEIVABLE",
            createdAt: { gte: addDays(kase.createdAt, -1) },
          },
          orderBy: { dueDate: "asc" },
          select: {
            id: true,
            stepKey: true,
            status: true,
            scheduledFor: true,
            sentAt: true,
            dueDate: true,
            skippedReason: true,
          },
        }),
      ]);
      const exposure = customerExposure(invoices as unknown as AgingInvoice[], org.today);
      const credit = creditCheck({
        totalDue: exposure.totalDue,
        overdueDue: exposure.overdueDue,
        maxDaysOverdue: exposure.maxDaysOverdue,
        creditLimit: kase.customer.creditLimit,
        creditHold: kase.customer.creditHold,
        caseEscalated: kase.status === "ESCALATED",
        blockAfterDays: org.settings.blockAfterDays,
      });
      return {
        case: { ...kase, unreachable: isUnreachable(kase.unreachableCount) },
        invoices: invoices.map((i) => ({
          ...i,
          daysOverdue: daysOverdue(i.dueDate, org.today),
          bucket: ageBucket(daysOverdue(i.dueDate, org.today)),
        })),
        payments,
        reminders,
        exposure,
        credit,
        today: org.today.toISOString().slice(0, 10),
      };
    }),

  addPromise: requirePermission("receivable:manage")
    .input(addPromiseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      const installments = input.installments.map((i) => ({
        amount: i.amount,
        date: isoToDate(i.date),
      }));
      return tenantDb.transaction(async (tx) => {
        const kase = await getActiveCase(tx, input.caseId);
        if (
          !ACTIVE_STATUSES.includes(kase.status as (typeof ACTIVE_STATUSES)[number]) ||
          kase.status === "DISPUTED"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ce dossier n'accepte pas de promesse dans son état actuel.",
          });
        }
        try {
          validatePromiseInstallments(installments, kase.overdueDue, org.today);
        } catch (error) {
          rethrowDomain(error);
        }
        const lastSent = await tx.reminder.findFirst({
          where: { customerId: kase.customerId, type: "RECEIVABLE", sentAt: { not: null } },
          orderBy: { sentAt: "desc" },
          select: { id: true },
        });
        const created = [];
        for (const i of installments) {
          created.push(
            await tx.paymentPromise.create({
              data: {
                organizationId: ctx.organizationId,
                collectionCaseId: kase.id,
                amount: i.amount,
                promisedDate: i.date,
                channel: input.channel,
                createdById: ctx.membership.id,
                reminderId: lastSent?.id ?? null,
                createdAt: org.now,
              },
            }),
          );
        }
        const pausedUntil = promisePausedUntil(installments, org.settings.graceDays);
        await tx.collectionCase.update({
          where: { id: kase.id },
          data: {
            status: "PROMISED",
            previousStatus: kase.status === "PROMISED" ? kase.previousStatus : kase.status,
            pausedUntil,
            nextActionAt: new Date(`${pausedUntil.toISOString().slice(0, 10)}T09:00:00.000Z`),
            lastContactAt: org.now,
          },
        });
        if (input.note) {
          await tx.collectionNote.create({
            data: {
              organizationId: ctx.organizationId,
              collectionCaseId: kase.id,
              body: input.note,
              type: "note",
              createdById: ctx.membership.id,
            },
          });
        }
        await cancelPendingReceivableReminders(
          tx,
          kase.customerId,
          "Promesse de paiement enregistrée.",
        );
        if (lastSent) {
          await tx.reminder.update({ where: { id: lastSent.id }, data: { outcome: "PROMISED" } });
        }
        await emitDomainEvent(tx as never, ctx.organizationId, "collection.promised", {
          caseId: kase.id,
          customerId: kase.customerId,
        });
        return created;
      });
    }),

  cancelPromise: requirePermission("receivable:manage")
    .input(cancelPromiseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const promise = await tx.paymentPromise.findFirst({ where: { id: input.promiseId } });
        if (!promise) notFound("Promesse introuvable.");
        if (promise.status !== "PENDING") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Seule une promesse en attente peut être annulée.",
          });
        }
        const updated = await tx.paymentPromise.update({
          where: { id: promise.id },
          data: { status: "CANCELLED", cancelledReason: input.reason },
        });
        const pending = await tx.paymentPromise.count({
          where: { collectionCaseId: promise.collectionCaseId, status: "PENDING" },
        });
        if (pending === 0) {
          const kase = await getActiveCase(tx, promise.collectionCaseId);
          if (kase.status === "PROMISED") {
            await tx.collectionCase.update({
              where: { id: kase.id },
              data: {
                status: statusAfterResume({
                  previousStatus: kase.previousStatus,
                  escalatedAt: kase.escalatedAt,
                }),
                pausedUntil: null,
                previousStatus: null,
              },
            });
          }
        }
        return updated;
      });
    }),

  logCall: requirePermission("receivable:manage")
    .input(logCallInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      return tenantDb.transaction(async (tx) => {
        const kase = await getActiveCase(tx, input.caseId);
        const labels = {
          REACHED: "Joint",
          NO_ANSWER: "Pas de réponse",
          WRONG_NUMBER: "Numéro erroné",
          CALLBACK: "Rappeler plus tard",
        } as const;
        const note = await tx.collectionNote.create({
          data: {
            organizationId: ctx.organizationId,
            collectionCaseId: kase.id,
            type: "call",
            callOutcome: input.outcome,
            callbackAt: input.callbackAt ?? null,
            body: input.note ? `${labels[input.outcome]} — ${input.note}` : labels[input.outcome],
            createdById: ctx.membership.id,
          },
        });
        await tx.collectionCase.update({
          where: { id: kase.id },
          data: {
            unreachableCount: input.outcome === "NO_ANSWER" ? kase.unreachableCount + 1 : 0,
            ...(input.outcome === "REACHED" ? { lastContactAt: org.now } : {}),
            ...(input.callbackAt ? { nextActionAt: input.callbackAt } : {}),
          },
        });
        return note;
      });
    }),

  addNote: requirePermission("receivable:manage")
    .input(addNoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const kase = await tenantDb.collectionCase.findFirst({ where: { id: input.caseId } });
      if (!kase) notFound();
      return tenantDb.collectionNote.create({
        data: {
          organizationId: ctx.organizationId,
          collectionCaseId: kase.id,
          body: input.body,
          type: input.type,
          createdById: ctx.membership.id,
        },
      });
    }),

  openDispute: requirePermission("receivable:manage")
    .input(openDisputeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      return tenantDb.transaction(async (tx) => {
        const kase = await getActiveCase(tx, input.caseId);
        if (!ACTIVE_STATUSES.includes(kase.status as (typeof ACTIVE_STATUSES)[number])) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ce dossier est clos." });
        }
        const invoices = await tx.invoice.findMany({
          where: {
            id: { in: input.invoiceIds },
            customerId: kase.customerId,
            status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
          },
        });
        if (invoices.length !== input.invoiceIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Une des factures sélectionnées n'est pas contestable.",
          });
        }
        const disputedAmount = input.disputedAmount ?? invoices.reduce((s, i) => s + i.balance, 0);
        await tx.invoice.updateMany({
          where: { id: { in: input.invoiceIds } },
          data: { status: "DISPUTED", disputedAt: org.now, collectionCaseId: kase.id },
        });
        const updated = await tx.collectionCase.update({
          where: { id: kase.id },
          data: {
            status: "DISPUTED",
            previousStatus: kase.status === "DISPUTED" ? kase.previousStatus : kase.status,
            disputeOpenedAt: org.now,
            disputeReason: input.reason,
            disputedAmount,
          },
        });
        await cancelPendingReceivableReminders(tx, kase.customerId, "Litige en cours.");
        await emitDomainEvent(tx as never, ctx.organizationId, "collection.disputed", {
          caseId: kase.id,
          customerId: kase.customerId,
        });
        return updated;
      });
    }),

  resolveDispute: requirePermission("receivable:dispute")
    .input(resolveDisputeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      if (input.resolution === "WRITE_OFF" && !ctx.permissions.has("receivable:writeoff")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Seul le gérant peut passer une créance en perte.",
        });
      }
      const result = await tenantDb.transaction(async (tx) => {
        const kase = await getActiveCase(tx, input.caseId);
        if (kase.status !== "DISPUTED") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ce dossier n'est pas en litige." });
        }
        const disputed = await tx.invoice.findMany({
          where: { customerId: kase.customerId, status: "DISPUTED" },
        });
        for (const invoice of disputed) {
          if (input.resolution === "WRITE_OFF") {
            await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                status: "WRITTEN_OFF",
                writtenOffAmount: invoice.balance,
                writtenOffAt: org.now,
                writtenOffById: ctx.membership.id,
                writeOffReason: input.note,
              },
            });
          } else {
            await tx.invoice.update({
              where: { id: invoice.id },
              data: { status: invoice.balance === 0 ? "PAID" : "OVERDUE", disputedAt: null },
            });
          }
        }
        // RG-M09-08 : séquence reprise au palier suivant, mais pas avant 7 jours.
        const resumeAt = addDays(org.today, 7);
        const updated = await tx.collectionCase.update({
          where: { id: kase.id },
          data: {
            status: "PAUSED",
            previousStatus: kase.escalatedAt ? "ESCALATED" : "OPEN",
            pausedUntil: resumeAt,
            disputeOpenedAt: null,
          },
        });
        await tx.collectionNote.create({
          data: {
            organizationId: ctx.organizationId,
            collectionCaseId: kase.id,
            type: "note",
            body: `Litige résolu (${input.resolution}) : ${input.note}`,
            createdById: ctx.membership.id,
          },
        });
        await syncCustomerReceivables(tx, {
          organizationId: ctx.organizationId,
          customerId: kase.customerId,
          today: org.today,
          now: org.now,
          settings: org.settings,
        });
        return { updated, writtenOff: input.resolution === "WRITE_OFF" ? disputed : [] };
      });
      for (const invoice of result.writtenOff) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "receivable.writeoff",
          entity: "Invoice",
          entityId: invoice.id,
          before: { status: invoice.status, balance: invoice.balance },
          after: { status: "WRITTEN_OFF", writtenOffAmount: invoice.balance },
          reason: input.note,
          ip: ctx.ip,
        });
      }
      return result.updated;
    }),

  pause: requirePermission("receivable:manage")
    .input(pauseCaseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      const until = isoToDate(input.until);
      const delta = diffDays(until, org.today);
      if (delta < 1 || delta > MAX_PAUSE_DAYS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La pause doit finir entre demain et dans 30 jours.",
        });
      }
      return tenantDb.transaction(async (tx) => {
        const kase = await getActiveCase(tx, input.caseId);
        if (!["OPEN", "PROMISED", "ESCALATED"].includes(kase.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ce dossier ne peut pas être mis en pause.",
          });
        }
        const updated = await tx.collectionCase.update({
          where: { id: kase.id },
          data: {
            status: "PAUSED",
            previousStatus: kase.status,
            pausedUntil: until,
            nextActionAt: until,
          },
        });
        await tx.collectionNote.create({
          data: {
            organizationId: ctx.organizationId,
            collectionCaseId: kase.id,
            type: "note",
            body: `Pause jusqu'au ${input.until} : ${input.reason}`,
            createdById: ctx.membership.id,
          },
        });
        await cancelPendingReceivableReminders(tx, kase.customerId, "Dossier en pause.");
        await emitDomainEvent(tx as never, ctx.organizationId, "collection.paused", {
          caseId: kase.id,
          customerId: kase.customerId,
        });
        return updated;
      });
    }),

  resume: requirePermission("receivable:manage")
    .input(caseIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const kase = await getActiveCase(tx, input.caseId);
        if (kase.status !== "PAUSED") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ce dossier n'est pas en pause." });
        }
        return tx.collectionCase.update({
          where: { id: kase.id },
          data: {
            status: statusAfterResume({
              previousStatus: kase.previousStatus,
              escalatedAt: kase.escalatedAt,
            }),
            pausedUntil: null,
            previousStatus: null,
          },
        });
      });
    }),

  escalate: requirePermission("receivable:manage")
    .input(escalateCaseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      return tenantDb.transaction(async (tx) => {
        const kase = await getActiveCase(tx, input.caseId);
        if (!["OPEN", "PROMISED"].includes(kase.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Seul un dossier ouvert ou en promesse peut être escaladé.",
          });
        }
        if (input.note) {
          await tx.collectionNote.create({
            data: {
              organizationId: ctx.organizationId,
              collectionCaseId: kase.id,
              type: "note",
              body: `Escalade : ${input.note}`,
              createdById: ctx.membership.id,
            },
          });
        }
        return tx.collectionCase.update({
          where: { id: kase.id },
          data: { status: "ESCALATED", escalatedAt: org.now },
        });
      });
    }),

  assign: requirePermission("receivable:manage")
    .input(assignCaseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const kase = await tenantDb.collectionCase.findFirst({ where: { id: input.caseId } });
      if (!kase) notFound();
      if (input.membershipId) {
        const member = await tenantDb.membership.findFirst({ where: { id: input.membershipId } });
        if (!member) notFound("Membre introuvable.");
      }
      return tenantDb.collectionCase.update({
        where: { id: kase.id },
        data: { assignedToId: input.membershipId },
      });
    }),

  writeOff: requirePermission("receivable:writeoff")
    .input(writeOffInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      const invoices = await tenantDb.transaction(async (tx) => {
        const rows = await tx.invoice.findMany({ where: { id: { in: input.invoiceIds } } });
        if (rows.length !== input.invoiceIds.length) notFound("Facture introuvable.");
        const total = rows.reduce((s, i) => s + i.balance, 0);
        for (const invoice of rows) {
          if (invoice.status === "DISPUTED") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Facture en litige : utilisez « Résolu — passage en perte ».",
            });
          }
          if (
            !["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status) ||
            invoice.balance <= 0
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `La facture ${invoice.number ?? ""} n'a pas de solde à passer en perte.`,
            });
          }
          // RG-M09-13 : ≥ writeOffMinDays de retard, sinon confirmation renforcée (saisie du montant).
          if (
            daysOverdue(invoice.dueDate, org.today) < org.settings.writeOffMinDays &&
            input.confirmAmount !== total
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Retard inférieur à ${org.settings.writeOffMinDays} jours : saisissez le montant total (${total}) pour confirmer.`,
            });
          }
        }
        const customerIds = new Set<string>();
        for (const invoice of rows) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              status: "WRITTEN_OFF",
              writtenOffAmount: invoice.balance,
              writtenOffAt: org.now,
              writtenOffById: ctx.membership.id,
              writeOffReason: input.reason,
            },
          });
          customerIds.add(invoice.customerId);
        }
        for (const customerId of customerIds) {
          await syncCustomerReceivables(tx, {
            organizationId: ctx.organizationId,
            customerId,
            today: org.today,
            now: org.now,
            settings: org.settings,
          });
        }
        return rows;
      });
      for (const invoice of invoices) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "receivable.writeoff",
          entity: "Invoice",
          entityId: invoice.id,
          before: { status: invoice.status, balance: invoice.balance },
          after: { status: "WRITTEN_OFF", writtenOffAmount: invoice.balance },
          reason: input.reason,
          ip: ctx.ip,
        });
      }
      return invoices.map((i) => ({ id: i.id, status: "WRITTEN_OFF" as const }));
    }),

  reverseWriteOff: requirePermission("receivable:writeoff")
    .input(reverseWriteOffInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      const invoice = await tenantDb.transaction(async (tx) => {
        const row = await tx.invoice.findFirst({ where: { id: input.invoiceId } });
        if (!row) notFound("Facture introuvable.");
        if (row.status !== "WRITTEN_OFF") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cette facture n'est pas passée en perte.",
          });
        }
        const updated = await tx.invoice.update({
          where: { id: row.id },
          data: {
            status: "OVERDUE",
            writtenOffAmount: null,
            writtenOffAt: null,
            writtenOffById: null,
            writeOffReason: null,
          },
        });
        await syncCustomerReceivables(tx, {
          organizationId: ctx.organizationId,
          customerId: row.customerId,
          today: org.today,
          now: org.now,
          settings: org.settings,
        });
        return updated;
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "receivable.writeoff_reversed",
        entity: "Invoice",
        entityId: invoice.id,
        before: { status: "WRITTEN_OFF" },
        after: { status: invoice.status },
        reason: input.reason,
        ip: ctx.ip,
      });
      return invoice;
    }),

  creditCheck: requirePermission("receivable:read")
    .input(creditCheckInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      const customer = await tenantDb.customer.findFirst({ where: { id: input.customerId } });
      if (!customer) notFound("Client introuvable.");
      const [invoices, kase] = await Promise.all([
        tenantDb.invoice.findMany({
          where: {
            customerId: customer.id,
            billTo: "CUSTOMER",
            status: { in: [...OPEN_INVOICE_STATUSES] },
          },
          select: {
            id: true,
            customerId: true,
            type: true,
            status: true,
            billTo: true,
            balance: true,
            dueDate: true,
          },
        }),
        tenantDb.collectionCase.findFirst({
          where: { customerId: customer.id, status: { in: [...ACTIVE_STATUSES] } },
        }),
      ]);
      const exposure = customerExposure(invoices as AgingInvoice[], org.today);
      const result = creditCheck({
        totalDue: exposure.totalDue,
        overdueDue: exposure.overdueDue,
        maxDaysOverdue: exposure.maxDaysOverdue,
        creditLimit: customer.creditLimit,
        creditHold: customer.creditHold,
        caseEscalated: kase?.status === "ESCALATED" || Boolean(kase?.escalatedAt),
        additionalAmount: input.additionalAmount,
        blockAfterDays: org.settings.blockAfterDays,
      });
      return {
        ...result,
        overdueDue: exposure.overdueDue,
        maxDaysOverdue: exposure.maxDaysOverdue,
        creditLimit: customer.creditLimit,
      };
    }),

  setCreditLimit: requirePermission("receivable:manage")
    .input(setCreditLimitInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const customer = await tenantDb.customer.findFirst({ where: { id: input.customerId } });
      if (!customer) notFound("Client introuvable.");
      const updated = await tenantDb.customer.update({
        where: { id: customer.id },
        data: {
          creditLimit: input.creditLimit,
          ...(input.paymentTermsDays !== undefined
            ? { paymentTermsDays: input.paymentTermsDays }
            : {}),
          ...(input.creditHold !== undefined
            ? {
                creditHold: input.creditHold,
                creditHoldReason: input.creditHold ? "Décision manuelle" : null,
              }
            : {}),
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "customer.credit_limit_changed",
        entity: "Customer",
        entityId: customer.id,
        before: {
          creditLimit: customer.creditLimit,
          paymentTermsDays: customer.paymentTermsDays,
          creditHold: customer.creditHold,
        },
        after: {
          creditLimit: updated.creditLimit,
          paymentTermsDays: updated.paymentTermsDays,
          creditHold: updated.creditHold,
        },
        ip: ctx.ip,
      });
      return updated;
    }),

  statement: requirePermission("receivable:read")
    .input(statementInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      return buildCustomerStatement(
        tenantDb,
        input.customerId,
        isoToDate(input.from),
        isoToDate(input.to),
        org.today,
      );
    }),
});

function bucketCaseWhere(bucket: string): Prisma.CollectionCaseWhereInput {
  // Approximation serveur : filtre sur le retard maximal du dossier (recalculé chaque nuit).
  switch (bucket) {
    case "b0_30":
      return { maxDaysOverdue: { gte: 1, lte: 30 } };
    case "b31_60":
      return { maxDaysOverdue: { gte: 31, lte: 60 } };
    case "b61_90":
      return { maxDaysOverdue: { gte: 61, lte: 90 } };
    case "b90p":
      return { maxDaysOverdue: { gt: 90 } };
    default:
      return { overdueDue: 0 };
  }
}

async function recoveredThisMonth(tenantDb: ReturnType<typeof db.forTenant>, now: Date) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await tenantDb.paymentAttribution.groupBy({
    by: ["source"],
    where: { createdAt: { gte: monthStart } },
    _sum: { amount: true },
  });
  const bySource = Object.fromEntries(rows.map((r) => [r.source, r._sum.amount ?? 0]));
  const reminders = bySource.reminder ?? 0;
  const calls = bySource.call ?? 0;
  const spontaneous = bySource.spontaneous ?? 0;
  return { total: reminders + calls + spontaneous, reminders, calls, spontaneous };
}

/** RG-M09-15 — données du relevé (réutilisées par la route PDF). */
export async function buildCustomerStatement(
  tenantDb: ReturnType<typeof db.forTenant>,
  customerId: string,
  from: Date,
  to: Date,
  today: Date,
) {
  const customer = await tenantDb.customer.findFirst({ where: { id: customerId } });
  if (!customer) notFound("Client introuvable.");
  const endOfTo = addDays(to, 1);
  const [invoices, payments] = await Promise.all([
    tenantDb.invoice.findMany({
      where: {
        customerId,
        billTo: "CUSTOMER",
        status: { notIn: ["DRAFT", "VOID"] },
        issuedAt: { lt: endOfTo },
      },
      orderBy: { issuedAt: "asc" },
    }),
    tenantDb.payment.findMany({
      where: { customerId, status: "CONFIRMED", receivedAt: { lt: endOfTo } },
      orderBy: { receivedAt: "asc" },
    }),
  ]);
  const methodLabels: Record<string, string> = {
    CASH: "Espèces",
    WAVE: "Wave",
    ORANGE_MONEY: "Orange Money",
    MTN_MOMO: "MTN MoMo",
    MOOV_MONEY: "Moov Money",
    BANK_TRANSFER: "Virement",
    CHEQUE: "Chèque",
    CARD: "Carte",
    INSURANCE: "Assurance",
    OTHER: "Autre",
  };
  const statement = buildStatement(
    [
      ...invoices.map((i) => ({
        date: i.issuedAt!,
        kind: i.type === "CREDIT_NOTE" ? ("credit_note" as const) : ("invoice" as const),
        reference: i.number ?? "—",
        label:
          i.type === "CREDIT_NOTE"
            ? "Avoir"
            : `Facture${i.fneNumber ? ` (FNE ${i.fneNumber})` : ""}`,
        amount: i.total,
      })),
      ...invoices
        .filter((i) => i.status === "WRITTEN_OFF" && i.writtenOffAt)
        .map((i) => ({
          date: i.writtenOffAt!,
          kind: "credit_note" as const,
          reference: i.number ?? "—",
          label: "Passage en perte",
          amount: i.writtenOffAmount ?? 0,
        })),
      ...payments.map((p) => ({
        date: p.receivedAt,
        kind: "payment" as const,
        reference: p.number,
        label: `Paiement ${methodLabels[p.method] ?? p.method}${p.reference ? ` — réf. ${p.reference}` : ""}`,
        amount: p.amount,
      })),
    ],
    from,
    endOfTo,
  );
  const open = invoices.filter(
    (i) =>
      (OPEN_INVOICE_STATUSES as readonly string[]).includes(i.status) &&
      i.balance > 0 &&
      i.type !== "CREDIT_NOTE",
  );
  const aging = agingSummary({ invoices: open as unknown as AgingInvoice[], asOf: today });
  return {
    customer: {
      id: customer.id,
      displayName: customer.displayName,
      ncc: customer.ncc,
      type: customer.type,
      address: customer.address,
      phone: customer.phone,
    },
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    ...statement,
    aging,
    openInvoices: open.map((i) => ({
      id: i.id,
      number: i.number,
      fneNumber: i.fneNumber,
      issuedAt: i.issuedAt,
      dueDate: i.dueDate,
      total: i.total,
      balance: i.balance,
      daysOverdue: daysOverdue(i.dueDate, today),
    })),
  };
}
