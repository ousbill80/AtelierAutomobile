// M08 §7 — données du PDF facture (A4), sans dépendance au moteur de rendu : partagées par les
// routes REST d'apps/web et par l'export complet de M15 (apps/worker, RG-M15-21).
import { formatDate } from "@atelieros/core";
import type { Invoice } from "@prisma/client";
import type { ScopedTenantClient } from "../tenant";

type Tx = ScopedTenantClient;

/** Identité du garage imprimée sur la facture. */
export interface InvoicePdfGarage {
  name: string;
  legalName: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  rccm: string | null;
  ncc: string | null;
  taxRegime: string;
  invoiceFooter: string | null;
  vatEnabled: boolean;
}

/** Lecture d'une pièce jointe (QR FNE importé) depuis le stockage objet. */
export type AttachmentBytesReader = (key: string) => Promise<Uint8Array>;

function paymentTerms(invoice: Invoice, terms: number): string {
  if (invoice.type === "CREDIT_NOTE")
    return "Avoir à valoir sur vos prochaines factures ou remboursable.";
  if (terms <= 0) return "Paiement comptant à réception de la facture.";
  return `Paiement à ${terms} jours, au plus tard le ${invoice.dueDate ? formatDate(invoice.dueDate, "UTC") : "—"}.`;
}

/** QR FNE importé en image (RG-M08-17, `Attachment kind = "fne_qr"`) → data URL pour le PDF. */
async function fneQrCodeFor(
  tx: Tx,
  qrCode: string | null,
  readBytes: AttachmentBytesReader,
): Promise<string | null> {
  if (!qrCode?.startsWith("attachment:")) return qrCode;
  const attachment = await tx.attachment.findFirst({
    where: { id: qrCode.slice("attachment:".length), kind: "fne_qr" },
  });
  if (!attachment) return null;
  try {
    const bytes = await readBytes(attachment.url);
    return `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function buildInvoicePdfData(
  tx: Tx,
  org: InvoicePdfGarage,
  invoice: Invoice,
  readBytes: AttachmentBytesReader,
) {
  const [lines, customer, vehicle, order, credited] = await Promise.all([
    tx.invoiceLine.findMany({
      where: { invoiceId: invoice.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    tx.customer.findFirstOrThrow({ where: { id: invoice.customerId } }),
    invoice.vehicleId ? tx.vehicle.findFirst({ where: { id: invoice.vehicleId } }) : null,
    invoice.repairOrderId
      ? tx.repairOrder.findFirst({ where: { id: invoice.repairOrderId }, select: { number: true } })
      : null,
    invoice.creditedInvoiceId
      ? tx.invoice.findFirst({ where: { id: invoice.creditedInvoiceId }, select: { number: true } })
      : null,
  ]);
  return {
    kind: invoice.type,
    number: invoice.number,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
    garage: {
      name: org.name,
      legalName: org.legalName,
      address: [org.address, org.city].filter(Boolean).join(", ") || null,
      phone: org.phone,
      email: org.email,
      rccm: org.rccm,
      ncc: org.ncc,
      taxRegime: org.taxRegime,
      footer: org.invoiceFooter,
    },
    customer: {
      displayName: customer.displayName,
      address: customer.address,
      phone: customer.phone,
      ncc: customer.ncc,
      rccm: customer.rccm,
    },
    vehicle: vehicle
      ? { plate: vehicle.plate, make: vehicle.make, model: vehicle.model, mileage: invoice.mileage }
      : null,
    repairOrderNumber: order?.number ?? null,
    creditedInvoiceNumber: credited?.number ?? null,
    lines: lines.map((l) => ({
      type: l.type,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountRate: l.discountRate,
      vatRate: l.vatRate,
      lineSubtotal: l.lineSubtotal,
      lineTotal: l.lineTotal,
    })),
    totals: {
      subtotal: invoice.subtotal,
      discountTotal: invoice.discountTotal,
      vatTotal: invoice.vatTotal,
      total: invoice.total,
    },
    amountPaid: invoice.amountPaid,
    balance: invoice.balance,
    vatEnabled: org.vatEnabled,
    paymentTerms: paymentTerms(invoice, customer.paymentTermsDays),
    fne: {
      status: invoice.fneStatus,
      number: invoice.fneNumber,
      qrCode: await fneQrCodeFor(tx, invoice.fneQrCode, readBytes),
      certifiedAt: invoice.fneCertifiedAt?.toISOString() ?? null,
    },
    notes: invoice.type === "CREDIT_NOTE" ? `Motif : ${invoice.notes ?? ""}` : invoice.notes,
  };
}
