// M05 §7 — données du PDF devis (client, assureur, signé), communes à la route back-office,
// à la route du portail et à la pièce jointe de l'envoi par email.
import { groupQuoteLines } from "@atelieros/core";
import { renderQuotePdf, type QuotePdfVariant } from "@atelieros/pdf";
import type { Quote } from "@atelieros/db";
import { getAttachmentStorage } from "../storage";
import { quoteDeductible, totalsFor, type OrgQuoteContext, type Tx } from "./service";

function dateTime(value: Date, timeZone: string): string {
  const d = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
  const t = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
  return `${d} à ${t}`;
}

async function imageDataUri(attachmentUrl: string | null, tx: Tx): Promise<string | null> {
  const id = attachmentUrl?.split("/").pop();
  if (!id) return null;
  const att = await tx.attachment.findFirst({ where: { id } });
  if (!att || (att.mimeType !== "image/png" && att.mimeType !== "image/jpeg")) return null;
  try {
    const bytes = await getAttachmentStorage().getObjectBytes(att.url);
    return `data:${att.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function renderQuotePdfFor(
  tx: Tx,
  org: OrgQuoteContext,
  quote: Quote,
  variant: QuotePdfVariant,
  publicUrl?: string | null,
): Promise<Buffer> {
  const [lines, customer, vehicle] = await Promise.all([
    tx.quoteLine.findMany({
      where: { quoteId: quote.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: {
        product: { select: { sku: true, oemReference: true } },
        laborOperation: { select: { code: true } },
      },
    }),
    tx.customer.findFirstOrThrow({ where: { id: quote.customerId } }),
    quote.vehicleId ? tx.vehicle.findFirst({ where: { id: quote.vehicleId } }) : null,
  ]);
  const totals = totalsFor(quote, lines, org.vatEnabled);
  const groups = groupQuoteLines(lines, totals.lines);
  const decided = ["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED", "CONVERTED"].includes(
    quote.status,
  );
  const effectiveVariant: QuotePdfVariant = variant === "signed" && !decided ? "customer" : variant;
  return renderQuotePdf({
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
    customer: { displayName: customer.displayName, ncc: customer.ncc, phone: customer.phone },
    vehicle: vehicle
      ? {
          plate: vehicle.plate,
          make: vehicle.make,
          model: vehicle.model,
          mileage: vehicle.currentMileage,
        }
      : null,
    groups: groups.map((g) => ({
      label: g.label,
      priority: g.priority,
      isOptional: g.isOptional,
      total: g.total,
      lines: g.lines.map((l) => {
        const a = totals.lines.find((x) => x.id === l.id)!;
        return {
          type: l.type,
          description: l.description,
          reference: l.product?.oemReference ?? l.product?.sku ?? l.laborOperation?.code ?? null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountRate: l.discountRate,
          total: a.billable ? a.total : 0,
          payer: l.payer,
          accepted: l.accepted,
        };
      }),
    })),
    totals: {
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      vatTotal: quote.vatTotal,
      total: quote.total,
      insuranceShare: quote.insuranceShare,
      customerShare: quote.customerShare,
      acceptedTotal: quote.acceptedTotal,
    },
    deductible: await quoteDeductible(tx, quote),
    termsText: org.quotes.termsText,
    acceptance:
      effectiveVariant === "signed" && quote.decidedAt
        ? {
            signerName: quote.signerName,
            decidedAt: dateTime(quote.decidedAt, org.timeZone),
            channel: quote.decisionChannel,
            hash: quote.decisionHash,
            ip: quote.decisionIp,
            signature: await imageDataUri(quote.signatureUrl, tx),
          }
        : null,
    publicUrl: publicUrl ?? null,
  });
}

/** Nom de fichier du PDF. */
export function quotePdfFilename(
  quote: Pick<Quote, "number" | "version">,
  variant: QuotePdfVariant,
) {
  const prefix =
    variant === "insurer" ? "devis-expertise" : variant === "signed" ? "devis-signe" : "devis";
  return `${prefix}-${quote.number}-v${quote.version}.pdf`;
}
