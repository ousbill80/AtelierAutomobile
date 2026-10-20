// M14 §8 `portal.invoice.*` — page facture publique (sans compte) : consultation, paiement
// mobile money (lien réutilisé s'il en existe un en attente, RG-M14-14) et statut. « Payé »
// n'est affiché que sur un `Payment` confirmé (webhook ou vérification), jamais sur la seule
// redirection du fournisseur (RG-M14-15). Le jeton INVOICE ne lit que cette facture.
import { TRPCError } from "@trpc/server";
import { isConfirmationOverdue } from "@atelieros/core";
import { db } from "@atelieros/db";
import { portalInvoicePayInputSchema, portalInvoiceTokenInputSchema } from "@atelieros/validators";
import {
  alertUnconfirmedPortalPayment,
  buildInvoicePublicView,
  resolveInvoiceToken,
} from "../billing/portal";
import { createInvoicePaymentLink, refreshPaymentLink } from "../billing/paymentLinks";
import { billingNow } from "../billing/service";
import { publicProcedure, router } from "../trpc";

// RG-M14-06 — 30 requêtes/min par jeton (mémoire du processus).
const hits = new Map<string, number[]>();
function rateLimit(key: string, now: number, max = 30): void {
  if (hits.size > 10_000) {
    for (const [k, times] of hits) if (times.every((t) => now - t >= 60_000)) hits.delete(k);
  }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (recent.length > max) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Trop de requêtes. Réessayez dans une minute.",
    });
  }
}

/** Tests : réinitialise le limiteur. */
export function resetPortalInvoiceRateLimit() {
  hits.clear();
}

async function requireToken(token: string, now: Date, count: boolean) {
  rateLimit(token, now.getTime());
  const resolved = await resolveInvoiceToken(token, now, count);
  if (resolved.status === "ACTIVE") return resolved.token;
  throw new TRPCError({
    code: "NOT_FOUND",
    message:
      resolved.status === "EXPIRED"
        ? "LINK_EXPIRED : ce lien a expiré. Contactez le garage pour recevoir un nouveau lien."
        : "Lien expiré ou invalide.",
  });
}

/** Délai minimal entre deux vérifications auprès du fournisseur depuis la page (polling). */
const PROVIDER_CHECK_INTERVAL_MS = 15_000;

export const portalInvoiceRouter = router({
  get: publicProcedure.input(portalInvoiceTokenInputSchema).query(async ({ input }) => {
    const now = billingNow();
    const token = await requireToken(input.token, now, true);
    const view = await buildInvoicePublicView(token, now);
    if (!view) throw new TRPCError({ code: "NOT_FOUND", message: "Lien expiré ou invalide." });
    return view;
  }),

  /** RG-M14-14 — « Payer avec Wave / Orange Money / MTN / Moov » : URL du fournisseur. */
  pay: publicProcedure.input(portalInvoicePayInputSchema).mutation(async ({ input }) => {
    const now = billingNow();
    const token = await requireToken(input.token, now, false);
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
  paymentStatus: publicProcedure.input(portalInvoiceTokenInputSchema).query(async ({ input }) => {
    const now = billingNow();
    const token = await requireToken(input.token, now, false);
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
