// M05 §8 / M14 §4.2 — portail public du devis (sans compte) : consultation (marque VIEWED),
// décision par groupe avec signature et preuve (RG-M05-10), question / rappel (US-M05-06).
// Le jeton (PortalToken portée QUOTE) ne donne accès qu'à ce devis et à ses versions suivantes.
import { TRPCError } from "@trpc/server";
import { isPastValidity, businessDate, isPreviewBot, signatureRequired } from "@atelieros/core";
import { db, type Quote } from "@atelieros/db";
import {
  portalQuoteAskInputSchema,
  portalQuoteDecideInputSchema,
  portalQuoteGetInputSchema,
} from "@atelieros/validators";
import { recordInboundMessage } from "../messaging/inbound";
import { notify, roNow } from "../repairOrders/helpers";
import { buildQuotePublicView } from "../quotes/publicView";
import {
  applyDecision,
  latestVersionOf,
  loadOrgQuoteContext,
  quoteContentHash,
  resolveQuoteToken,
  storeQuoteImage,
  truncateIp,
} from "../quotes/service";
import { emitDomainEvent } from "../events/emit";
import { publicProcedure, router } from "../trpc";

// RG-M05-09 / RG-M14-06 — 30 requêtes/min par jeton (mémoire du processus).
const hits = new Map<string, number[]>();
function rateLimit(key: string, now: number): void {
  if (hits.size > 10_000) {
    for (const [k, times] of hits) if (times.every((t) => now - t >= 60_000)) hits.delete(k);
  }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (recent.length > 30) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Trop de requêtes. Réessayez dans une minute.",
    });
  }
}

function linkError(status: "EXPIRED" | "REVOKED" | "NOT_FOUND"): never {
  throw new TRPCError({
    code: "NOT_FOUND",
    message:
      status === "EXPIRED"
        ? "LINK_EXPIRED : ce lien a expiré. Contactez le garage pour recevoir un nouveau lien."
        : "Lien expiré ou invalide.",
  });
}

async function resolve(token: string, now: Date) {
  rateLimit(token, now.getTime());
  const resolved = await resolveQuoteToken(token, now);
  if (resolved.status !== "ACTIVE") linkError(resolved.status);
  const tenantDb = db.forTenant({ organizationId: resolved.token.organizationId });
  const target = await tenantDb.quote.findFirst({
    where: { id: resolved.token.targetId, deletedAt: null },
  });
  if (!target) linkError("NOT_FOUND");
  return { token: resolved.token, tenantDb, target };
}

export const portalQuoteRouter = router({
  get: publicProcedure.input(portalQuoteGetInputSchema).query(async ({ ctx, input }) => {
    const now = roNow();
    const { tenantDb, target } = await resolve(input.token, now);
    const org = await loadOrgQuoteContext(target.organizationId);
    return tenantDb.transaction(async (tx) => {
      let quote: Quote = await latestVersionOf(tx, target);
      // §5 view : première ouverture par le client (ni robot d'aperçu, ni personnel connecté).
      if (quote.status === "SENT" && !isPreviewBot(ctx.userAgent) && !ctx.user) {
        quote = await tx.quote.update({
          where: { id: quote.id },
          data: { status: "VIEWED", viewedAt: now },
        });
        await emitDomainEvent(tx as never, quote.organizationId, "quote.viewed", {
          quoteId: quote.id,
          customerId: quote.customerId,
        });
      }
      return buildQuotePublicView(tx, org, quote, now, { requestedQuoteId: target.id });
    });
  }),

  decide: publicProcedure.input(portalQuoteDecideInputSchema).mutation(async ({ ctx, input }) => {
    const now = roNow();
    const { tenantDb, target } = await resolve(input.token, now);
    const org = await loadOrgQuoteContext(target.organizationId);
    const latest = await tenantDb.transaction((tx) => latestVersionOf(tx, target));
    if (latest.id !== input.quoteId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "QUOTE_CHANGED : le devis a été mis à jour. Vérifiez les nouveaux montants.",
      });
    }
    // Double soumission : renvoie la décision déjà enregistrée (§11, RG-M14-07).
    if (["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED", "CONVERTED"].includes(latest.status)) {
      return {
        status: latest.status,
        acceptedTotal: latest.acceptedTotal,
        deposit: latest.depositAmount ?? 0,
        alreadyDecided: true,
      };
    }
    if (latest.status !== "SENT" && latest.status !== "VIEWED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Ce devis ne peut plus être validé." });
    }
    if (isPastValidity(latest.validUntil, businessDate(now, org.timeZone))) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "QUOTE_EXPIRED : ce devis a expiré. Contactez-nous pour l'actualiser.",
      });
    }
    const anyAccepted = input.decisions.some((d) => d.accepted);
    if (anyAccepted && signatureRequired(org.quotes.requireSignature, latest.total)) {
      if (!input.signatureDataUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Signez pour valider votre choix." });
      }
    } else if (anyAccepted && !input.signatureDataUrl && !input.acceptTerms) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Cochez « J'accepte » pour valider." });
    }
    const out = await tenantDb.transaction(async (tx) => {
      const lines = await tx.quoteLine.findMany({ where: { quoteId: latest.id } });
      const current = await tx.quote.findFirstOrThrow({ where: { id: latest.id } });
      if (quoteContentHash(current, lines) !== input.contentHash) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "QUOTE_CHANGED : le devis a été mis à jour. Vérifiez les nouveaux montants.",
        });
      }
      const signature = input.signatureDataUrl
        ? await storeQuoteImage(tx, {
            organizationId: current.organizationId,
            quoteId: current.id,
            dataUrl: input.signatureDataUrl,
            kind: "signature",
            membershipId: null,
          })
        : null;
      return applyDecision(tx, org, {
        quote: current,
        decisions: input.decisions.map((d) => ({
          groupKey: d.groupKey,
          accepted: d.accepted,
          declineReason: d.accepted ? null : (input.declineReason ?? null),
        })),
        channel: "portal",
        now,
        actorMembershipId: null,
        declineReason: input.declineReason ?? null,
        data: {
          signerName: input.signerName,
          signatureUrl: signature?.url ?? null,
          decisionIp: truncateIp(ctx.ip),
          decisionUserAgent: ctx.userAgent?.slice(0, 300) ?? null,
        },
      });
    });
    return {
      status: out.quote.status,
      acceptedTotal: out.acceptedTotal,
      deposit: out.deposit,
      alreadyDecided: false,
    };
  }),

  /** US-M05-06 : question (boîte de réception M11), rappel ou demande d'actualisation. */
  ask: publicProcedure.input(portalQuoteAskInputSchema).mutation(async ({ input }) => {
    const now = roNow();
    const resolved = await resolveQuoteToken(input.token, now);
    // Un devis expiré peut toujours demander son actualisation (jeton lisible jusqu'à J+30).
    if (resolved.status !== "ACTIVE") linkError(resolved.status);
    rateLimit(input.token, now.getTime());
    const tenantDb = db.forTenant({ organizationId: resolved.token.organizationId });
    const quote = await tenantDb.quote.findFirst({ where: { id: resolved.token.targetId } });
    if (!quote) linkError("NOT_FOUND");
    const customer = await tenantDb.customer.findFirstOrThrow({ where: { id: quote.customerId } });
    if (input.message) {
      const from = customer.whatsappPhone ?? customer.phone;
      if (from) {
        await recordInboundMessage({
          organizationId: quote.organizationId,
          channel: "WHATSAPP",
          from,
          body: `[Devis ${quote.number}] ${input.message}`,
          occurredAt: now,
        });
      }
    }
    await tenantDb.transaction(async (tx) => {
      const title = input.callback
        ? `Rappeler ${customer.displayName} au sujet du devis ${quote.number}`
        : input.refresh
          ? `Actualiser le devis ${quote.number} (demande du client)`
          : `Question sur le devis ${quote.number}`;
      await notify(tx, quote.organizationId, [quote.createdById], {
        type: input.callback ? "quote.callback_requested" : "quote.question",
        title,
        body: input.message?.slice(0, 300),
        link: `/devis/${quote.id}`,
      });
    });
    return { ok: true };
  }),
});
