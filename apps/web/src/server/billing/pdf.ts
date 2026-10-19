// M08 §7 — données des PDF facture (A4) et reçu (ticket 80 mm), communes aux routes REST.
import { formatDate, METHOD_LABELS, type PaymentMethodLike } from "@atelieros/core";
import { renderInvoicePdf, renderReceiptPdf } from "@atelieros/pdf";
import type { Invoice, Payment } from "@atelieros/db";
import type { OrgBillingContext, Tx } from "./service";

function paymentTerms(invoice: Invoice, terms: number): string {
  if (invoice.type === "CREDIT_NOTE")
    return "Avoir à valoir sur vos prochaines factures ou remboursable.";
  if (terms <= 0) return "Paiement comptant à réception de la facture.";
  return `Paiement à ${terms} jours, au plus tard le ${invoice.dueDate ? formatDate(invoice.dueDate, "UTC") : "—"}.`;
}

export async function renderInvoicePdfFor(tx: Tx, org: OrgBillingContext, invoice: Invoice) {
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
  return renderInvoicePdf({
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
    fne: { status: invoice.fneStatus, number: invoice.fneNumber, qrCode: invoice.fneQrCode },
    notes: invoice.type === "CREDIT_NOTE" ? `Motif : ${invoice.notes ?? ""}` : invoice.notes,
  });
}

export async function renderReceiptPdfFor(tx: Tx, org: OrgBillingContext, payment: Payment) {
  const [customer, allocations, cashier] = await Promise.all([
    payment.customerId
      ? tx.customer.findFirst({ where: { id: payment.customerId }, select: { displayName: true } })
      : null,
    tx.paymentAllocation.findMany({
      where: { paymentId: payment.id, voidedAt: null },
      include: { invoice: { select: { number: true, balance: true } } },
    }),
    payment.receivedById
      ? tx.membership.findFirst({
          where: { id: payment.receivedById },
          select: { user: { select: { name: true } } },
        })
      : null,
  ]);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: org.timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(payment.receivedAt);
  return renderReceiptPdf({
    number: payment.number,
    receivedAt: `${formatDate(payment.receivedAt, org.timeZone)} ${time}`,
    garage: {
      name: org.legalName || org.name,
      address: org.address,
      phone: org.phone,
      ncc: org.ncc,
    },
    customer: customer?.displayName ?? "—",
    method: METHOD_LABELS[payment.method as PaymentMethodLike],
    reference: payment.reference,
    amount: payment.amount,
    status: payment.status,
    allocations: allocations.map((a) => ({
      invoiceNumber: a.invoice.number ?? "—",
      amount: a.amount,
      balanceAfter: a.invoice.balance,
    })),
    unallocated: payment.unallocated,
    cashier: cashier?.user.name ?? null,
  });
}
