// M05 US-M05-05/06 + M14 §4.2 — portail public du devis (sans compte) : consultation par
// groupes, décision ligne par ligne avec signature, question / rappel. Jamais de données
// internes (coûts, marges, notes). Le jeton fournit l'organisation (A2).
import { TRPCError } from "@trpc/server";
import {
  depositAmount,
  groupQuoteLines,
  isPreviewBot,
  isQuoteExpired,
  businessDate,
  SIGNATURE_ALWAYS_REQUIRED_ABOVE,
} from "@atelieros/core";
import { db, type Quote } from "@atelieros/db";
import {
  portalQuoteAskInputSchema,
  portalQuoteDecideInputSchema,
  portalQuoteTokenInputSchema,
} from "@atelieros/validators";
import { emitDomainEvent } from "../events/emit";
import { notify } from "../repairOrders/helpers";
import {
  applyQuoteDecision,
  flushMessages,
  loadOrgQuoteContext,
  quoteDecisionHash,
  quoteNow,
  resolveQuoteToken,
  storeQuoteSignature,
} from "../quotes/helpers";
import { publicProcedure, router } from "../trpc";

const REQUESTS_PER_MINUTE_PER_TOKEN = 30;
const hits = new Map<string, number[]>();

/** RG-M05-09 : 30 requêtes / min / jeton (mémoire du processus, suffisant pour une instance). */
function rateLimit(token: string, now: Date) {
  const since = now.getTime() - 60_000;
  const recent = (hits.get(token) ?? []).filter((t) => t > since);
  if (recent.length >= REQUESTS_PER_MINUTE_PER_TOKEN) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Trop de requêtes. Patientez." });
  }
  recent.push(now.getTime());
  hits.set(token, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (times.every((t) => t <= since)) hits.delete(key);
  }
}

export function resetPortalQuoteRateLimit() {
  hits.clear();
}

type PortalState = "OPEN" | "DECIDED" | "EXPIRED" | "SUPERSEDED" | "CONVERTED";

async function requireToken(token: string, now: Date, countOpen: boolean) {
  const resolved = await resolveQuoteToken(token, now, countOpen);
  if (resolved.status === "ACTIVE") return resolved;
  throw new TRPCError({
    code: resolved.status === "NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN",
    message:
      resolved.status === "NOT_FOUND"
        ? "Lien introuvable."
        : resolved.status === "REVOKED"
          ? "Ce devis a été mis à jour. Un nouveau lien vous a été envoyé."
          : "Ce lien a expiré. Contactez le garage pour actualiser votre devis.",
    cause: { code: `TOKEN_${resolved.status}` },
  });
}

function stateOf(quote: Quote, expired: boolean): PortalState {
  if (quote.supersededAt) return "SUPERSEDED";
  if (quote.status === "CONVERTED") return "CONVERTED";
  if (["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED"].includes(quote.status)) return "DECIDED";
  if (quote.status === "EXPIRED" || expired) return "EXPIRED";
  return "OPEN";
}

export const portalQuoteRouter = router({
  get: publicProcedure.input(portalQuoteTokenInputSchema).query(async ({ ctx, input }) => {
    const now = quoteNow();
    rateLimit(input.token, now);
    const token = await requireToken(input.token, now, true);
    const org = await loadOrgQuoteContext(token.organizationId);
    const tenantDb = db.forTenant({ organizationId: token.organizationId });
    const quote = await tenantDb.quote.findFirst({
      where: { id: token.quoteId, deletedAt: null },
      include: {
        customer: { select: { displayName: true, phone: true } },
        vehicle: { select: { plate: true, make: true, model: true, year: true } },
        site: { select: { name: true, phone: true, whatsappNumber: true, address: true } },
        lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });
    if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Devis introuvable." });
    const today = businessDate(now, org.timeZone);
    const expired = isQuoteExpired(quote.validUntil, today);
    const state = stateOf(quote, expired);

    // RG-M05-04 (view) : première ouverture humaine → VIEWED (robots d'aperçu ignorés).
    if (quote.status === "SENT" && !isPreviewBot(ctx.userAgent)) {
      await tenantDb.transaction(async (tx) => {
        await tx.quote.update({
          where: { id: quote.id },
          data: { status: "VIEWED", viewedAt: now },
        });
        await emitDomainEvent(tx as never, token.organizationId, "quote.viewed", {
          quoteId: quote.id,
          number: quote.number,
          customerId: quote.customerId,
        });
      });
    }

    const visibleLines = quote.lines.filter((l) => l.payer !== "INTERNAL");
    const groups = groupQuoteLines(
      visibleLines,
      visibleLines.map((l) => (l.payer === "WARRANTY" ? 0 : l.lineTotal)),
    );
    const showPrices = org.quotes.showLinePricesToCustomer;
    const total = quote.customerShare || quote.total;
    const hash = quoteDecisionHash(quote.lines, quote.total);
    return {
      state,
      garage: {
        name: org.name,
        logoUrl: org.logoUrl,
        phone: quote.site.phone ?? org.phone,
        whatsapp: quote.site.whatsappNumber,
        address: quote.site.address ?? org.address,
        siteName: quote.site.name,
      },
      number: quote.number,
      version: quote.version,
      validUntil: quote.validUntil,
      customerName: quote.customer.displayName,
      vehicle: quote.vehicle,
      total,
      insuranceShare: quote.insuranceShare,
      acceptedTotal: quote.acceptedTotal,
      decidedAt: quote.decidedAt,
      signerName: quote.signerName,
      depositAmount: quote.depositAmount,
      depositRule: org.quotes.depositRule,
      requireSignature:
        org.quotes.requireSignature || total >= SIGNATURE_ALWAYS_REQUIRED_ABOVE,
      showLinePrices: showPrices,
      terms: org.quotes.termsText,
      contentHash: hash,
      groups: groups.map((g) => ({
        key: g.key,
        label: g.label,
        priority: g.priority,
        isOptional: g.isOptional,
        requiresGroupKey: g.requiresGroupKey,
        total: g.total,
        accepted: g.accepted,
        explanation: g.lines.find((l) => l.customerExplanation)?.customerExplanation ?? null,
        photos: [...new Set(g.lines.flatMap((l) => l.photoAttachmentIds))].map(
          (id) => `/api/portail/${input.token}/photos/${id}`,
        ),
        lines: g.lines.map((l) => ({
          id: l.id,
          type: l.type,
          description: l.description,
          quantity: l.quantity,
          unitPrice: showPrices ? l.unitPrice : null,
          discountRate: l.discountRate,
          total: showPrices ? (l.payer === "WARRANTY" ? 0 : l.lineTotal) : null,
          payer: l.payer,
          accepted: l.accepted,
          declineReason: l.declineReason,
        })),
      })),
    };
  }),

  /** US-M05-05 — décision par groupe + signature ; `QUOTE_CHANGED` si le contenu a bougé. */
  decide: publicProcedure.input(portalQuoteDecideInputSchema).mutation(async ({ ctx, input }) => {
    const now = quoteNow();
    rateLimit(input.token, now);
    const token = await requireToken(input.token, now, false);
    const org = await loadOrgQuoteContext(token.organizationId);
    const tenantDb = db.forTenant({ organizationId: token.organizationId });
    const quote = await tenantDb.quote.findFirst({
      where: { id: token.quoteId, deletedAt: null },
      include: { lines: true },
    });
    if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Devis introuvable." });
    const today = businessDate(now, org.timeZone);

    // §11 : double clic → renvoie la décision déjà enregistrée.
    if (["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED", "CONVERTED"].includes(quote.status)) {
      return { status: quote.status, acceptedTotal: quote.acceptedTotal, deposit: quote.depositAmount, alreadyDecided: true as const };
    }
    if (quote.supersededAt) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Le devis a été mis à jour. Vérifiez les nouveaux montants.",
        cause: { code: "QUOTE_CHANGED" },
      });
    }
    if (quote.status === "EXPIRED" || isQuoteExpired(quote.validUntil, today)) {
      await tenantDb.transaction((tx) =>
        notify(tx, token.organizationId, [quote.createdById], {
          type: "quote.refresh_requested",
          title: `Le client souhaite actualiser le devis expiré ${quote.number}`,
          link: `/devis/${quote.id}`,
          dedupeKey: `quote.refresh:${quote.id}:${today.toISOString().slice(0, 10)}`,
        }),
      );
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Ce devis a expiré. Le garage a été prévenu pour l'actualiser.",
        cause: { code: "QUOTE_EXPIRED" },
      });
    }
    if (!["SENT", "VIEWED"].includes(quote.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Ce devis ne peut pas être validé en ligne." });
    }
    const currentHash = quoteDecisionHash(quote.lines, quote.total);
    if (currentHash !== input.contentHash) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Le devis a été mis à jour. Vérifiez les nouveaux montants.",
        cause: { code: "QUOTE_CHANGED" },
      });
    }
    const total = quote.customerShare || quote.total;
    const signatureRequired =
      org.quotes.requireSignature || total >= SIGNATURE_ALWAYS_REQUIRED_ABOVE;
    const anyAccepted = input.accepted !== false && input.decisions.some((d) => d.accepted);
    if (signatureRequired && anyAccepted && !input.signatureDataUrl) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Votre signature est requise pour valider." });
    }

    const out = await tenantDb.transaction(async (tx) => {
      const signatureUrl = input.signatureDataUrl
        ? await storeQuoteSignature(tx, token.organizationId, quote.id, input.signatureDataUrl, null)
        : null;
      const decisions =
        input.accepted === false
          ? quote.lines.map((l) => ({ lineId: l.id, accepted: false, declineReason: input.declineReason ?? "OTHER" }))
          : input.decisions.map((d) => ({
              groupKey: d.groupKey,
              accepted: d.accepted,
              declineReason: d.accepted ? null : (input.declineReason ?? null),
            }));
      const result = await applyQuoteDecision(tx, org, quote, decisions, {
        channel: "portal",
        signerName: input.signerName,
        signatureUrl,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        declineReason: input.declineComment
          ? `${input.declineReason ?? "OTHER"} : ${input.declineComment}`
          : (input.declineReason ?? null),
        byGroup: true,
      }, now);
      await notify(tx, token.organizationId, result.notifyMembershipIds, {
        type: "quote.decided",
        title:
          result.status === "DECLINED"
            ? `Devis ${quote.number} refusé par le client`
            : `Devis ${quote.number} accepté par le client (${result.acceptedTotal.toLocaleString("fr-FR")} FCFA)`,
        link: `/devis/${quote.id}`,
        dedupeKey: `quote.decided:${quote.id}:${now.getTime()}`,
      });
      return result;
    });
    return {
      status: out.status,
      acceptedTotal: out.acceptedTotal,
      deposit:
        out.depositAmount > 0
          ? out.depositAmount
          : depositAmount({ acceptedTotal: out.acceptedTotal, rule: org.quotes.depositRule }) || null,
      alreadyDecided: false as const,
    };
  }),

  /** US-M05-06 — question libre (boîte de réception M11) ou demande de rappel. */
  ask: publicProcedure.input(portalQuoteAskInputSchema).mutation(async ({ input }) => {
    const now = quoteNow();
    rateLimit(input.token, now);
    const token = await requireToken(input.token, now, false);
    const tenantDb = db.forTenant({ organizationId: token.organizationId });
    const quote = await tenantDb.quote.findFirst({
      where: { id: token.quoteId },
      include: { customer: { select: { id: true, displayName: true, phone: true } } },
    });
    if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Devis introuvable." });
    const messageIds: string[] = [];
    await tenantDb.transaction(async (tx) => {
      if (input.message) {
        const address = quote.customer.phone ?? `portail:${quote.customer.id}`;
        const conversation =
          (await tx.conversation.findFirst({
            where: { channel: "WHATSAPP", externalAddress: address },
          })) ??
          (await tx.conversation.create({
            data: {
              organizationId: token.organizationId,
              customerId: quote.customerId,
              channel: "WHATSAPP",
              externalAddress: address,
              lastMessageAt: now,
              lastInboundAt: now,
              unreadCount: 0,
            },
          }));
        const message = await tx.message.create({
          data: {
            organizationId: token.organizationId,
            conversationId: conversation.id,
            customerId: quote.customerId,
            direction: "INBOUND",
            channel: "WHATSAPP",
            to: "",
            from: address,
            body: `[Devis ${quote.number}] ${input.message}`,
            status: "RECEIVED",
            provider: "portal",
            kind: "CONVERSATION",
            intent: "QUOTE_QUESTION",
          },
        });
        messageIds.push(message.id);
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: now, lastInboundAt: now, unreadCount: { increment: 1 }, status: "OPEN" },
        });
        await emitDomainEvent(tx as never, token.organizationId, "message.inbound_received", {
          messageId: message.id,
          customerId: quote.customerId,
          address,
          quoteId: quote.id,
          intent: "QUOTE_QUESTION",
        });
      }
      await notify(tx, token.organizationId, [quote.createdById], {
        type: input.callback ? "quote.callback_requested" : "quote.question",
        title: input.callback
          ? `Rappeler ${quote.customer.displayName} au sujet du devis ${quote.number}`
          : `Question de ${quote.customer.displayName} sur le devis ${quote.number}`,
        body: input.message ?? undefined,
        link: `/devis/${quote.id}`,
      });
    });
    await flushMessages([]);
    return { ok: true as const, messageIds };
  }),
});

