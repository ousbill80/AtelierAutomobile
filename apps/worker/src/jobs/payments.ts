// M08 §9 — `payments.reconcile` (RG-M08-25) : interroge `getStatus` des liens en attente (non
// expirés ou expirés depuis moins de 24 h) pour rattraper les webhooks perdus, puis applique la
// même confirmation que le webhook (`confirmLinkPayment`, idempotente). `paymentLinks.expire` :
// liens restés en attente 24 h après leur expiration → FAILED.
//
// Reçu au client : créé ici directement (comme `digestOwner`), aucun import d'apps/web ; canal
// SMS (transactionnel, sans contrainte de modèle WhatsApp), à défaut WhatsApp si sa
// configuration est active.
import { paymentReceiptMessage, systemClock, type Clock } from "@atelieros/core";
import {
  adminDb,
  confirmLinkPayment,
  db,
  expireStalePaymentLinks,
  loadPaymentConfigRecord,
  paymentLinksToReconcile,
  writeAuditLog,
  type ConfirmLinkPaymentResult,
} from "@atelieros/db";
import {
  buildPaymentProvider,
  loadEncryptionKey,
  type PaymentStatusResult,
} from "@atelieros/integrations";
import { logger } from "../logger";
import { enqueueMessageSendJob } from "../queues/messages";

/** Statut d'une transaction chez le fournisseur ; injectable pour les tests. */
export type PaymentStatusResolver = (
  organizationId: string,
  provider: string,
  providerRef: string,
) => Promise<PaymentStatusResult>;

export const statusFromConfig: PaymentStatusResolver = async (
  organizationId,
  provider,
  providerRef,
) => {
  const config = await loadPaymentConfigRecord(organizationId, provider);
  if (!config) throw new Error("payment provider not configured");
  return buildPaymentProvider(config, {
    encryptionKey: () => loadEncryptionKey(),
    appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    allowSimulator: process.env.APP_ENV !== "production",
  }).getStatus(providerRef);
};

async function queueReceipt(
  organizationId: string,
  result: Extract<ConfirmLinkPaymentResult, { outcome: "created" }>,
): Promise<void> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true },
  });
  const tenantDb = db.forTenant({ organizationId });
  const customer = await tenantDb.customer.findFirst({ where: { id: result.customerId } });
  if (!customer) return;
  const configs = await tenantDb.channelConfig.findMany({
    where: { isActive: true, channel: { in: ["SMS", "WHATSAPP"] } },
  });
  const sms = configs.find((c) => c.channel === "SMS" && c.status !== "ERROR");
  const whatsapp = configs.find((c) => c.channel === "WHATSAPP" && c.status !== "ERROR");
  const target =
    sms && customer.phone
      ? { channel: "SMS" as const, to: customer.phone, provider: sms.provider }
      : whatsapp && (customer.whatsappPhone ?? customer.phone)
        ? {
            channel: "WHATSAPP" as const,
            to: (customer.whatsappPhone ?? customer.phone)!,
            provider: whatsapp.provider,
          }
        : null;
  if (!target) return;
  const idempotencyKey = `rcpt:${result.paymentId}`;
  const existing = await tenantDb.message.findFirst({ where: { idempotencyKey } });
  if (existing) return;
  const message = await tenantDb.message.create({
    data: {
      organizationId,
      customerId: customer.id,
      direction: "OUTBOUND",
      channel: target.channel,
      to: target.to,
      body: paymentReceiptMessage({
        garageName: org.name,
        paymentNumber: result.paymentNumber,
        amount: result.amount,
        invoiceNumber: result.invoiceNumber,
        balanceAfter: result.balanceAfter,
      }),
      status: "QUEUED",
      provider: target.provider,
      kind: "TRANSACTIONAL",
      templateKey: "payment_receipt",
      idempotencyKey,
    },
  });
  await enqueueMessageSendJob(message.id).catch(() => undefined);
}

export async function reconcilePaymentLinks(
  now: Date,
  resolveStatus: PaymentStatusResolver = statusFromConfig,
  organizationId?: string,
  sendReceipt: (
    orgId: string,
    r: Extract<ConfirmLinkPaymentResult, { outcome: "created" }>,
  ) => Promise<void> = queueReceipt,
): Promise<{ checked: number; created: number; failed: number }> {
  const links = await paymentLinksToReconcile(now, organizationId);
  const totals = { checked: 0, created: 0, failed: 0 };
  for (const link of links) {
    let confirmed: PaymentStatusResult;
    try {
      confirmed = await resolveStatus(link.organizationId, link.provider, link.providerRef);
    } catch (error) {
      logger.warn(
        { paymentLinkId: link.id, error: (error as Error).message },
        "payments.reconcile : fournisseur injoignable, lien repris au prochain passage",
      );
      continue;
    }
    totals.checked += 1;
    const result = await db.forTenant({ organizationId: link.organizationId }).transaction(
      (tx) =>
        confirmLinkPayment(tx, {
          organizationId: link.organizationId,
          provider: link.provider,
          providerRef: link.providerRef,
          confirmed,
          now,
        }),
      { timeout: 20_000 },
    );
    if (result.outcome === "failed") totals.failed += 1;
    if (result.outcome !== "created") continue;
    totals.created += 1;
    await writeAuditLog({
      organizationId: link.organizationId,
      siteId: result.siteId,
      action: "payment.created",
      entity: "Payment",
      entityId: result.paymentId,
      after: {
        number: result.paymentNumber,
        amount: result.amount,
        invoiceId: result.invoiceId,
        unallocated: result.unallocated,
        via: "payment_link:reconcile",
      },
    });
    await sendReceipt(link.organizationId, result).catch(() => undefined);
  }
  return totals;
}

export async function processPaymentsReconcileJob(
  clock: Clock = systemClock,
  resolveStatus: PaymentStatusResolver = statusFromConfig,
) {
  const result = await reconcilePaymentLinks(clock.now(), resolveStatus);
  logger.info(result, "payments.reconcile");
  return result;
}

export async function processPaymentLinksExpireJob(clock: Clock = systemClock) {
  const expired = await expireStalePaymentLinks(clock.now());
  logger.info({ expired }, "paymentLinks.expire");
  return { expired };
}
