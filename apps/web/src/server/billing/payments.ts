// M08 — encaissements au comptoir (RG-M08-18..22, 26) : contrôle de la méthode et de la caisse,
// affectation multi-factures, chèques en attente, annulation, remboursements, crédits clients.
// Après chaque mouvement : solde des factures (RG-M08-10) puis recouvrement M09 et événement.
import { TRPCError } from "@trpc/server";
import {
  allocatePayment,
  checkPaymentInput,
  checkRefund,
  duplicateReferenceMessage,
  formatFCFA,
  type AllocationLine,
  type PaymentMethodLike,
} from "@atelieros/core";
import { attributeAllocations, evaluateCasePromises, type Payment } from "@atelieros/db";
import { emitDomainEvent } from "../events/emit";
import {
  audit,
  bad,
  guard,
  nextFiscalNumber,
  recomputeInvoiceBalance,
  syncReceivables,
  type Actor,
  type OrgBillingContext,
  type Tx,
} from "./service";

const ALLOCATABLE = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] as const;

export function receiptUrl(paymentId: string): string {
  return `/api/caisse/recus/${paymentId}/pdf`;
}

/** Session de caisse ouverte sur le site (RG-M08-27 : au plus une par site par défaut). */
export async function openCashSession(tx: Tx, siteId: string, membershipId?: string) {
  const sessions = await tx.cashSession.findMany({
    where: { siteId, closedAt: null },
    orderBy: { openedAt: "asc" },
  });
  return sessions.find((s) => s.openedById === membershipId) ?? sessions[0] ?? null;
}

/**
 * Factures ouvertes du client, avec un solde « affectable » qui retranche les affectations de
 * chèques encore en attente (RG-M08-20) pour ne jamais affecter deux fois le même reste dû.
 */
export async function allocatableInvoices(tx: Tx, customerId: string) {
  const invoices = await tx.invoice.findMany({
    where: {
      customerId,
      billTo: "CUSTOMER",
      type: { in: ["INVOICE", "DEPOSIT"] },
      status: { in: [...ALLOCATABLE] },
    },
  });
  if (invoices.length === 0) return [];
  const pending = await tx.paymentAllocation.findMany({
    where: {
      invoiceId: { in: invoices.map((i) => i.id) },
      voidedAt: null,
      payment: { status: "PENDING" },
    },
    select: { invoiceId: true, amount: true },
  });
  const pendingBy = new Map<string, number>();
  for (const p of pending) pendingBy.set(p.invoiceId, (pendingBy.get(p.invoiceId) ?? 0) + p.amount);
  return invoices.map((i) => ({
    ...i,
    balance: Math.max(0, i.balance - (pendingBy.get(i.id) ?? 0)),
  }));
}

export async function planAllocation(
  tx: Tx,
  input: {
    customerId: string;
    amount: number;
    currentInvoiceId?: string | null;
    explicit?: AllocationLine[];
  },
) {
  const invoices = await allocatableInvoices(tx, input.customerId);
  const explicitIds = (input.explicit ?? []).map((a) => a.invoiceId);
  if (explicitIds.some((id) => !invoices.some((i) => i.id === id))) {
    const blocked = await tx.invoice.findFirst({
      where: { id: { in: explicitIds }, status: { in: ["DISPUTED", "WRITTEN_OFF"] } },
      select: { number: true },
    });
    if (blocked) {
      bad(
        `Facture ${blocked.number} en litige ou passée en perte : résolvez-la avant d'y affecter un paiement.`,
      );
    }
    bad("Facture introuvable ou déjà soldée pour ce client.");
  }
  const plan = guard(() =>
    allocatePayment({
      amount: input.amount,
      invoices,
      explicit: input.explicit,
      currentInvoiceId: input.currentInvoiceId,
    }),
  );
  return { plan, invoices };
}

/** M09 : attribution aux relances (A10), promesses et dossier ; événement `payment.received`. */
async function afterConfirmedAllocations(
  tx: Tx,
  org: OrgBillingContext,
  input: {
    customerId: string;
    paymentId: string | null;
    amount: number;
    receivedAt: Date;
    allocations: { id: string; amount: number }[];
  },
) {
  const activeCase = await tx.collectionCase.findFirst({
    where: {
      customerId: input.customerId,
      status: { in: ["OPEN", "PROMISED", "PAUSED", "DISPUTED", "ESCALATED"] },
    },
  });
  if (input.paymentId && input.allocations.length > 0) {
    await attributeAllocations(tx, {
      organizationId: org.id,
      customerId: input.customerId,
      receivedAt: input.receivedAt,
      attributionDays: org.collection.attributionDays,
      allocations: input.allocations,
    });
  }
  if (activeCase) {
    await evaluateCasePromises(tx, {
      organizationId: org.id,
      caseId: activeCase.id,
      today: org.today,
      now: org.now,
      graceDays: org.collection.graceDays,
    });
  }
  await syncReceivables(tx, org, input.customerId);
  if (input.paymentId) {
    await emitDomainEvent(tx as never, org.id, "payment.received", {
      paymentId: input.paymentId,
      customerId: input.customerId,
      caseId: activeCase?.id ?? null,
      amount: input.amount,
    });
  }
}

async function writeAllocations(
  tx: Tx,
  org: OrgBillingContext,
  input: { paymentId: string | null; creditId: string | null; lines: AllocationLine[] },
) {
  const created: { id: string; amount: number }[] = [];
  for (const line of input.lines) {
    const allocation = await tx.paymentAllocation.create({
      data: {
        organizationId: org.id,
        paymentId: input.paymentId,
        customerCreditId: input.creditId,
        invoiceId: line.invoiceId,
        amount: line.amount,
      },
    });
    created.push({ id: allocation.id, amount: line.amount });
    await recomputeInvoiceBalance(tx, line.invoiceId, org.today);
  }
  return created;
}

export interface CounterPaymentInput {
  siteId: string;
  customerId: string;
  method: PaymentMethodLike;
  amount: number;
  reference?: string | null;
  payerPhone?: string | null;
  currentInvoiceId?: string | null;
  allocations?: AllocationLine[];
  notes?: string | null;
}

/** US-M08-06/07/08 — encaissement au comptoir avec reçu REC-…. */
export async function recordCounterPayment(
  tx: Tx,
  actor: Actor,
  org: OrgBillingContext,
  input: CounterPaymentInput,
) {
  const customer = await tx.customer.findFirst({ where: { id: input.customerId } });
  if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "Client introuvable." });
  const session = await openCashSession(tx, input.siteId, actor.membershipId);
  const checked = guard(() =>
    checkPaymentInput({
      method: input.method,
      amount: input.amount,
      reference: input.reference,
      hasOpenCashSession: Boolean(session),
    }),
  );
  if (checked.reference && input.method !== "CASH") {
    // RG-M08-26 : une même référence mobile money / chèque / virement n'est saisie qu'une fois.
    const duplicate = await tx.payment.findFirst({
      where: {
        method: input.method,
        reference: { equals: checked.reference, mode: "insensitive" },
        voidedAt: null,
        status: { not: "FAILED" },
      },
      select: { number: true },
    });
    if (duplicate) {
      throw new TRPCError({
        code: "CONFLICT",
        message: duplicateReferenceMessage(input.method, duplicate.number),
      });
    }
  }
  const { plan } = await planAllocation(tx, {
    customerId: customer.id,
    amount: input.amount,
    currentInvoiceId: input.currentInvoiceId,
    explicit: input.allocations,
  });
  const receivedAt = org.now;
  const number = await nextFiscalNumber(
    tx,
    org,
    "REC",
    Number(org.today.toISOString().slice(0, 4)),
  );
  const payment = await tx.payment.create({
    data: {
      organizationId: org.id,
      siteId: input.siteId,
      customerId: customer.id,
      number,
      method: input.method,
      amount: input.amount,
      receivedAt,
      reference: checked.reference,
      status: checked.status,
      provider: "manual",
      cashSessionId: session?.id ?? null,
      receivedById: actor.membershipId,
      unallocated: plan.unallocated,
      payerPhone: input.payerPhone ?? null,
      notes: input.notes ?? null,
    },
  });
  const created = await writeAllocations(tx, org, {
    paymentId: payment.id,
    creditId: null,
    lines: plan.allocations,
  });
  if (checked.status === "CONFIRMED") {
    await afterConfirmedAllocations(tx, org, {
      customerId: customer.id,
      paymentId: payment.id,
      amount: input.amount,
      receivedAt,
      allocations: created,
    });
  }
  await audit(actor, "payment.created", "Payment", payment.id, {
    siteId: input.siteId,
    after: {
      number,
      method: input.method,
      amount: input.amount,
      allocations: plan.allocations,
      unallocated: plan.unallocated,
    },
  });
  return {
    payment,
    allocations: plan.allocations,
    unallocated: plan.unallocated,
    receiptUrl: receiptUrl(payment.id),
  };
}

/** RG-M08-19 — affectation ultérieure d'un reliquat (`unallocated`) ou d'un crédit client. */
export async function allocateLater(
  tx: Tx,
  actor: Actor,
  org: OrgBillingContext,
  input: { paymentId?: string; creditId?: string; allocations: AllocationLine[] },
) {
  const total = input.allocations.reduce((s, a) => s + a.amount, 0);
  let customerId: string;
  let available: number;
  let payment: Payment | null = null;
  if (input.paymentId) {
    payment = await tx.payment.findFirst({ where: { id: input.paymentId } });
    if (!payment || !payment.customerId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Paiement introuvable." });
    }
    if (payment.status !== "CONFIRMED" || payment.voidedAt) {
      bad("Seul un paiement confirmé peut être affecté.");
    }
    customerId = payment.customerId;
    available = payment.unallocated;
  } else {
    const credit = await tx.customerCredit.findFirst({ where: { id: input.creditId } });
    if (!credit) throw new TRPCError({ code: "NOT_FOUND", message: "Crédit client introuvable." });
    customerId = credit.customerId;
    available = credit.remaining;
  }
  if (total > available) {
    bad(`Le montant affecté dépasse le disponible (${formatFCFA(available)}).`);
  }
  const { plan } = await planAllocation(tx, {
    customerId,
    amount: total,
    explicit: input.allocations,
  });
  const created = await writeAllocations(tx, org, {
    paymentId: input.paymentId ?? null,
    creditId: input.creditId ?? null,
    lines: plan.allocations,
  });
  if (payment) {
    await tx.payment.update({
      where: { id: payment.id },
      data: { unallocated: payment.unallocated - total },
    });
  } else {
    await tx.customerCredit.update({
      where: { id: input.creditId! },
      data: { remaining: available - total },
    });
  }
  await afterConfirmedAllocations(tx, org, {
    customerId,
    paymentId: payment?.id ?? null,
    amount: total,
    receivedAt: payment?.receivedAt ?? org.now,
    allocations: created,
  });
  await audit(
    actor,
    "payment.allocated",
    payment ? "Payment" : "CustomerCredit",
    payment?.id ?? input.creditId!,
    {
      after: { allocations: plan.allocations },
    },
  );
  return { allocations: plan.allocations };
}

/** Retire les affectations d'un paiement et recalcule les factures concernées. */
async function voidAllocations(tx: Tx, org: OrgBillingContext, paymentId: string) {
  const allocations = await tx.paymentAllocation.findMany({
    where: { paymentId, voidedAt: null },
    select: { id: true, invoiceId: true },
  });
  await tx.paymentAllocation.updateMany({
    where: { paymentId, voidedAt: null },
    data: { voidedAt: org.now },
  });
  for (const invoiceId of new Set(allocations.map((a) => a.invoiceId))) {
    await recomputeInvoiceBalance(tx, invoiceId, org.today);
  }
}

/**
 * RG-M08-21 — annulation d'une saisie erronée : motif, affectations retirées, numéro de reçu
 * conservé. Le paiement passe `FAILED` (+ `voidedAt`) pour sortir de tous les cumuls.
 */
export async function voidPayment(
  tx: Tx,
  actor: Actor,
  org: OrgBillingContext,
  input: { id: string; reason: string },
) {
  const payment = await tx.payment.findFirst({ where: { id: input.id } });
  if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Paiement introuvable." });
  if (payment.voidedAt) bad("Ce paiement est déjà annulé.");
  if (payment.status === "REFUNDED")
    bad("Ce paiement a été remboursé : il ne peut plus être annulé.");
  const refunds = await tx.refund.count({ where: { paymentId: payment.id } });
  if (refunds > 0)
    bad("Ce paiement a fait l'objet d'un remboursement : il ne peut plus être annulé.");
  if (payment.cashSessionId && payment.method === "CASH") {
    const session = await tx.cashSession.findFirst({ where: { id: payment.cashSessionId } });
    if (session?.closedAt)
      bad("La caisse de ce paiement est clôturée : il ne peut plus être annulé.");
  }
  await voidAllocations(tx, org, payment.id);
  const updated = await tx.payment.update({
    where: { id: payment.id },
    data: { status: "FAILED", voidedAt: org.now, voidReason: input.reason, unallocated: 0 },
  });
  if (payment.customerId) await syncReceivables(tx, org, payment.customerId);
  await emitDomainEvent(tx as never, org.id, "payment.failed", {
    paymentId: payment.id,
    customerId: payment.customerId,
    reason: "voided",
  });
  await audit(actor, "payment.voided", "Payment", payment.id, {
    siteId: payment.siteId,
    before: { status: payment.status, amount: payment.amount },
    after: { status: updated.status },
    reason: input.reason,
  });
  return updated;
}

/** RG-M08-20 — chèque encaissé par la banque : les affectations comptent enfin. */
export async function confirmCheque(tx: Tx, actor: Actor, org: OrgBillingContext, id: string) {
  const payment = await tx.payment.findFirst({ where: { id } });
  if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Paiement introuvable." });
  if (payment.method !== "CHEQUE" || payment.status !== "PENDING") {
    bad("Seul un chèque en attente peut être confirmé.");
  }
  const updated = await tx.payment.update({ where: { id }, data: { status: "CONFIRMED" } });
  const allocations = await tx.paymentAllocation.findMany({
    where: { paymentId: id, voidedAt: null },
    select: { id: true, amount: true, invoiceId: true },
  });
  for (const invoiceId of new Set(allocations.map((a) => a.invoiceId))) {
    await recomputeInvoiceBalance(tx, invoiceId, org.today);
  }
  if (payment.customerId) {
    await afterConfirmedAllocations(tx, org, {
      customerId: payment.customerId,
      paymentId: payment.id,
      amount: payment.amount,
      receivedAt: org.now,
      allocations,
    });
  }
  await audit(actor, "payment.cheque_confirmed", "Payment", id, { siteId: payment.siteId });
  return updated;
}

/** RG-M08-20 — chèque rejeté : `FAILED`, affectations retirées, `payment.failed` (M09 relance). */
export async function failCheque(
  tx: Tx,
  actor: Actor,
  org: OrgBillingContext,
  input: { id: string; reason: string },
) {
  const payment = await tx.payment.findFirst({ where: { id: input.id } });
  if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Paiement introuvable." });
  if (payment.method !== "CHEQUE" || !["PENDING", "CONFIRMED"].includes(payment.status)) {
    bad("Seul un chèque en attente ou encaissé peut être rejeté.");
  }
  await voidAllocations(tx, org, payment.id);
  const updated = await tx.payment.update({
    where: { id: payment.id },
    data: { status: "FAILED", unallocated: 0, voidReason: input.reason },
  });
  if (payment.customerId) await syncReceivables(tx, org, payment.customerId);
  await emitDomainEvent(tx as never, org.id, "payment.failed", {
    paymentId: payment.id,
    customerId: payment.customerId,
    reason: "cheque_rejected",
  });
  await audit(actor, "payment.cheque_failed", "Payment", payment.id, {
    siteId: payment.siteId,
    reason: input.reason,
  });
  return updated;
}

/** RG-M08-22 — remboursement d'un trop-perçu (paiement) ou d'un crédit client (avoir payé). */
export async function createRefund(
  tx: Tx,
  actor: Actor,
  org: OrgBillingContext,
  input: {
    paymentId?: string;
    creditId?: string;
    amount: number;
    method: PaymentMethodLike;
    reference?: string | null;
    reason: string;
    siteId: string;
  },
) {
  let customerId: string;
  let available: number;
  let siteId = input.siteId;
  const payment = input.paymentId
    ? await tx.payment.findFirst({ where: { id: input.paymentId } })
    : null;
  const credit = input.creditId
    ? await tx.customerCredit.findFirst({ where: { id: input.creditId } })
    : null;
  if (input.paymentId) {
    if (!payment?.customerId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Paiement introuvable." });
    }
    if (payment.status !== "CONFIRMED" || payment.voidedAt) {
      bad("Seul un paiement confirmé peut être remboursé.");
    }
    customerId = payment.customerId;
    available = payment.unallocated;
    siteId = payment.siteId;
  } else {
    if (!credit) throw new TRPCError({ code: "NOT_FOUND", message: "Crédit client introuvable." });
    customerId = credit.customerId;
    available = credit.remaining;
  }
  const session = await openCashSession(tx, siteId, actor.membershipId);
  const checked = guard(() =>
    checkRefund({
      amount: input.amount,
      available,
      method: input.method,
      reference: input.reference,
      hasOpenCashSession: Boolean(session),
    }),
  );
  const refund = await tx.refund.create({
    data: {
      organizationId: org.id,
      siteId,
      customerId,
      paymentId: payment?.id ?? null,
      customerCreditId: credit?.id ?? null,
      method: input.method,
      amount: input.amount,
      reference: checked.reference,
      cashSessionId: input.method === "CASH" ? session!.id : (session?.id ?? null),
      reason: input.reason,
      createdById: actor.membershipId,
    },
  });
  if (payment) {
    const unallocated = payment.unallocated - input.amount;
    const allocated = await tx.paymentAllocation.count({
      where: { paymentId: payment.id, voidedAt: null },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        unallocated,
        ...(unallocated === 0 && allocated === 0 ? { status: "REFUNDED" as const } : {}),
      },
    });
  } else {
    await tx.customerCredit.update({
      where: { id: credit!.id },
      data: { remaining: credit!.remaining - input.amount },
    });
  }
  await emitDomainEvent(tx as never, org.id, "payment.refunded", {
    refundId: refund.id,
    paymentId: payment?.id ?? null,
    customerId,
    amount: input.amount,
  });
  await audit(actor, "payment.refunded", "Refund", refund.id, {
    siteId,
    after: { amount: input.amount, method: input.method, paymentId: payment?.id ?? null },
    reason: input.reason,
  });
  return refund;
}
