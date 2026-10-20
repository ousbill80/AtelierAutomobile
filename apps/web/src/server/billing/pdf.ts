// M08 §7 — données des PDF facture (A4) et reçu (ticket 80 mm), communes aux routes REST.
import { formatDate, METHOD_LABELS, type PaymentMethodLike } from "@atelieros/core";
import { renderInvoicePdf, renderReceiptPdf } from "@atelieros/pdf";
import { buildInvoicePdfData, type Invoice, type Payment } from "@atelieros/db";
import { getAttachmentStorage } from "../storage";
import type { OrgBillingContext, Tx } from "./service";

export async function renderInvoicePdfFor(tx: Tx, org: OrgBillingContext, invoice: Invoice) {
  const storage = getAttachmentStorage();
  return renderInvoicePdf(
    await buildInvoicePdfData(tx, org, invoice, (key) => storage.getObjectBytes(key)),
  );
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
