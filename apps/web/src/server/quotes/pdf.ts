// M05 §7 — préparation des données du PDF devis (client / expertise / signé) à partir de la
// base ; la mise en page est dans `@atelieros/pdf`. Partagé par la route back-office et la
// route portail (jamais de coût ni de note interne).
import { groupQuoteLines, laborLinePricing } from "@atelieros/core";
import { renderQuotePdf, type QuotePdfData, type QuotePdfVariant } from "@atelieros/pdf";
import { db } from "@atelieros/db";
import { getAttachmentStorage } from "../storage";
import { loadOrgQuoteContext, quoteDeductible } from "./helpers";

async function dataUri(key: string, mimeType: string): Promise<string | null> {
  if (mimeType !== "image/png" && mimeType !== "image/jpeg") return null;
  try {
    const bytes = await getAttachmentStorage().getObjectBytes(key);
    return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function renderQuotePdfFor(
  organizationId: string,
  quoteId: string,
  variant: QuotePdfVariant,
  publicUrl: string | null,
): Promise<{ pdf: Buffer; number: string } | null> {
  const org = await loadOrgQuoteContext(organizationId);
  const tenantDb = db.forTenant({ organizationId });
  const quote = await tenantDb.quote.findFirst({
    where: { id: quoteId, deletedAt: null },
    include: {
      customer: true,
      vehicle: true,
      repairOrder: { select: { number: true, mileageIn: true } },
      insuranceClaim: { include: { insuranceCompany: true } },
      lines: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { product: { select: { sku: true, oemReference: true } }, laborOperation: true },
      },
    },
  });
  if (!quote) return null;
  const deductible = await quoteDeductible(tenantDb as never, quote);
  const visible = quote.lines.filter((l) => l.payer !== "INTERNAL");
  const groups = groupQuoteLines(
    visible,
    visible.map((l) => (l.payer === "WARRANTY" ? 0 : l.lineTotal)),
  );
  const signature = quote.signatureUrl
    ? await tenantDb.attachment.findFirst({
        where: { entity: "quote", entityId: quote.id, kind: "signature" },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const effectiveVariant: QuotePdfVariant =
    variant === "customer" && quote.decidedAt ? "signed" : variant;
  const data: QuotePdfData = {
    variant: effectiveVariant,
    garage: {
      name: org.name,
      address: org.address,
      phone: org.phone,
      rccm: org.rccm,
      ncc: org.ncc,
    },
    number: quote.number,
    version: quote.version,
    createdAt: quote.createdAt.toISOString(),
    validUntil: quote.validUntil.toISOString(),
    customer: {
      displayName: quote.customer.displayName,
      phone: quote.customer.phone,
      ncc: quote.customer.type === "COMPANY" ? quote.customer.ncc : null,
      address: quote.customer.address,
    },
    vehicle: quote.vehicle
      ? {
          plate: quote.vehicle.plate,
          make: quote.vehicle.make,
          model: quote.vehicle.model,
          year: quote.vehicle.year,
          mileage: quote.repairOrder?.mileageIn ?? quote.vehicle.currentMileage,
        }
      : null,
    repairOrderNumber: quote.repairOrder?.number ?? null,
    groups: groups.map((g) => ({
      label: g.label,
      priority: g.priority,
      isOptional: g.isOptional,
      explanation: g.lines.find((l) => l.customerExplanation)?.customerExplanation ?? null,
      total: g.total,
      accepted: g.accepted,
      lines: g.lines.map((l) => ({
        type: l.type,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountRate: l.discountRate,
        vatRate: l.vatRate,
        total: l.payer === "WARRANTY" ? 0 : l.lineTotal,
        payer: l.payer,
        isOptional: l.isOptional,
        accepted: l.accepted,
        reference: l.product?.oemReference ?? l.product?.sku ?? l.laborOperation?.code ?? null,
        hours: l.type === "LABOR" ? l.quantity : null,
        rate:
          l.type === "LABOR" && l.laborOperation
            ? laborLinePricing(l.laborOperation, org.laborRates).unitPrice
            : null,
      })),
    })),
    totals: {
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      vatTotal: quote.vatTotal,
      total: quote.total,
      acceptedTotal: quote.acceptedTotal,
      insuranceShare: quote.insuranceShare,
      customerShare: quote.customerShare,
      deductible,
    },
    terms: org.quotes.termsText,
    status: quote.status,
    decision: quote.decidedAt
      ? {
          signerName: quote.signerName ?? quote.decisionCounterpart,
          decidedAt: quote.decidedAt.toISOString(),
          channel: quote.decisionChannel,
          hash: quote.decisionHash,
          signatureImage: signature ? await dataUri(signature.url, signature.mimeType) : null,
        }
      : null,
    publicUrl,
    insurer: quote.insuranceClaim
      ? { name: quote.insuranceClaim.insuranceCompany.name, claimNumber: quote.insuranceClaim.claimNumber }
      : null,
  };
  return { pdf: await renderQuotePdf(data), number: quote.number };
}
