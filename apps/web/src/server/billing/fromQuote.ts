// US-M08-02 / US-M05-11 — facture brouillon depuis un devis accepté sans OR (vente comptoir) :
// seules les lignes acceptées sont reprises ; le devis passe CONVERTED.
import type { DraftInvoiceLine } from "@atelieros/core";
import type { Quote } from "@atelieros/db";
import { emitDomainEvent } from "../events/emit";
import { audit, bad, createDraft, type Actor, type OrgBillingContext, type Tx } from "./service";

export async function createDraftFromQuote(
  tx: Tx,
  actor: Actor,
  org: OrgBillingContext,
  quote: Quote,
) {
  if (!["ACCEPTED", "PARTIALLY_ACCEPTED"].includes(quote.status)) {
    bad("Le devis doit être accepté (totalement ou partiellement) pour être facturé.");
  }
  if (quote.repairOrderId) bad("Ce devis est lié à un OR : la facture se fait depuis l'OR.");
  const lines = await tx.quoteLine.findMany({
    where: { quoteId: quote.id, accepted: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { product: { select: { averageCost: true } } },
  });
  const billable = lines.filter((l) => l.payer === "CUSTOMER" || l.payer === "INSURANCE");
  if (billable.length === 0) bad("Aucune ligne acceptée à facturer.");
  const drafts: DraftInvoiceLine[] = billable.map((l) => ({
    type: l.type,
    productId: l.productId,
    laborOperationId: l.laborOperationId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.isCustomerSupplied ? 0 : l.unitPrice,
    discountRate: l.discountRate,
    vatRate: l.vatRate,
    payer: "CUSTOMER",
    repairOrderLineId: null,
    depositInvoiceId: null,
    unitCost: l.product?.averageCost ?? l.costPrice ?? null,
    fixed: null,
  }));
  const invoice = await createDraft(
    tx,
    org,
    {
      siteId: quote.siteId,
      customerId: quote.customerId,
      vehicleId: quote.vehicleId,
      quoteId: quote.id,
      notes: quote.customerPoNumber ? `Bon de commande client : ${quote.customerPoNumber}` : null,
      createdById: actor.membershipId,
    },
    drafts,
  );
  await tx.quote.update({
    where: { id: quote.id },
    data: { status: "CONVERTED", convertedAt: org.now },
  });
  await emitDomainEvent(tx as never, org.id, "quote.converted", {
    quoteId: quote.id,
    invoiceId: invoice.id,
  });
  await audit(actor, "quote.converted_to_invoice", "Quote", quote.id, {
    after: { invoiceId: invoice.id },
  });
  return invoice;
}
