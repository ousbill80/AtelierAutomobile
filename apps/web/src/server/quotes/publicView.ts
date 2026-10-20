// M05 US-M05-05 / M14 RG-M14-08 — vue client d'un devis : même rendu sur le portail public
// et pour l'aperçu du personnel (`quote.preview`). Jamais de coûts, marges ni notes internes.
import {
  businessDate,
  groupQuoteLines,
  isInvoicePayable,
  isPastValidity,
  signatureRequired,
  type QuoteStatus,
} from "@atelieros/core";
import { adminDb, type Quote } from "@atelieros/db";
import { quoteContentHash, totalsFor, type OrgQuoteContext, type Tx } from "./service";

export async function buildQuotePublicView(
  tx: Tx,
  org: OrgQuoteContext,
  quote: Quote,
  now: Date,
  options: { requestedQuoteId?: string } = {},
) {
  const [lines, customer, vehicle, site, organization] = await Promise.all([
    tx.quoteLine.findMany({
      where: { quoteId: quote.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    tx.customer.findFirstOrThrow({ where: { id: quote.customerId } }),
    quote.vehicleId ? tx.vehicle.findFirst({ where: { id: quote.vehicleId } }) : null,
    tx.site.findFirst({ where: { id: quote.siteId } }),
    adminDb.organization.findUniqueOrThrow({
      where: { id: quote.organizationId },
      select: { name: true, phone: true, address: true, logoUrl: true },
    }),
  ]);
  // M08 US-M08-03 / étape 4.3 : acompte payable en ligne une fois sa facture émise.
  const depositInvoice = quote.depositInvoiceId
    ? await tx.invoice.findFirst({
        where: { id: quote.depositInvoiceId },
        select: { status: true, balance: true },
      })
    : null;
  const totals = totalsFor(quote, lines, org.vatEnabled);
  const groups = groupQuoteLines(lines, totals.lines);
  const labelOf = new Map(groups.map((g) => [g.key, g.label]));
  const showLinePrices = org.quotes.showLinePricesToCustomer;
  const today = businessDate(now, org.timeZone);
  const alreadyApproved = quote.repairOrderId
    ? (
        await tx.repairOrderLine.findMany({
          where: {
            repairOrderId: quote.repairOrderId,
            approval: "APPROVED",
            status: { not: "CANCELLED" },
            OR: [{ quoteLineId: null }, { quoteLineId: { notIn: lines.map((l) => l.id) } }],
            payer: { in: ["CUSTOMER", "INSURANCE"] },
          },
          select: { description: true },
        })
      ).map((l) => l.description)
    : [];
  return {
    quoteId: quote.id,
    number: quote.number,
    version: quote.version,
    status: quote.status as QuoteStatus,
    /** Le lien visait une version antérieure (US-M05-08 : « Ce devis a été mis à jour »). */
    updated: Boolean(options.requestedQuoteId && options.requestedQuoteId !== quote.id),
    /** Nouvelle version en préparation, pas encore envoyée. */
    pendingUpdate: quote.status === "DRAFT",
    expired:
      quote.status === "EXPIRED" ||
      ((quote.status === "SENT" || quote.status === "VIEWED") &&
        isPastValidity(quote.validUntil, today)),
    decidable:
      (quote.status === "SENT" || quote.status === "VIEWED") &&
      !isPastValidity(quote.validUntil, today),
    validUntil: quote.validUntil,
    decidedAt: quote.decidedAt,
    decisionChannel: quote.decisionChannel,
    signerName: quote.signerName,
    timeZone: org.timeZone,
    garage: {
      name: organization.name,
      phone: site?.phone ?? organization.phone,
      whatsapp: site?.whatsappNumber ?? site?.phone ?? organization.phone,
      address: site?.address ?? organization.address,
    },
    customerName: customer.displayName,
    vehicle: vehicle ? { plate: vehicle.plate, make: vehicle.make, model: vehicle.model } : null,
    showLinePrices,
    groups: groups.map((g) => ({
      key: g.key,
      label: g.label,
      priority: g.priority,
      isOptional: g.isOptional,
      requiresGroupKey: g.requiresGroupKey,
      requiresLabel: g.requiresGroupKey ? (labelOf.get(g.requiresGroupKey) ?? null) : null,
      explanation: g.explanation,
      photoIds: g.photoIds,
      total: g.total,
      accepted: g.accepted,
      declineReason: g.lines.find((l) => l.declineReason)?.declineReason ?? null,
      lines: g.lines.map((l) => {
        const a = totals.lines.find((x) => x.id === l.id)!;
        return {
          id: l.id,
          type: l.type,
          description: l.description,
          quantity: l.quantity,
          payer: l.payer,
          total: showLinePrices ? (a.billable ? a.total : 0) : null,
          discountRate: l.discountRate,
        };
      }),
    })),
    alreadyApproved,
    totals: {
      total: quote.total,
      discountTotal: quote.discountTotal,
      insuranceShare: quote.insuranceShare,
      customerShare: quote.customerShare,
      acceptedTotal: quote.acceptedTotal,
    },
    requireSignature: signatureRequired(org.quotes.requireSignature, quote.total),
    termsText: org.quotes.termsText,
    depositAmount: quote.depositAmount,
    depositPayable: depositInvoice ? isInvoicePayable(depositInvoice) : false,
    depositPaid: depositInvoice?.status === "PAID",
    contentHash: quoteContentHash(quote, lines),
  };
}

export type QuotePublicView = Awaited<ReturnType<typeof buildQuotePublicView>>;
