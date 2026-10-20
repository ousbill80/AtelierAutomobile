// M08 RG-M08-23..26 / M14 RG-M14-03, 14 — liens de paiement mobile money côté web : fournisseur
// actif (identifiants déchiffrés à la volée), création ou réutilisation du lien, lien portail
// INVOICE, webhook signé, reçu au client. La confirmation elle-même est partagée avec le worker
// (`confirmLinkPayment`, @atelieros/db).
import { TRPCError } from "@trpc/server";
import {
  invoicePortalExpiry,
  isDomainError,
  isInvoicePayable,
  paymentReceiptMessage,
  planPaymentLink,
  PORTAL_METHOD_ORDER,
  type PaymentMethodLike,
} from "@atelieros/core";
import {
  adminDb,
  confirmLinkPayment,
  db,
  notifyMembers,
  writeAuditLog,
  type ConfirmLinkPaymentResult,
  type Invoice,
  type PaymentLink,
  type Prisma,
} from "@atelieros/db";
import {
  buildPaymentProvider,
  loadEncryptionKey,
  PaymentProviderError,
  type OnlinePaymentMethod,
  type PaymentProvider,
} from "@atelieros/integrations";
import { appUrl } from "../appointments/service";
import { messagingEnqueue } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";
import { newPortalToken } from "../quotes/service";
import type { Tx } from "./service";

export interface ProviderConfigRow {
  provider: string;
  isActive: boolean;
  credentials: string;
  methods: string[];
}

type ProviderFactory = (config: ProviderConfigRow) => PaymentProvider;

function defaultFactory(config: ProviderConfigRow): PaymentProvider {
  return buildPaymentProvider(config, {
    encryptionKey: () => loadEncryptionKey(),
    appUrl: appUrl(),
    allowSimulator: process.env.APP_ENV !== "production",
  });
}

let factoryOverride: ProviderFactory | null = null;

/** Tests : remplace la construction du fournisseur (ex. fournisseur indisponible) ; `null` rétablit. */
export function setPaymentProviderFactory(factory: ProviderFactory | null): void {
  factoryOverride = factory;
}

/** Adaptateur d'une configuration ; une erreur de configuration devient un message actionnable. */
export function providerFromConfig(config: ProviderConfigRow): PaymentProvider {
  try {
    return (factoryOverride ?? defaultFactory)(config);
  } catch (error) {
    if (isDomainError(error)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
    }
    throw error;
  }
}

export function paymentWebhookUrl(provider: string, organizationId: string): string {
  return `${appUrl()}/api/webhooks/payments/${provider}/${organizationId}`;
}

export function invoicePortalUrl(token: string): string {
  return `${appUrl()}/p/${token}/facture`;
}

const ONLINE_METHODS = new Set<string>(PORTAL_METHOD_ORDER);

/** Fournisseurs actifs de l'organisation (identifiants restés chiffrés). */
export async function activeProviderConfigs(tx: Tx): Promise<ProviderConfigRow[]> {
  return tx.paymentProviderConfig.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { provider: true, isActive: true, credentials: true, methods: true },
  });
}

function pickConfig(configs: ProviderConfigRow[], method: PaymentMethodLike | null) {
  return configs.find((c) => !method || c.methods.includes(method)) ?? null;
}

function unavailable(error: unknown): never {
  if (error instanceof PaymentProviderError) {
    throw new TRPCError({
      code: error.transient ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST",
      message: error.transient
        ? "Le paiement en ligne est momentanément indisponible. Réessayez dans quelques minutes."
        : `Le fournisseur de paiement a refusé le lien : ${error.message}`,
      cause: error,
    });
  }
  throw error;
}

export interface CreateInvoicePaymentLinkInput {
  organizationId: string;
  invoiceId: string;
  amount?: number | null;
  expiresInHours?: number | null;
  method?: PaymentMethodLike | null;
  /** Portail : réutilise un lien en attente du même montant et du même moyen (RG-M14-14). */
  reuse: boolean;
  createdById: string | null;
  /** Jeton portail INVOICE (clair) : page de retour du client ; sinon page générique. */
  portalToken?: string | null;
  now: Date;
}

/**
 * RG-M08-23 — lien de paiement d'une facture. La facture est relue juste avant l'appel au
 * fournisseur et une seconde fois à l'enregistrement : un paiement arrivé entre-temps annule
 * la création (CLAUDE.md : revérifier la condition juste avant l'envoi).
 */
export async function createInvoicePaymentLink(
  input: CreateInvoicePaymentLinkInput,
): Promise<PaymentLink> {
  const tenantDb = db.forTenant({ organizationId: input.organizationId });
  const method = input.method ?? null;
  if (method && !ONLINE_METHODS.has(method)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ce moyen de paiement ne se règle pas en ligne.",
    });
  }
  const prepared = await tenantDb.transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId },
      include: { customer: true },
    });
    if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Facture introuvable." });
    if (invoice.billTo !== "CUSTOMER") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Une facture adressée à l'assureur ne se paie pas par lien mobile money.",
      });
    }
    const openLinks = await tx.paymentLink.findMany({
      where: { invoiceId: invoice.id, status: "PENDING" },
    });
    let plan;
    try {
      plan = planPaymentLink({
        invoice,
        amount: input.amount,
        expiresInHours: input.expiresInHours,
        method,
        reuse: input.reuse,
        openLinks,
        now: input.now,
      });
    } catch (error) {
      if (isDomainError(error)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
      }
      throw error;
    }
    if (plan.action === "reuse") {
      const reused = openLinks.find((l) => l.id === plan.linkId);
      if (reused) return { reused } as const;
    }
    if (plan.action !== "create") throw new Error("payment link plan");
    const config = pickConfig(await activeProviderConfigs(tx), method);
    if (!config) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: method
          ? "Ce moyen de paiement n'est pas proposé par vos fournisseurs : Paramètres > Paiements."
          : "Aucun fournisseur de paiement en ligne n'est configuré : Paramètres > Paiements.",
      });
    }
    return { invoice, plan, config } as const;
  });
  if ("reused" in prepared && prepared.reused) return prepared.reused;

  const { invoice, plan, config } = prepared;
  const provider = providerFromConfig(config);
  let created;
  try {
    created = await provider.createPaymentLink({
      invoiceId: invoice.id,
      reference: invoice.number ?? invoice.id,
      amount: plan.amount,
      method: method as OnlinePaymentMethod | null,
      customer: {
        name: invoice.customer.displayName,
        phone: invoice.customer.whatsappPhone ?? invoice.customer.phone ?? undefined,
        email: invoice.customer.email ?? undefined,
      },
      expiresAt: plan.expiresAt,
      description: `Facture ${invoice.number ?? ""}`.trim(),
      returnUrl: input.portalToken
        ? invoicePortalUrl(input.portalToken)
        : `${appUrl()}/p/paiement-retour`,
      notifyUrl: paymentWebhookUrl(provider.name, input.organizationId),
    });
  } catch (error) {
    unavailable(error);
  }

  return tenantDb.transaction(async (tx) => {
    const current = await tx.invoice.findFirstOrThrow({ where: { id: invoice.id } });
    if (!isInvoicePayable(current) || current.balance < plan.amount) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "La facture vient d'être réglée : aucun lien de paiement n'est nécessaire.",
      });
    }
    if (plan.replaceIds.length > 0) {
      await tx.paymentLink.updateMany({
        where: { id: { in: plan.replaceIds }, status: "PENDING" },
        data: { status: "FAILED", closedAt: input.now, closeReason: "replaced" },
      });
    }
    return tx.paymentLink.create({
      data: {
        organizationId: input.organizationId,
        invoiceId: invoice.id,
        provider: provider.name,
        providerRef: created.providerRef,
        url: created.url,
        amount: plan.amount,
        expiresAt: plan.expiresAt,
        method: method as PaymentLink["method"],
        createdById: input.createdById,
        // Horloge injectable (RG-M14-15 : délai de confirmation compté depuis la création).
        createdAt: input.now,
      },
    });
  });
}

/** RG-M14-01/03 — jeton portail INVOICE ; `Invoice.publicToken` = hash (A2). */
export async function issueInvoicePortalLink(
  tx: Tx,
  invoice: Pick<Invoice, "id" | "organizationId" | "customerId" | "issuedAt" | "status">,
  createdById: string | null,
  now: Date,
): Promise<{ token: string; url: string }> {
  const { token, tokenHash } = newPortalToken();
  await tx.portalToken.create({
    data: {
      organizationId: invoice.organizationId,
      tokenHash,
      scope: "INVOICE",
      targetId: invoice.id,
      customerId: invoice.customerId,
      createdById,
      expiresAt: invoicePortalExpiry({
        issuedAt: invoice.issuedAt ?? now,
        paidAt: invoice.status === "PAID" ? now : null,
      }),
    },
  });
  await tx.invoice.update({ where: { id: invoice.id }, data: { publicToken: tokenHash } });
  return { token, url: invoicePortalUrl(token) };
}

/** Après un paiement confirmé (hors transaction) : audit système et reçu au client. */
async function afterConfirmation(
  organizationId: string,
  result: ConfirmLinkPaymentResult,
  via: "webhook" | "check" | "portal",
): Promise<void> {
  if (result.outcome !== "created") return;
  await writeAuditLog({
    organizationId,
    siteId: result.siteId,
    action: "payment.created",
    entity: "Payment",
    entityId: result.paymentId,
    after: {
      number: result.paymentNumber,
      amount: result.amount,
      invoiceId: result.invoiceId,
      unallocated: result.unallocated,
      via: `payment_link:${via}`,
    },
  });
  await sendPaymentReceipt(organizationId, result);
}

/** RG-M08-24 (7) — reçu au client (WhatsApp, repli SMS) ; best effort, jamais bloquant. */
export async function sendPaymentReceipt(
  organizationId: string,
  result: Extract<ConfirmLinkPaymentResult, { outcome: "created" }>,
): Promise<string | null> {
  try {
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    const messageId = await db.forTenant({ organizationId }).transaction(async (tx) => {
      const customer = await tx.customer.findFirstOrThrow({ where: { id: result.customerId } });
      const enqueued = await messagingEnqueue(tx, organizationId, {
        idempotencyKey: `rcpt:${result.paymentId}`,
        kind: "transactional",
        customerId: customer.id,
        to: {
          phone: customer.phone,
          whatsapp: customer.whatsappPhone ?? customer.phone,
          email: customer.email,
          name: customer.displayName,
        },
        channels: ["WHATSAPP", "SMS"],
        templateKey: "payment_receipt",
        bodyOverride: paymentReceiptMessage({
          garageName: org.name,
          paymentNumber: result.paymentNumber,
          amount: result.amount,
          invoiceNumber: result.invoiceNumber,
          balanceAfter: result.balanceAfter,
        }),
      });
      return "message" in enqueued && enqueued.created ? enqueued.message.id : null;
    });
    if (messageId) await enqueueMessageSendJob(messageId).catch(() => undefined);
    return messageId;
  } catch {
    // Canal non configuré ou Redis indisponible : le paiement reste enregistré.
    return null;
  }
}

/**
 * Vérification d'un lien auprès du fournisseur (bouton « Vérifier », page portail, rapprochement)
 * puis confirmation partagée. Le statut vient toujours de `getStatus` (RG-M08-24 (3)).
 */
export async function refreshPaymentLink(
  organizationId: string,
  linkId: string,
  now: Date,
  via: "check" | "portal",
): Promise<ConfirmLinkPaymentResult> {
  const tenantDb = db.forTenant({ organizationId });
  const link = await tenantDb.paymentLink.findFirst({ where: { id: linkId } });
  if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Lien de paiement introuvable." });
  if (link.status !== "PENDING") {
    return link.paymentId
      ? { outcome: "duplicate", paymentId: link.paymentId }
      : { outcome: "failed", reason: link.closeReason === "expired" ? "expired" : "failed" };
  }
  const config = await tenantDb.paymentProviderConfig.findFirst({
    where: { provider: link.provider },
    select: { provider: true, isActive: true, credentials: true, methods: true },
  });
  if (!config) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Fournisseur de paiement de ce lien non configuré : Paramètres > Paiements.",
    });
  }
  let confirmed;
  try {
    confirmed = await providerFromConfig(config).getStatus(link.providerRef);
  } catch (error) {
    unavailable(error);
  }
  const result = await tenantDb.transaction(
    (tx) =>
      confirmLinkPayment(tx, {
        organizationId,
        provider: link.provider,
        providerRef: link.providerRef,
        confirmed,
        now,
      }),
    { timeout: 20_000 },
  );
  await afterConfirmation(organizationId, result, via);
  return result;
}

// ───────────── Webhook (RG-M08-24) ─────────────

const INVALID_SIGNATURE_ALERT_THRESHOLD = 5;

function payloadOf(rawBody: string): Prisma.InputJsonValue {
  try {
    return JSON.parse(rawBody) as Prisma.InputJsonValue;
  } catch {
    const form = new URLSearchParams(rawBody);
    const entries = Object.fromEntries(form);
    return Object.keys(entries).length > 0 ? entries : { raw: rawBody.slice(0, 10_000) };
  }
}

async function logWebhook(data: {
  organizationId: string | null;
  provider: string;
  providerRef?: string | null;
  signatureValid: boolean;
  rawBody: string;
  outcome: string;
  now: Date;
}) {
  await adminDb.paymentWebhookLog.create({
    data: {
      organizationId: data.organizationId,
      provider: data.provider,
      providerRef: data.providerRef ?? null,
      signatureValid: data.signatureValid,
      payload: payloadOf(data.rawBody),
      outcome: data.outcome,
      receivedAt: data.now,
    },
  });
}

/** §11 — signature invalide : alerte au propriétaire après 5 échecs dans l'heure. */
async function alertInvalidSignatures(organizationId: string, provider: string, now: Date) {
  const since = new Date(now.getTime() - 3_600_000);
  const failures = await adminDb.paymentWebhookLog.count({
    where: { organizationId, signatureValid: false, receivedAt: { gte: since } },
  });
  if (failures < INVALID_SIGNATURE_ALERT_THRESHOLD) return;
  await db.forTenant({ organizationId }).transaction((tx) =>
    notifyMembers(
      tx,
      organizationId,
      { roles: ["OWNER"] },
      {
        type: "payment.webhook_invalid_signature",
        title: "Webhooks de paiement refusés (signature invalide)",
        body: `${failures} notifications ${provider} refusées en une heure : vérifiez le secret dans Paramètres > Paiements.`,
        link: "/parametres/paiements",
        severity: "critical",
        dedupeKey: `payment.webhook_invalid:${provider}:${now.toISOString().slice(0, 13)}`,
      },
    ),
  );
}

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * `POST /api/webhooks/payments/[provider]/[organizationId]` : signature HMAC vérifiée sur le
 * corps brut, statut et montant relus chez le fournisseur, paiement créé une seule fois.
 * Toujours journalisé dans `PaymentWebhookLog`.
 */
export async function handlePaymentWebhook(input: {
  provider: string;
  organizationId: string;
  rawBody: string;
  headers: Headers;
  now: Date;
}): Promise<WebhookResponse> {
  const { provider: providerName, rawBody, headers, now } = input;
  const org = /^[A-Za-z0-9_-]{10,40}$/.test(input.organizationId)
    ? await adminDb.organization.findUnique({
        where: { id: input.organizationId },
        select: { id: true },
      })
    : null;
  const config = org
    ? await adminDb.paymentProviderConfig.findFirst({
        where: { organizationId: org.id, provider: providerName },
        select: { provider: true, isActive: true, credentials: true, methods: true },
      })
    : null;
  if (!org || !config) {
    await logWebhook({
      organizationId: org?.id ?? null,
      provider: providerName.slice(0, 40),
      signatureValid: false,
      rawBody,
      outcome: "rejected",
      now,
    });
    return { status: 404, body: { error: "unknown_endpoint" } };
  }
  let provider: PaymentProvider;
  try {
    provider = providerFromConfig(config);
  } catch {
    await logWebhook({
      organizationId: org.id,
      provider: providerName,
      signatureValid: false,
      rawBody,
      outcome: "error",
      now,
    });
    return { status: 503, body: { error: "provider_unavailable" } };
  }
  if (!provider.verifyWebhook(rawBody, headers)) {
    await logWebhook({
      organizationId: org.id,
      provider: providerName,
      signatureValid: false,
      rawBody,
      outcome: "rejected",
      now,
    });
    await alertInvalidSignatures(org.id, providerName, now);
    return { status: 401, body: { error: "invalid_signature" } };
  }
  let providerRef = "";
  try {
    providerRef = provider.parseWebhook(rawBody, headers).providerRef;
  } catch {
    providerRef = "";
  }
  if (!providerRef) {
    await logWebhook({
      organizationId: org.id,
      provider: providerName,
      signatureValid: true,
      rawBody,
      outcome: "error",
      now,
    });
    return { status: 400, body: { error: "invalid_payload" } };
  }
  let result: ConfirmLinkPaymentResult;
  try {
    const confirmed = await provider.getStatus(providerRef);
    result = await db.forTenant({ organizationId: org.id }).transaction(
      (tx) =>
        confirmLinkPayment(tx, {
          organizationId: org.id,
          provider: providerName,
          providerRef,
          confirmed,
          now,
        }),
      { timeout: 20_000 },
    );
  } catch {
    // Fournisseur injoignable ou erreur transitoire : 503 pour que le fournisseur réessaie
    // (et `payments.reconcile` rattrape sinon).
    await logWebhook({
      organizationId: org.id,
      provider: providerName,
      providerRef,
      signatureValid: true,
      rawBody,
      outcome: "error",
      now,
    });
    return { status: 503, body: { error: "retry_later" } };
  }
  await logWebhook({
    organizationId: org.id,
    provider: providerName,
    providerRef,
    signatureValid: true,
    rawBody,
    outcome: result.outcome,
    now,
  });
  await afterConfirmation(org.id, result, "webhook");
  return { status: 200, body: { ok: true, outcome: result.outcome } };
}
