// M14 §8 `portal.invoice.*` — page facture publique (sans compte) : consultation, paiement
// mobile money (lien réutilisé s'il en existe un en attente, RG-M14-14) et statut. « Payé »
// n'est affiché que sur un `Payment` confirmé (webhook ou vérification), jamais sur la seule
// redirection du fournisseur (RG-M14-15). Le jeton INVOICE ne lit que cette facture.
import { TRPCError } from "@trpc/server";
import { isConfirmationOverdue } from "@atelieros/core";
import { db } from "@atelieros/db";
import { portalInvoicePayInputSchema, portalInvoiceTokenInputSchema } from "@atelieros/validators";
import { alertUnconfirmedPortalPayment, buildInvoicePublicView } from "../billing/portal";
import { requirePortalToken } from "../portal/access";
import { resetPortalRateLimits } from "../portal/rateLimit";
import { createInvoicePaymentLink, refreshPaymentLink } from "../billing/paymentLinks";
import { billingNow } from "../billing/service";
import { publicProcedure, router } from "../trpc";

/** Tests : réinitialise le limiteur (désormais partagé par tout le portail, RG-M14-06). */
export function resetPortalInvoiceRateLimit() {
  resetPortalRateLimits();
}

/** Délai minimal entre deux vérifications auprès du fournisseur depuis la page (polling). */
const PROVIDER_CHECK_INTERVAL_MS = 15_000;

export const portalInvoiceRouter = router({
  get: publicProcedure.input(portalInvoiceTokenInputSchema).query(async ({ ctx, input }) => {
    const now = billingNow();
    const token = await requirePortalToken(input.token, ["INVOICE"], ctx, { now });
    const view = await buildInvoicePublicView(token, now);
    if (!view) throw new TRPCError({ code: "NOT_FOUND", message: "Lien expiré ou invalide." });
    return view;
  }),

  /** RG-M14-14 — « Payer avec Wave / Orange Money / MTN / Moov » : URL du fournisseur. */
  pay: publicProcedure.input(portalInvoicePayInputSchema).mutation(async ({ ctx, input }) => {
    const now = billingNow();
    const token = await requirePortalToken(input.token, ["INVOICE"], ctx, {
      now,
      count: false,
      action: "pay_click",
    });
    const view = await buildInvoicePublicView(token, now);
    if (!view || !view.payable || !view.methods.includes(input.method)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: view?.invoice.balance
          ? "Le paiement en ligne est momentanément indisponible. Utilisez les numéros du garage."
          : "Cette facture est déjà réglée.",
      });
    }
    const link = await createInvoicePaymentLink({
      organizationId: token.organizationId,
      invoiceId: token.targetId,
      method: input.method,
      reuse: true,
      createdById: null,
      portalToken: input.token,
      now,
    });
    return { url: link.url };
  }),

  /**
   * Statut de paiement (rafraîchi par la page) : relit le dernier lien en attente chez le
   * fournisseur au plus toutes les 15 s ; au-delà de 2 min sans confirmation, le caissier est
   * prévenu et la page affiche « ne repayez pas ».
   */
  paymentStatus: publicProcedure
    .input(portalInvoiceTokenInputSchema)
    .query(async ({ ctx, input }) => {
      const now = billingNow();
      // Rafraîchissement (toutes les 3 s) : ni ouverture comptée, ni quota par IP consommé.
      const token = await requirePortalToken(input.token, ["INVOICE"], ctx, {
        now,
        count: false,
        skipRateLimit: true,
      });
      const tenantDb = db.forTenant({ organizationId: token.organizationId });
      const pending = await tenantDb.paymentLink.findFirst({
        where: {
          invoiceId: token.targetId,
          status: "PENDING",
          createdById: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      });
      if (
        pending &&
        (!pending.lastCheckedAt ||
          now.getTime() - pending.lastCheckedAt.getTime() >= PROVIDER_CHECK_INTERVAL_MS)
      ) {
        try {
          await refreshPaymentLink(token.organizationId, pending.id, now, "portal");
        } catch {
          // Fournisseur indisponible : le webhook ou le rapprochement prendront le relais.
        }
      }
      const invoice = await tenantDb.invoice.findFirstOrThrow({
        where: { id: token.targetId },
        select: { number: true, status: true, balance: true, amountPaid: true },
      });
      const stillPending = pending
        ? await tenantDb.paymentLink.findFirst({ where: { id: pending.id, status: "PENDING" } })
        : null;
      const overdue = stillPending ? isConfirmationOverdue(stillPending.createdAt, now) : false;
      if (stillPending && overdue) {
        await alertUnconfirmedPortalPayment(token.organizationId, stillPending, invoice.number);
      }
      return {
        status: invoice.status,
        balance: invoice.balance,
        amountPaid: invoice.amountPaid,
        paid: invoice.status === "PAID",
        pending: stillPending ? { since: stillPending.createdAt, overdue } : null,
      };
    }),
});
