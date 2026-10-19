// M08 (sous-ensemble pour le mode REMINDERS_ONLY, Étape 2.3) : enregistrement manuel d'un
// paiement, affectation aux factures (plus ancienne d'abord par défaut), recalcul du solde,
// puis recalcul M09 (dossier, promesses, attribution) et événement `payment.received` (M10).
import { TRPCError } from "@trpc/server";
import { allocatePayment, applyAllocation, nextDocumentNumber } from "@atelieros/core";
import {
  attributeAllocations,
  db,
  evaluateCasePromises,
  syncCustomerReceivables,
  tenantSequenceStore,
  type InvoiceStatus,
} from "@atelieros/db";
import { recordPaymentInputSchema } from "@atelieros/validators";
import { z } from "zod";
import { emitDomainEvent } from "../events/emit";
import {
  isoToDate,
  loadOrgCollectionContext,
  notFound,
  rethrowDomain,
} from "../receivables/helpers";
import { requirePermission, requireSite, router } from "../trpc";

export const paymentRouter = router({
  record: requirePermission("payment:create")
    .input(recordPaymentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgCollectionContext(ctx.organizationId);
      const receivedDate = isoToDate(input.receivedAt);
      if (receivedDate.getTime() > org.today.getTime()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La date du paiement ne peut pas être dans le futur.",
        });
      }
      // Heure d'enregistrement conservée pour un paiement du jour (attribution RG-M09-14).
      const receivedAt = receivedDate.getTime() === org.today.getTime() ? org.now : receivedDate;

      const result = await tenantDb.transaction(async (tx) => {
        const customer = await tx.customer.findFirst({ where: { id: input.customerId } });
        if (!customer) notFound("Client introuvable.");
        const invoices = await tx.invoice.findMany({
          where: {
            customerId: customer.id,
            billTo: "CUSTOMER",
            status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
          },
        });
        const explicitIds = new Set((input.allocations ?? []).map((a) => a.invoiceId));
        if (explicitIds.size > 0) {
          const disputedOrOff = await tx.invoice.count({
            where: { id: { in: [...explicitIds] }, status: { in: ["DISPUTED", "WRITTEN_OFF"] } },
          });
          if (disputedOrOff > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Facture en litige ou passée en perte : résolvez le litige ou annulez la perte avant d'affecter le paiement.",
            });
          }
        }
        let plan;
        try {
          plan = allocatePayment({ amount: input.amount, invoices, explicit: input.allocations });
        } catch (error) {
          rethrowDomain(error);
        }
        const siteId =
          invoices.find((i) => i.id === plan.allocations[0]?.invoiceId)?.siteId ??
          (await defaultSiteId(tx));
        requireSite(ctx, siteId);
        const number = await nextDocumentNumber(tenantSequenceStore(tx), {
          organizationId: ctx.organizationId,
          docType: "REC",
          year: receivedAt.getUTCFullYear(),
        });
        const payment = await tx.payment.create({
          data: {
            organizationId: ctx.organizationId,
            siteId,
            customerId: customer.id,
            number,
            method: input.method,
            amount: input.amount,
            receivedAt,
            reference: input.reference ?? null,
            provider: "manual",
            receivedById: ctx.membership.id,
            unallocated: plan.unallocated,
            notes: input.notes ?? null,
          },
        });
        const createdAllocations: { id: string; amount: number }[] = [];
        for (const line of plan.allocations) {
          const invoice = invoices.find((i) => i.id === line.invoiceId)!;
          const next = applyAllocation(invoice, line.amount);
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { ...next, status: next.status as InvoiceStatus },
          });
          const allocation = await tx.paymentAllocation.create({
            data: {
              organizationId: ctx.organizationId,
              paymentId: payment.id,
              invoiceId: invoice.id,
              amount: line.amount,
            },
          });
          createdAllocations.push({ id: allocation.id, amount: line.amount });
        }
        const activeCase = await tx.collectionCase.findFirst({
          where: {
            customerId: customer.id,
            status: { in: ["OPEN", "PROMISED", "PAUSED", "DISPUTED", "ESCALATED"] },
          },
        });
        await attributeAllocations(tx, {
          organizationId: ctx.organizationId,
          customerId: customer.id,
          receivedAt,
          attributionDays: org.settings.attributionDays,
          allocations: createdAllocations,
        });
        if (activeCase) {
          await evaluateCasePromises(tx, {
            organizationId: ctx.organizationId,
            caseId: activeCase.id,
            today: org.today,
            now: org.now,
            graceDays: org.settings.graceDays,
          });
        }
        const sync = await syncCustomerReceivables(tx, {
          organizationId: ctx.organizationId,
          customerId: customer.id,
          today: org.today,
          now: org.now,
          settings: org.settings,
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "payment.received", {
          paymentId: payment.id,
          customerId: customer.id,
          caseId: activeCase?.id ?? null,
          amount: input.amount,
        });
        return {
          payment,
          allocations: plan.allocations,
          unallocated: plan.unallocated,
          caseId: sync.caseId,
        };
      });
      return result;
    }),

  listForCustomer: requirePermission("payment:read")
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.payment.findMany({
        where: { customerId: input.customerId },
        orderBy: { receivedAt: "desc" },
        take: 100,
        include: { allocations: { include: { invoice: { select: { number: true } } } } },
      });
    }),
});

async function defaultSiteId(
  tx: Parameters<Parameters<ReturnType<typeof db.forTenant>["transaction"]>[0]>[0],
) {
  const site = await tx.site.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!site)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Aucun site configuré pour enregistrer le paiement.",
    });
  return site.id;
}
