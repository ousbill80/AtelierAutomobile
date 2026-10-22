// M08 §7 — données des PDF facture (A4) et reçu (ticket 80 mm), communes aux routes REST.
import {
  formatDate,
  METHOD_LABELS,
  readClosingSummary,
  type PaymentMethodLike,
} from "@atelieros/core";
import { renderCashClosingPdf, renderInvoicePdf, renderReceiptPdf } from "@atelieros/pdf";
import { buildInvoicePdfData, type CashSession, type Invoice, type Payment } from "@atelieros/db";
import { sessionSummary } from "../routers/cash";
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

function dateTimeFr(date: Date, timeZone: string) {
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${formatDate(date, timeZone)} ${time}`;
}

function timeFr(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    date,
  );
}

/** M08 §7 — Z de caisse : instantané figé à la clôture, sinon état courant de la session. */
export async function renderCashClosingPdfFor(
  tx: Tx,
  org: OrgBillingContext,
  session: CashSession,
) {
  const [site, people, summary] = await Promise.all([
    tx.site.findFirstOrThrow({ where: { id: session.siteId }, select: { name: true } }),
    tx.cashSession.findFirstOrThrow({
      where: { id: session.id },
      select: {
        openedBy: { select: { user: { select: { name: true } } } },
        closedBy: { select: { user: { select: { name: true } } } },
        reviewedBy: { select: { user: { select: { name: true } } } },
      },
    }),
    sessionSummary(tx, session),
  ]);
  const closing = readClosingSummary(session.closingSummary);
  const byMethod = closing?.byMethod ?? summary.byMethod;
  const denominations = Object.entries((session.denominations ?? {}) as Record<string, number>)
    .map(([value, count]) => ({ value: Number(value), count }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.value - a.value);
  return renderCashClosingPdf({
    garage: {
      name: org.legalName || org.name,
      address: org.address,
      phone: org.phone,
      ncc: org.ncc,
    },
    site: site.name,
    openedAt: dateTimeFr(session.openedAt, org.timeZone),
    closedAt: session.closedAt ? dateTimeFr(session.closedAt, org.timeZone) : null,
    openedBy: people.openedBy.user.name,
    closedBy: people.closedBy?.user.name ?? null,
    lateClose: session.lateClose,
    openingFloat: session.openingFloat,
    byMethod: Object.entries(byMethod)
      .filter(([, amount]) => (amount ?? 0) !== 0)
      .map(([method, amount]) => ({
        label: METHOD_LABELS[method as PaymentMethodLike] ?? method,
        amount: amount ?? 0,
      })),
    totalReceived: closing?.totalReceived ?? summary.totalReceived,
    pendingCheques: closing?.pendingCheques ?? summary.pendingCheques,
    cashPayments: closing?.cashPayments ?? summary.cashPayments,
    expensesTotal: closing?.expensesTotal ?? summary.expensesTotal,
    cashRefunds: closing?.cashRefunds ?? summary.cashRefunds,
    dropsTotal: closing?.dropsTotal ?? summary.dropsTotal,
    expectedCash: session.expectedCash ?? summary.expectedCash,
    countedCash: session.countedCash,
    difference: session.difference,
    notes: session.notes,
    denominations,
    expenses: summary.expenses
      .filter((e) => e.status === "APPROVED")
      .map((e) => ({
        time: timeFr(e.paidAt, org.timeZone),
        category: e.category,
        description: e.description,
        amount: e.amount,
      })),
    drops: summary.drops.map((d) => ({
      time: timeFr(d.createdAt, org.timeZone),
      destination: d.destination === "bank" ? "Banque" : "Coffre",
      reference: d.reference,
      amount: d.amount,
    })),
    counts: closing?.counts ?? {
      payments: summary.payments.length,
      expenses: summary.expenses.filter((e) => e.status === "APPROVED").length,
      drops: summary.drops.length,
      refunds: summary.refunds.length,
    },
    review:
      session.reviewedAt && people.reviewedBy
        ? {
            by: people.reviewedBy.user.name,
            at: dateTimeFr(session.reviewedAt, org.timeZone),
            comment: session.reviewComment,
          }
        : null,
    printedAt: dateTimeFr(org.now, org.timeZone),
  });
}
