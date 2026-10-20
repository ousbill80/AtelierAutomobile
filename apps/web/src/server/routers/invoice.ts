// M08 §8 — factures : brouillons (OR, devis, vente comptoir, acompte), émission sans trou,
// avoirs, échéance, liste et détail, envoi au client (4.3). FNE : routeur `fne` ; liens de
// paiement : routeur `paymentLink`.
import { TRPCError } from "@trpc/server";
import {
  buildDepositLine,
  computeDraftTotals,
  splitRepairOrderLines,
  type RepairOrderLineForInvoice,
} from "@atelieros/core";
import { db, type Prisma } from "@atelieros/db";
import {
  createDepositInputSchema,
  createDirectInvoiceInputSchema,
  createFromQuoteInputSchema,
  createFromRepairOrderInputSchema,
  creditNoteInputSchema,
  invoiceIdInputSchema,
  invoiceListInputSchema,
  issueInvoiceInputSchema,
  previewInvoiceInputSchema,
  sendInvoiceInputSchema,
  updateDueDateInputSchema,
  updateInvoiceInputSchema,
} from "@atelieros/validators";
import { z } from "zod";
import { actorOf, draftLinesFromInput, resolveSiteId, type OrgCtx } from "../billing/context";
import { createDraftFromQuote } from "../billing/fromQuote";
import {
  assertBillingModule,
  audit,
  bad,
  createCreditNote,
  createDraft,
  guard,
  invoiceNotFound,
  issueInvoice,
  lineCreateData,
  loadOrgBillingContext,
  persistTotals,
  recomputeInvoiceBalance,
  syncReceivables,
  type Tx,
} from "../billing/service";
import { enqueueFneCertifyJob } from "../billing/fneQueue";
import { issueInvoicePortalLink } from "../billing/paymentLinks";
import { sendInvoice } from "../billing/send";
import { requirePermission, requireSite, router } from "../trpc";

const OPEN = ["ISSUED", "PARTIALLY_PAID", "OVERDUE", "DISPUTED"] as const;

async function loadInvoice(tx: Tx, ctx: OrgCtx, id: string) {
  const invoice = await tx.invoice.findFirst({ where: { id } });
  if (!invoice) invoiceNotFound();
  requireSite(ctx, invoice.siteId);
  return invoice;
}

/** Client « Comptoir » générique (US-M08-02, `settings.billing.allowWalkIn`). */
async function walkInCustomer(tx: Tx, organizationId: string) {
  const existing = await tx.customer.findFirst({
    where: { source: "comptoir", displayName: "Client comptoir", deletedAt: null },
  });
  if (existing) return existing;
  return tx.customer.create({
    data: {
      organizationId,
      displayName: "Client comptoir",
      companyName: "Client comptoir",
      source: "comptoir",
      remindersConsent: false,
    },
  });
}

function listWhere(input: z.infer<typeof invoiceListInputSchema>, ctx: OrgCtx) {
  const and: Prisma.InvoiceWhereInput[] = [];
  if (ctx.allowedSiteIds !== "ALL") and.push({ siteId: { in: ctx.allowedSiteIds } });
  if (input.siteId) and.push({ siteId: input.siteId });
  if (input.status) and.push({ status: input.status });
  if (input.customerId) and.push({ customerId: input.customerId });
  if (input.repairOrderId) and.push({ repairOrderId: input.repairOrderId });
  switch (input.view) {
    case "drafts":
      and.push({ status: "DRAFT" });
      break;
    case "open":
      and.push({ status: { in: [...OPEN] }, type: { not: "CREDIT_NOTE" } });
      break;
    case "paid":
      and.push({ status: "PAID" });
      break;
    case "fne_pending":
      and.push({ status: { not: "DRAFT" }, fneStatus: { in: ["PENDING", "FAILED"] } });
      break;
    case "credit_notes":
      and.push({ type: "CREDIT_NOTE" });
      break;
  }
  if (input.from) and.push({ issuedAt: { gte: new Date(`${input.from}T00:00:00.000Z`) } });
  if (input.to) and.push({ issuedAt: { lt: new Date(`${input.to}T23:59:59.999Z`) } });
  if (input.q) {
    const q = input.q;
    const compact = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
    and.push({
      OR: [
        { number: { contains: q, mode: "insensitive" } },
        { customer: { displayName: { contains: q, mode: "insensitive" } } },
        ...(compact ? [{ vehicle: { plateCompact: { contains: compact } } }] : []),
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export const invoiceRouter = router({
  /** US-M08-01 — « Facturer » un OR prêt ou restitué : brouillon client (+ assurance). */
  createFromRepairOrder: requirePermission("invoice:create")
    .input(createFromRepairOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      assertBillingModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const order = await tx.repairOrder.findFirst({
          where: { id: input.repairOrderId, deletedAt: null },
        });
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "OR introuvable." });
        requireSite(ctx, order.siteId);
        if (!["READY", "DELIVERED", "INVOICED"].includes(order.status)) {
          bad("L'OR doit être prêt (READY) ou restitué pour être facturé.");
        }
        const existing = await tx.invoice.findMany({
          where: {
            repairOrderId: order.id,
            type: "INVOICE",
            status: { not: "VOID" },
          },
          orderBy: { createdAt: "asc" },
        });
        const existingCustomer = existing.find((i) => i.billTo === "CUSTOMER");
        const existingInsurance = existing.find((i) => i.billTo === "INSURANCE");
        if (existingCustomer?.status !== "DRAFT" && existingCustomer) {
          bad(`Cet OR est déjà facturé (${existingCustomer.number}).`);
        }
        if (existingCustomer) {
          return { customerInvoice: existingCustomer, insuranceInvoice: existingInsurance ?? null };
        }
        const lines = await tx.repairOrderLine.findMany({
          where: { repairOrderId: order.id },
          include: { product: { select: { averageCost: true } } },
        });
        const split = splitRepairOrderLines(
          lines.map((l): RepairOrderLineForInvoice => ({
            ...l,
            productAverageCost: l.product?.averageCost || null,
          })),
        );
        if (split.customer.length === 0 && split.insurance.length === 0) {
          bad("Aucune ligne à facturer sur cet OR (lignes annulées, refusées ou sous garantie).");
        }
        const actor = actorOf(ctx);
        const header = {
          siteId: order.siteId,
          customerId: order.customerId,
          vehicleId: order.vehicleId,
          repairOrderId: order.id,
          mileage: order.mileageIn,
          createdById: ctx.membership.id,
        };
        const customerInvoice = split.customer.length
          ? await createDraft(tx, org, header, split.customer)
          : null;
        const insuranceInvoice =
          split.insurance.length && !existingInsurance
            ? await createDraft(
                tx,
                org,
                { ...header, billTo: "INSURANCE", insuranceClaimId: order.insuranceClaimId },
                split.insurance,
              )
            : (existingInsurance ?? null);
        await audit(actor, "invoice.created_from_repair_order", "RepairOrder", order.id, {
          siteId: order.siteId,
          after: {
            customerInvoiceId: customerInvoice?.id ?? null,
            insuranceInvoiceId: insuranceInvoice?.id ?? null,
          },
        });
        return { customerInvoice, insuranceInvoice };
      });
    }),

  /** US-M08-02 — depuis un devis accepté sans OR. */
  createFromQuote: requirePermission("invoice:create")
    .input(createFromQuoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      assertBillingModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await tx.quote.findFirst({ where: { id: input.quoteId, deletedAt: null } });
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Devis introuvable." });
        requireSite(ctx, quote.siteId);
        return createDraftFromQuote(tx, actorOf(ctx), org, quote);
      });
    }),

  /** US-M08-02 — vente comptoir (facture sans OR). */
  createDirect: requirePermission("invoice:create")
    .input(createDirectInvoiceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      assertBillingModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const siteId = await resolveSiteId(tx, ctx, input.siteId);
        let customerId = input.customerId;
        if (!customerId) {
          if (!org.settings.allowWalkIn) bad("Choisissez le client à facturer.");
          customerId = (await walkInCustomer(tx, ctx.organizationId)).id;
        }
        const customer = await tx.customer.findFirst({
          where: { id: customerId, deletedAt: null },
        });
        if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "Client introuvable." });
        if (input.vehicleId) {
          const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId } });
          if (!vehicle)
            throw new TRPCError({ code: "NOT_FOUND", message: "Véhicule introuvable." });
        }
        const lines = await draftLinesFromInput(tx, ctx, org, null, input.lines, input.priceReason);
        const invoice = await createDraft(
          tx,
          org,
          {
            siteId,
            customerId: customer.id,
            vehicleId: input.vehicleId ?? null,
            notes: input.notes ?? null,
            createdById: ctx.membership.id,
          },
          lines,
        );
        await audit(actorOf(ctx), "invoice.created", "Invoice", invoice.id, { siteId });
        return invoice;
      });
    }),

  /** US-M08-03 — facture d'acompte (brouillon, montant TTC). */
  createDeposit: requirePermission("invoice:create")
    .input(createDepositInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      assertBillingModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const customer = await tx.customer.findFirst({ where: { id: input.customerId } });
        if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "Client introuvable." });
        const quote = input.quoteId
          ? await tx.quote.findFirst({ where: { id: input.quoteId, customerId: customer.id } })
          : null;
        if (input.quoteId && !quote) bad("Devis introuvable pour ce client.");
        const order = input.repairOrderId
          ? await tx.repairOrder.findFirst({
              where: { id: input.repairOrderId, customerId: customer.id },
            })
          : null;
        if (input.repairOrderId && !order) bad("OR introuvable pour ce client.");
        if (quote && input.amountTtc > quote.acceptedTotal && quote.acceptedTotal > 0) {
          bad("L'acompte ne peut pas dépasser le total accepté du devis.");
        }
        const siteId = quote?.siteId ?? order?.siteId ?? (await resolveSiteId(tx, ctx));
        requireSite(ctx, siteId);
        const line = guard(() =>
          buildDepositLine({
            reference: quote?.number ?? order?.number ?? null,
            amountTtc: input.amountTtc,
            vatRate: org.vatEnabled ? org.vatRate : 0,
          }),
        );
        const invoice = await createDraft(
          tx,
          org,
          {
            siteId,
            customerId: customer.id,
            vehicleId: quote?.vehicleId ?? order?.vehicleId ?? null,
            quoteId: quote?.id ?? null,
            repairOrderId: order?.id ?? null,
            type: "DEPOSIT",
            createdById: ctx.membership.id,
          },
          [line],
        );
        if (quote && !quote.depositInvoiceId) {
          await tx.quote.update({
            where: { id: quote.id },
            data: { depositAmount: input.amountTtc, depositInvoiceId: invoice.id },
          });
        }
        await audit(actorOf(ctx), "invoice.deposit_created", "Invoice", invoice.id, {
          siteId,
          after: { amountTtc: input.amountTtc },
        });
        return invoice;
      });
    }),

  /** Brouillon seulement (RG-M08-02) : lignes d'une vente comptoir / d'un devis, notes. */
  update: requirePermission("invoice:create")
    .input(updateInvoiceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const invoice = await loadInvoice(tx, ctx, input.id);
        if (invoice.status !== "DRAFT") {
          bad("Une facture émise n'est plus modifiable : corrigez-la par un avoir.");
        }
        if (input.lines) {
          if (invoice.repairOrderId) {
            bad(
              "Les lignes d'une facture d'OR se modifient sur l'OR : supprimez ce brouillon puis refacturez.",
            );
          }
          if (invoice.type === "DEPOSIT") bad("Recréez l'acompte pour en changer le montant.");
          const lines = await draftLinesFromInput(
            tx,
            ctx,
            org,
            invoice.id,
            input.lines,
            input.priceReason,
          );
          await tx.invoiceLine.deleteMany({
            where: { invoiceId: invoice.id, depositInvoiceId: null },
          });
          for (const data of lineCreateData(ctx.organizationId, lines)) {
            await tx.invoiceLine.create({ data: { ...data, invoiceId: invoice.id } });
          }
        }
        if (input.notes !== undefined) {
          await tx.invoice.update({ where: { id: invoice.id }, data: { notes: input.notes } });
        }
        return persistTotals(tx, org, invoice.id);
      });
    }),

  /** RG-M08-05 — totaux en direct de l'éditeur. */
  preview: requirePermission("invoice:read")
    .input(previewInvoiceInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const computed = guard(() =>
        computeDraftTotals(
          input.lines.map((l) => ({
            type: l.type,
            productId: null,
            laborOperationId: null,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? 0,
            discountRate: l.discountRate ?? 0,
            vatRate: l.vatRate ?? (org.vatEnabled ? org.vatRate : 0),
            payer: "CUSTOMER",
            repairOrderLineId: null,
            depositInvoiceId: null,
            unitCost: null,
            fixed: null,
          })),
          { vatEnabled: org.vatEnabled, vatRounding: org.settings.vatRounding },
        ),
      );
      return {
        lines: computed.lines.map((l) => ({
          lineSubtotal: l.lineSubtotal,
          lineVat: l.lineVat,
          lineTotal: l.lineTotal,
        })),
        totals: computed.totals,
      };
    }),

  /** US-M08-01 — émission : numéro définitif, totaux figés, OR facturé, stock sorti. */
  issue: requirePermission("invoice:issue")
    .input(issueInvoiceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      assertBillingModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const issued = await tenantDb.transaction(
        async (tx) => {
          await loadInvoice(tx, ctx, input.id);
          return issueInvoice(tx, actorOf(ctx), org, input.id, input.applyDepositIds ?? []);
        },
        { timeout: 20_000, maxWait: 20_000 },
      );
      // US-M08-05 : certification FNE démarrée après commit (mode api).
      if (issued.fneNextRetryAt) {
        await enqueueFneCertifyJob(ctx.organizationId, issued.id, issued.fneAttempts);
      }
      return issued;
    }),

  /** Seuls les brouillons se suppriment (01 §7) ; une facture émise se corrige par avoir. */
  deleteDraft: requirePermission("invoice:create")
    .input(invoiceIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const invoice = await loadInvoice(tx, ctx, input.id);
        if (invoice.status !== "DRAFT") {
          bad("Une facture émise ne se supprime jamais : créez un avoir.");
        }
        await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
        await tx.quote.updateMany({
          where: { depositInvoiceId: invoice.id },
          data: { depositInvoiceId: null },
        });
        if (invoice.quoteId && invoice.type === "INVOICE") {
          const quote = await tx.quote.findFirst({ where: { id: invoice.quoteId } });
          if (quote?.status === "CONVERTED" && !quote.repairOrderId) {
            const [all, accepted] = await Promise.all([
              tx.quoteLine.count({ where: { quoteId: quote.id } }),
              tx.quoteLine.count({ where: { quoteId: quote.id, accepted: true } }),
            ]);
            await tx.quote.update({
              where: { id: quote.id },
              data: {
                status: accepted === all ? "ACCEPTED" : "PARTIALLY_ACCEPTED",
                convertedAt: null,
              },
            });
          }
        }
        await tx.invoice.delete({ where: { id: invoice.id } });
        await audit(actorOf(ctx), "invoice.draft_deleted", "Invoice", invoice.id, {
          siteId: invoice.siteId,
          before: { total: invoice.total, customerId: invoice.customerId },
        });
        return { ok: true };
      });
    }),

  /** US-M08-04 — avoir total ou partiel, motif obligatoire. */
  createCreditNote: requirePermission("invoice:credit_note")
    .input(creditNoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      assertBillingModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const result = await tenantDb.transaction(
        async (tx) => {
          await loadInvoice(tx, ctx, input.invoiceId);
          return createCreditNote(tx, actorOf(ctx), org, {
            invoiceId: input.invoiceId,
            selection: input.lines,
            reason: input.reason,
          });
        },
        { timeout: 20_000, maxWait: 20_000 },
      );
      // RG-M08-12 : l'avoir est toujours soumis à la FNE.
      if (result.creditNote.fneNextRetryAt) {
        await enqueueFneCertifyJob(ctx.organizationId, result.creditNote.id, 0);
      }
      return result;
    }),

  /** RG-M08-02 — l'échéance reste modifiable après émission (audit, `invoice:edit_due`). */
  updateDueDate: requirePermission("invoice:edit_due")
    .input(updateDueDateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const invoice = await loadInvoice(tx, ctx, input.id);
        if (invoice.status === "DRAFT") bad("L'échéance d'un brouillon est fixée à l'émission.");
        if (invoice.type === "CREDIT_NOTE") bad("Un avoir n'a pas d'échéance.");
        const dueDate = new Date(`${input.dueDate}T00:00:00.000Z`);
        await tx.invoice.update({ where: { id: invoice.id }, data: { dueDate } });
        const updated = await recomputeInvoiceBalance(tx, invoice.id, org.today);
        await audit(actorOf(ctx), "invoice.due_date_changed", "Invoice", invoice.id, {
          siteId: invoice.siteId,
          before: { dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null },
          after: { dueDate: input.dueDate },
          reason: input.reason,
        });
        if (invoice.billTo === "CUSTOMER") await syncReceivables(tx, org, invoice.customerId);
        return updated;
      });
    }),

  list: requirePermission("invoice:read")
    .input(invoiceListInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const where = listWhere(input, ctx);
      const rows = await tenantDb.invoice.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          number: true,
          type: true,
          status: true,
          billTo: true,
          issuedAt: true,
          dueDate: true,
          createdAt: true,
          total: true,
          amountPaid: true,
          balance: true,
          fneStatus: true,
          customer: { select: { id: true, displayName: true } },
          vehicle: { select: { plate: true, make: true, model: true } },
          repairOrder: { select: { number: true } },
        },
      });
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const fnePendingCount = await tenantDb.invoice.count({
        where: { status: { not: "DRAFT" }, fneStatus: { in: ["PENDING", "FAILED"] } },
      });
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
        timeZone: org.timeZone,
        fnePendingCount,
      };
    }),

  get: requirePermission("invoice:read")
    .input(invoiceIdInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const invoice = await loadInvoice(tx, ctx, input.id);
        const [lines, customer, vehicle, order, allocations, creditNotes, credited, site] =
          await Promise.all([
            tx.invoiceLine.findMany({
              where: { invoiceId: invoice.id },
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            }),
            tx.customer.findFirstOrThrow({ where: { id: invoice.customerId } }),
            invoice.vehicleId ? tx.vehicle.findFirst({ where: { id: invoice.vehicleId } }) : null,
            invoice.repairOrderId
              ? tx.repairOrder.findFirst({
                  where: { id: invoice.repairOrderId },
                  select: { id: true, number: true, status: true },
                })
              : null,
            tx.paymentAllocation.findMany({
              where: { invoiceId: invoice.id },
              include: {
                payment: {
                  select: {
                    id: true,
                    number: true,
                    method: true,
                    amount: true,
                    status: true,
                    receivedAt: true,
                    reference: true,
                    voidedAt: true,
                  },
                },
              },
              orderBy: { id: "asc" },
            }),
            tx.invoice.findMany({
              where: { creditedInvoiceId: invoice.id },
              select: { id: true, number: true, total: true, issuedAt: true, notes: true },
              orderBy: { createdAt: "asc" },
            }),
            invoice.creditedInvoiceId
              ? tx.invoice.findFirst({
                  where: { id: invoice.creditedInvoiceId },
                  select: { id: true, number: true },
                })
              : null,
            tx.site.findFirst({ where: { id: invoice.siteId }, select: { id: true, name: true } }),
          ]);
        // Acomptes payés du client non encore déduits (US-M08-03), proposés à l'émission.
        const deposits =
          invoice.status === "DRAFT" && invoice.type === "INVOICE"
            ? await tx.invoice.findMany({
                where: { customerId: invoice.customerId, type: "DEPOSIT", status: "PAID" },
                select: { id: true, number: true, total: true, quoteId: true, repairOrderId: true },
              })
            : [];
        const deducted = deposits.length
          ? new Set(
              (
                await tx.invoiceLine.findMany({
                  where: {
                    depositInvoiceId: { in: deposits.map((d) => d.id) },
                    invoice: { status: { not: "VOID" } },
                  },
                  select: { depositInvoiceId: true },
                })
              ).map((l) => l.depositInvoiceId),
            )
          : new Set<string | null>();
        const pendingCheques = allocations
          .filter((a) => !a.voidedAt && a.payment?.status === "PENDING")
          .reduce((s, a) => s + a.amount, 0);
        const unallocatedPayments =
          invoice.status === "DRAFT"
            ? 0
            : ((
                await tx.payment.aggregate({
                  where: {
                    customerId: invoice.customerId,
                    status: "CONFIRMED",
                    voidedAt: null,
                    unallocated: { gt: 0 },
                  },
                  _sum: { unallocated: true },
                })
              )._sum.unallocated ?? 0);
        const customerCredits = await tx.customerCredit.findMany({
          where: { customerId: invoice.customerId, remaining: { gt: 0 } },
          select: { id: true, remaining: true, sourceType: true, createdAt: true },
        });
        return {
          invoice,
          lines,
          customer: {
            id: customer.id,
            displayName: customer.displayName,
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
            ncc: customer.ncc,
            rccm: customer.rccm,
            type: customer.type,
            paymentTermsDays: customer.paymentTermsDays,
          },
          vehicle: vehicle
            ? { id: vehicle.id, plate: vehicle.plate, make: vehicle.make, model: vehicle.model }
            : null,
          repairOrder: order,
          site,
          allocations: allocations.map((a) => ({
            id: a.id,
            amount: a.amount,
            voidedAt: a.voidedAt,
            customerCreditId: a.customerCreditId,
            payment: a.payment,
          })),
          creditNotes,
          creditedInvoice: credited,
          availableDeposits: deposits
            .filter((d) => !deducted.has(d.id))
            .map((d) => ({ id: d.id, number: d.number, total: d.total })),
          pendingCheques,
          unallocatedPayments,
          customerCredits,
          timeZone: org.timeZone,
          vatEnabled: org.vatEnabled,
          fneMode: org.fneMode ?? "manual",
          missingIdentity: [
            !org.rccm ? "RCCM" : null,
            !org.ncc ? "NCC" : null,
            !org.legalName ? "Raison sociale" : null,
            !org.address ? "Adresse" : null,
            !org.phone ? "Téléphone" : null,
          ].filter((x): x is string => !!x),
        };
      });
    }),

  /** Factures d'un OR (bouton « Facturer » / « Voir la facture » de la fiche OR). */
  forRepairOrder: requirePermission("invoice:read")
    .input(z.object({ repairOrderId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.invoice.findMany({
        where: { repairOrderId: input.repairOrderId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          number: true,
          type: true,
          status: true,
          billTo: true,
          total: true,
          balance: true,
        },
      });
    }),

  /** US-M08-14 — envoi WhatsApp / SMS / email : lien portail, lien de paiement du solde, PDF. */
  send: requirePermission("invoice:read", "message:send")
    .input(sendInvoiceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      assertBillingModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const invoice = await tenantDb.transaction((tx) => loadInvoice(tx, ctx, input.id));
      return sendInvoice(actorOf(ctx), org, {
        invoice,
        channel: input.channel,
        includePaymentLink: input.includePaymentLink,
      });
    }),

  /** M14 §7 « Lien client » : nouveau lien portail de la facture, à copier. */
  portalLink: requirePermission("invoice:read", "message:send")
    .input(invoiceIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const link = await tenantDb.transaction(async (tx) => {
        const invoice = await loadInvoice(tx, ctx, input.id);
        if (invoice.status === "DRAFT" || invoice.status === "VOID") {
          bad("Seule une facture émise et non annulée a un lien client.");
        }
        return issueInvoicePortalLink(tx, invoice, ctx.membership.id, org.now);
      });
      await audit(actorOf(ctx), "invoice.portal_link_created", "Invoice", input.id);
      return { url: link.url };
    }),
});
