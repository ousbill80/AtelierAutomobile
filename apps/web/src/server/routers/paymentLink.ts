// M08 §8 `paymentLink.*` (RG-M08-23..25) — lien de paiement mobile money d'une facture :
// création (montant ≤ solde, 72 h), envoi immédiat optionnel, annulation, vérification auprès
// du fournisseur, historique. M14 §10 : créer / envoyer un lien facture demande `invoice:read`
// et `message:send`.
import { TRPCError } from "@trpc/server";
import { db } from "@atelieros/db";
import {
  createPaymentLinkInputSchema,
  paymentLinkIdInputSchema,
  paymentLinkListInputSchema,
} from "@atelieros/validators";
import { actorOf, type OrgCtx } from "../billing/context";
import { createInvoicePaymentLink, refreshPaymentLink } from "../billing/paymentLinks";
import { sendInvoice } from "../billing/send";
import {
  assertBillingModule,
  audit,
  bad,
  billingNow,
  invoiceNotFound,
  loadOrgBillingContext,
} from "../billing/service";
import { requirePermission, requireSite, router } from "../trpc";

async function loadInvoice(ctx: OrgCtx, id: string) {
  const invoice = await db.forTenant({ organizationId: ctx.organizationId }).invoice.findFirst({
    where: { id },
  });
  if (!invoice) invoiceNotFound();
  requireSite(ctx, invoice.siteId);
  return invoice;
}

async function loadLink(ctx: OrgCtx, id: string) {
  const link = await db.forTenant({ organizationId: ctx.organizationId }).paymentLink.findFirst({
    where: { id },
  });
  if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Lien de paiement introuvable." });
  await loadInvoice(ctx, link.invoiceId);
  return link;
}

export const paymentLinkRouter = router({
  /** US-M08-09 — lien du solde (modifiable vers le bas), expiration 72 h, envoi immédiat. */
  create: requirePermission("invoice:read", "message:send")
    .input(createPaymentLinkInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgBillingContext(ctx.organizationId);
      assertBillingModule(org);
      const invoice = await loadInvoice(ctx, input.invoiceId);
      const actor = actorOf(ctx);
      const link = await createInvoicePaymentLink({
        organizationId: ctx.organizationId,
        invoiceId: invoice.id,
        amount: input.amount,
        expiresInHours: input.expiresInHours,
        reuse: false,
        createdById: ctx.membership.id,
        now: org.now,
      });
      await audit(actor, "payment_link.created", "PaymentLink", link.id, {
        siteId: invoice.siteId,
        after: {
          invoiceId: invoice.id,
          amount: link.amount,
          provider: link.provider,
          expiresAt: link.expiresAt,
        },
      });
      let messageId: string | null = null;
      if (input.send) {
        const sent = await sendInvoice(actor, org, {
          invoice: await loadInvoice(ctx, invoice.id),
          channel: input.send,
          includePaymentLink: true,
        });
        messageId = sent.messageId;
      }
      return { link, messageId };
    }),

  /** Annulation côté application (le lien du fournisseur expire de lui-même). */
  cancel: requirePermission("invoice:read", "message:send")
    .input(paymentLinkIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const link = await loadLink(ctx, input.id);
      if (link.status !== "PENDING") bad("Ce lien n'est plus en attente de paiement.");
      const now = billingNow();
      const updated = await db
        .forTenant({ organizationId: ctx.organizationId })
        .paymentLink.update({
          where: { id: link.id },
          data: { status: "FAILED", closedAt: now, closeReason: "cancelled" },
        });
      await audit(actorOf(ctx), "payment_link.cancelled", "PaymentLink", link.id, {
        before: { status: link.status },
        after: { status: updated.status },
      });
      return updated;
    }),

  /** « Vérifier » : relit le statut chez le fournisseur et enregistre le paiement s'il est payé. */
  checkStatus: requirePermission("invoice:read")
    .input(paymentLinkIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const link = await loadLink(ctx, input.id);
      const result = await refreshPaymentLink(ctx.organizationId, link.id, billingNow(), "check");
      const after = await db
        .forTenant({ organizationId: ctx.organizationId })
        .paymentLink.findFirstOrThrow({ where: { id: link.id } });
      return { outcome: result.outcome, link: after };
    }),

  list: requirePermission("invoice:read")
    .input(paymentLinkListInputSchema)
    .query(async ({ ctx, input }) => {
      await loadInvoice(ctx, input.invoiceId);
      const now = billingNow();
      const links = await db
        .forTenant({ organizationId: ctx.organizationId })
        .paymentLink.findMany({
          where: { invoiceId: input.invoiceId },
          orderBy: { createdAt: "desc" },
          include: {
            createdBy: { select: { user: { select: { name: true } } } },
            payment: { select: { id: true, number: true, amount: true } },
          },
        });
      return links.map((l) => ({
        id: l.id,
        provider: l.provider,
        url: l.url,
        amount: l.amount,
        method: l.method,
        status: l.status,
        closeReason: l.closeReason,
        expired: l.status === "PENDING" && l.expiresAt.getTime() <= now.getTime(),
        expiresAt: l.expiresAt,
        createdAt: l.createdAt,
        confirmedAt: l.confirmedAt,
        confirmedAmount: l.confirmedAmount,
        createdByName: l.createdBy?.user.name ?? null,
        payment: l.payment,
      }));
    }),
});
