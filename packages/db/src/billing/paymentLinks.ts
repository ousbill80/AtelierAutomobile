// M08 RG-M08-24/25 — confirmation d'un paiement de lien, partagée par le webhook
// (`/api/webhooks/payments/...`, apps/web) et le rapprochement (`payments.reconcile`, worker).
// Le statut et le montant viennent toujours de `getStatus` du fournisseur (jamais du webhook
// seul) ; l'appelant résout le fournisseur et envoie le reçu après le commit.
//
// Idempotence : la ligne `PaymentLink` est verrouillée (updateMany = UPDATE … WHERE) avant de chercher un paiement
// existant, si bien que deux webhooks simultanés pour la même transaction se sérialisent et que
// le second voit le paiement du premier (aucun numéro de reçu consommé pour rien) ; la contrainte
// `Payment @@unique([provider, providerRef])` reste le garde-fou ultime.
import {
  businessDate,
  checkPaymentLink,
  DEFAULT_NUMBERING_CONFIG,
  deriveInvoiceStatus,
  formatFCFA,
  linkPaymentAllocation,
  paymentMismatchMessage,
  reconcileWindowStart,
  renderNumberingPattern,
  type NumberingConfig,
  type PaymentLinkCheck,
  type ProviderLinkStatus,
} from "@atelieros/core";
import type { Invoice, InvoiceStatus, PaymentLink, PaymentMethod, Prisma } from "@prisma/client";
import { adminDb } from "../client";
import { syncClaimFromInvoices } from "../claims";
import {
  attributeAllocations,
  collectionSettingsFrom,
  evaluateCasePromises,
  syncCustomerReceivables,
  tenantSequenceStore,
} from "../receivables";
import { notifyMembers } from "../stock/context";
import type { ScopedTenantClient } from "../tenant";

type Tx = ScopedTenantClient;

/** Statut confirmé par le fournisseur (forme structurelle de `PaymentStatusResult`). */
export interface ConfirmedProviderStatus {
  status: ProviderLinkStatus;
  amount: number | null;
  method: string | null;
  paidAt: Date | null;
  payerPhone: string | null;
}

const ALLOCATABLE: InvoiceStatus[] = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];
const STAFF_ALERT_ROLES = ["OWNER", "CASHIER", "ACCOUNTANT"];
const ONLINE_METHODS = new Set(["WAVE", "ORANGE_MONEY", "MTN_MOMO", "MOOV_MONEY", "CARD"]);

/** RG-M08-10/11 — `amountPaid`, `balance` et statut dérivé d'une facture émise. */
export async function recomputeInvoiceBalance(
  tx: Tx,
  invoiceId: string,
  today: Date,
): Promise<Invoice> {
  const invoice = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId } });
  if (invoice.status === "DRAFT") return invoice;
  const allocations = await tx.paymentAllocation.findMany({
    where: { invoiceId, voidedAt: null },
    select: { amount: true, paymentId: true, payment: { select: { status: true } } },
  });
  const amountPaid = allocations
    .filter((a) => !a.paymentId || a.payment?.status === "CONFIRMED")
    .reduce((s, a) => s + a.amount, 0);
  const next = deriveInvoiceStatus({
    status: invoice.status,
    type: invoice.type,
    total: invoice.total,
    amountPaid,
    creditedAmount: invoice.creditedAmount,
    dueDate: invoice.dueDate,
    today,
  });
  const unchanged =
    next.amountPaid === invoice.amountPaid &&
    next.balance === invoice.balance &&
    next.status === invoice.status;
  const updated = unchanged
    ? invoice
    : await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          amountPaid: next.amountPaid,
          balance: next.balance,
          status: next.status as InvoiceStatus,
        },
      });
  // M16 §9 : facture d'un dossier sinistre émise / réglée / avoirée → statut du dossier.
  if (updated.insuranceClaimId) await syncClaimFromInvoices(tx, updated.insuranceClaimId, today);
  return updated;
}

interface OrgPaymentContext {
  timeZone: string;
  receiptNumbering: NumberingConfig;
  settings: unknown;
}

async function loadOrgPaymentContext(organizationId: string): Promise<OrgPaymentContext> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true, settings: true },
  });
  const raw = (org.settings ?? {}) as Record<string, unknown>;
  const numbering = (raw.numbering ?? {}) as Record<string, Partial<NumberingConfig>>;
  return {
    timeZone: org.timezone,
    // A4 : reçus numérotés par organisation, réinitialisés chaque année (comme FAC / AV).
    receiptNumbering: {
      ...DEFAULT_NUMBERING_CONFIG.REC,
      ...numbering.REC,
      perSite: false,
      resetYearly: true,
    },
    settings: org.settings,
  };
}

function providerMethod(provider: string): PaymentMethod {
  return provider === "wave" ? "WAVE" : "OTHER";
}

export type ConfirmLinkPaymentResult =
  | {
      outcome: "created";
      paymentId: string;
      paymentNumber: string;
      invoiceId: string;
      invoiceNumber: string | null;
      customerId: string;
      siteId: string;
      amount: number;
      balanceAfter: number;
      unallocated: number;
      probableDuplicate: boolean;
      mismatch: boolean;
    }
  | { outcome: "duplicate"; paymentId: string }
  | { outcome: "failed"; reason: "failed" | "expired" }
  | { outcome: "pending" }
  | { outcome: "unknown_link" };

/**
 * RG-M08-24 étapes 4 à 7 — enregistre le `Payment` d'un lien (montant confirmé), l'affecte à la
 * facture du lien (trop-perçu en `unallocated`, alerte si la facture était déjà soldée), passe le
 * lien `CONFIRMED`, attribue l'encaissement (A10), met à jour M09 et émet `payment.received`.
 */
export async function confirmLinkPayment(
  tx: Tx,
  input: {
    organizationId: string;
    provider: string;
    providerRef: string;
    confirmed: ConfirmedProviderStatus;
    now: Date;
  },
): Promise<ConfirmLinkPaymentResult> {
  const { organizationId, provider, providerRef, confirmed, now } = input;
  // Verrou de ligne : sérialise les confirmations concurrentes de la même transaction.
  const locked = await tx.paymentLink.updateMany({
    where: { provider, providerRef },
    data: { lastCheckedAt: now },
  });
  if (locked.count === 0) return { outcome: "unknown_link" };
  const link = await tx.paymentLink.findFirstOrThrow({ where: { provider, providerRef } });
  const existing = await tx.payment.findFirst({
    where: { provider, providerRef },
    select: { id: true },
  });
  if (existing) {
    if (link.status !== "CONFIRMED") {
      await tx.paymentLink.update({
        where: { id: link.id },
        data: { status: "CONFIRMED", paymentId: existing.id, confirmedAt: link.confirmedAt ?? now },
      });
    }
    return { outcome: "duplicate", paymentId: existing.id };
  }

  const check: PaymentLinkCheck = checkPaymentLink({
    link,
    provider: { status: confirmed.status, amount: confirmed.amount },
    now,
  });
  if (check.action === "keep") return { outcome: "pending" };
  if (check.action === "fail") {
    if (link.status === "PENDING") {
      await tx.paymentLink.update({
        where: { id: link.id },
        data: { status: "FAILED", closedAt: now, closeReason: check.reason },
      });
    }
    return { outcome: "failed", reason: check.reason };
  }

  const org = await loadOrgPaymentContext(organizationId);
  const today = businessDate(now, org.timeZone);
  const invoice = await tx.invoice.findFirstOrThrow({ where: { id: link.invoiceId } });
  const allocatableBalance = ALLOCATABLE.includes(invoice.status) ? invoice.balance : 0;
  const plan = linkPaymentAllocation({ amount: check.amount, invoiceBalance: allocatableBalance });
  const year = Number(today.toISOString().slice(0, 4));
  const number = renderNumberingPattern(org.receiptNumbering, {
    year,
    value: await tenantSequenceStore(tx).getAndIncrement({
      organizationId,
      siteId: null,
      docType: "REC",
      year,
    }),
  });
  const session = await tx.cashSession.findFirst({
    where: { siteId: invoice.siteId, closedAt: null },
    orderBy: { openedAt: "asc" },
    select: { id: true },
  });
  const method = (
    confirmed.method && ONLINE_METHODS.has(confirmed.method)
      ? confirmed.method
      : (link.method ?? providerMethod(provider))
  ) as PaymentMethod;
  const notes = [
    `Lien de paiement ${provider}`,
    check.mismatch ? paymentMismatchMessage(link.amount, check.amount) : null,
    plan.probableDuplicate ? "Facture déjà soldée : paiement en double probable." : null,
  ]
    .filter(Boolean)
    .join(" — ");
  const payment = await tx.payment.create({
    data: {
      organizationId,
      siteId: invoice.siteId,
      customerId: invoice.customerId,
      number,
      method,
      amount: check.amount,
      receivedAt: confirmed.paidAt ?? now,
      reference: providerRef,
      status: "CONFIRMED",
      provider,
      providerRef,
      cashSessionId: session?.id ?? null,
      unallocated: plan.unallocated,
      payerPhone: confirmed.payerPhone,
      notes,
    },
  });
  const allocations: { id: string; amount: number }[] = [];
  let balanceAfter = invoice.balance;
  if (plan.allocated > 0) {
    const allocation = await tx.paymentAllocation.create({
      data: {
        organizationId,
        paymentId: payment.id,
        invoiceId: invoice.id,
        amount: plan.allocated,
      },
    });
    allocations.push({ id: allocation.id, amount: plan.allocated });
    balanceAfter = (await recomputeInvoiceBalance(tx, invoice.id, today)).balance;
  }
  await tx.paymentLink.update({
    where: { id: link.id },
    data: {
      status: "CONFIRMED",
      paymentId: payment.id,
      confirmedAt: now,
      confirmedAmount: check.amount,
    },
  });

  // M09 / A10 : attribution aux relances, promesses, dossier de recouvrement.
  const collection = collectionSettingsFrom(org.settings);
  if (allocations.length > 0) {
    await attributeAllocations(tx, {
      organizationId,
      customerId: invoice.customerId,
      receivedAt: payment.receivedAt,
      attributionDays: collection.attributionDays,
      allocations,
    });
  }
  const activeCase = await tx.collectionCase.findFirst({
    where: {
      customerId: invoice.customerId,
      status: { in: ["OPEN", "PROMISED", "PAUSED", "DISPUTED", "ESCALATED"] },
    },
    select: { id: true },
  });
  if (activeCase) {
    await evaluateCasePromises(tx, {
      organizationId,
      caseId: activeCase.id,
      today,
      now,
      graceDays: collection.graceDays,
    });
  }
  await syncCustomerReceivables(tx, {
    organizationId,
    customerId: invoice.customerId,
    today,
    now,
    settings: collection,
  });
  await tx.domainEvent.create({
    data: {
      organizationId,
      type: "payment.received",
      payload: {
        paymentId: payment.id,
        customerId: invoice.customerId,
        caseId: activeCase?.id ?? null,
        amount: check.amount,
        invoiceId: invoice.id,
        paymentLinkId: link.id,
        channel: "payment_link",
      } as Prisma.InputJsonValue,
    },
  });

  const label = invoice.number ?? "brouillon";
  if (plan.probableDuplicate || plan.unallocated > 0) {
    await notifyMembers(
      tx,
      organizationId,
      { roles: STAFF_ALERT_ROLES },
      {
        type: plan.probableDuplicate ? "payment.probable_duplicate" : "payment.overpaid",
        title: plan.probableDuplicate
          ? `Paiement en double probable — ${label}`
          : `Trop-perçu de ${formatFCFA(plan.unallocated)} — ${label}`,
        body: `Reçu ${number} : ${formatFCFA(check.amount)} par lien de paiement. Proposez un remboursement ou un crédit client.`,
        link: `/factures/${invoice.id}`,
        severity: "warning",
        dedupeKey: `payment.unallocated:${payment.id}`,
      },
    );
  }
  if (check.mismatch) {
    await notifyMembers(
      tx,
      organizationId,
      { roles: STAFF_ALERT_ROLES },
      {
        type: "payment.amount_mismatch",
        title: `Montant reçu différent du lien — ${label}`,
        body: paymentMismatchMessage(link.amount, check.amount),
        link: `/factures/${invoice.id}`,
        severity: "warning",
        dedupeKey: `payment.mismatch:${payment.id}`,
      },
    );
  }
  return {
    outcome: "created",
    paymentId: payment.id,
    paymentNumber: number,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    customerId: invoice.customerId,
    siteId: invoice.siteId,
    amount: check.amount,
    balanceAfter,
    unallocated: plan.unallocated,
    probableDuplicate: plan.probableDuplicate,
    mismatch: check.mismatch,
  };
}

/** RG-M08-25 — liens à rapprocher : en attente, non expirés ou expirés depuis moins de 24 h. */
export async function paymentLinksToReconcile(
  now: Date,
  organizationId?: string,
): Promise<Pick<PaymentLink, "id" | "organizationId" | "provider" | "providerRef">[]> {
  return adminDb.paymentLink.findMany({
    where: {
      status: "PENDING",
      expiresAt: { gt: reconcileWindowStart(now) },
      ...(organizationId ? { organizationId } : {}),
    },
    select: { id: true, organizationId: true, provider: true, providerRef: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
}

/** `paymentLinks.expire` — liens en attente expirés depuis plus de 24 h → `FAILED` (expired). */
export async function expireStalePaymentLinks(now: Date, organizationId?: string): Promise<number> {
  const result = await adminDb.paymentLink.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lte: reconcileWindowStart(now) },
      ...(organizationId ? { organizationId } : {}),
    },
    data: { status: "FAILED", closedAt: now, closeReason: "expired" },
  });
  return result.count;
}

/** Forme minimale de `PaymentProviderConfig` pour le registre (identifiants restés chiffrés). */
export async function loadPaymentConfigRecord(
  organizationId: string,
  provider?: string,
): Promise<{ provider: string; isActive: boolean; credentials: string } | undefined> {
  const row = await adminDb.paymentProviderConfig.findFirst({
    where: provider ? { organizationId, provider } : { organizationId, isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { provider: true, isActive: true, credentials: true },
  });
  return row ?? undefined;
}
