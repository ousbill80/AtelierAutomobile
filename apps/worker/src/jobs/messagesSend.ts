// RG-M11-02 (conformité), RG-M11-05 (repli), RG-M11-06 (détection WhatsApp), RG-M11-07 (retries).
//
// Simplifications documentées (écarts PRD, à lever par des étapes ultérieures) :
// - RG-M11-02 (3) : `Customer.phoneInvalidAt` est ajouté par M10 §14 (RG-M10-32), pas par M11 ;
//   tant que M10 n'est pas implémenté, cette vérification est un no-op (jamais invalide).
// - Le repli (RG-M11-05) réutilise le `body`/`subject` déjà rendus du message d'origine plutôt
//   que de re-rendre le modèle pour le nouveau canal : le contexte de rendu (variables) n'est
//   pas persisté sur `Message`, seul le texte final l'est. L'ordre de repli par défaut
//   (WHATSAPP → SMS → EMAIL, canaux déjà essayés exclus) est utilisé en l'absence de la liste de
//   préférence d'origine (non stockée sur `Message`).
// - « Marquer FAILED » puis « créer le repli » ne sont pas enveloppés dans une transaction
//   explicite (contrairement à la fusion client de M02) : chaque appel `db.forTenant()` est déjà
//   atomique individuellement, et un crash entre les deux étapes laisse au plus un message
//   FAILED sans repli, détectable et rejouable, pas une incohérence multi-locataire.
// - Limitation de débit (RG-M11-08), budget (RG-M11-09), alerte palier WhatsApp, notification
//   interne « message.failed_all » : non branchées dans cette étape (pas de Notification/M15 UI
//   encore disponibles ; `ChannelConfig.status/lastError` est mis à jour, c'est le point
//   d'extension prévu).
import { DelayedError, type Job } from "bullmq";
import { adminDb, db, type Prisma } from "@atelieros/db";
import {
  defaultOutbox,
  loadEncryptionKey,
  resolveMessagingProvider,
  type MessageChannel,
  type MessagingConfigStore,
  type OutboundAttachment,
  type ProviderErrorCategory,
} from "@atelieros/integrations";
import {
  fallbackDecision,
  isWithinSendWindow,
  MAX_RETRY_ATTEMPTS,
  nextSendWindowStart,
  nextStatus,
  pickChannel,
  type Channel,
  type ChannelCandidate,
} from "@atelieros/core";
import { logger } from "../logger";
import { enqueueMessageSendJob, type MessagesSendJobData } from "../queues/messages";
import { getObjectStorage } from "../storage";

type TenantDb = ReturnType<typeof db.forTenant>;

const DEFAULT_QUIET_HOURS = { from: "07:00", to: "21:00" };
const CHANNEL_ORDER: Channel[] = ["WHATSAPP", "SMS", "EMAIL"];

function errorCategory(error: unknown): ProviderErrorCategory {
  if (error && typeof error === "object" && "category" in error) {
    const value = (error as { category?: unknown }).category;
    if (
      value === "TEMPORARY" ||
      value === "PERMANENT_RECIPIENT" ||
      value === "PERMANENT_TEMPLATE" ||
      value === "PERMANENT_CONFIG" ||
      value === "RATE_LIMIT"
    ) {
      return value;
    }
  }
  return "TEMPORARY";
}

function errorProviderCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "providerCode" in error) {
    const value = (error as { providerCode?: unknown }).providerCode;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/** Signale à BullMQ qu'il doit réessayer avec le backoff personnalisé (RG-M11-07). */
class RetryableMessagingError extends Error {}

function channelConfigStore(tx: TenantDb): MessagingConfigStore {
  return {
    async listActive(_organizationId: string, channel: MessageChannel) {
      const rows = await tx.channelConfig.findMany({ where: { channel, isActive: true } });
      return rows
        .filter((r) => r.status !== "ERROR")
        .map((r) => ({
          channel: r.channel as MessageChannel,
          provider: r.provider,
          isActive: r.isActive,
          priority: r.priority,
          credentials: r.credentials,
          senderId: r.senderId,
        }));
    },
  };
}

async function findActiveChannelConfig(tx: TenantDb, channel: Channel) {
  const configs = await tx.channelConfig.findMany({ where: { channel, isActive: true } });
  // `status: { not: "ERROR" }` exclurait aussi les lignes status = NULL (sémantique SQL NULL) : filtré en JS.
  return (
    configs.filter((c) => c.status !== "ERROR").sort((a, b) => a.priority - b.priority)[0] ?? null
  );
}

interface FailedMessageLike {
  id: string;
  conversationId: string | null;
  customerId: string | null;
  reminderId: string | null;
  subject: string | null;
  body: string;
  attachments: Prisma.JsonValue;
  kind: string;
  templateKey: string | null;
  idempotencyKey: string | null;
  sentById: string | null;
  fallbackOfId: string | null;
}

async function triedChannelsOf(tx: TenantDb, message: FailedMessageLike): Promise<Set<Channel>> {
  const tried = new Set<Channel>();
  let current: FailedMessageLike | null = message;
  while (current) {
    tried.add(
      (await tx.message.findFirstOrThrow({ where: { id: current.id } })).channel as Channel,
    );
    current = current.fallbackOfId
      ? await tx.message.findFirst({ where: { id: current.fallbackOfId } })
      : null;
  }
  return tried;
}

/** RG-M11-05 : crée le message de repli sur le prochain canal disponible (ordre par défaut). */
async function createFallbackMessage(
  tx: TenantDb,
  organizationId: string,
  failed: FailedMessageLike,
  triedChannels: Set<Channel>,
): Promise<{ id: string; channel: Channel } | null> {
  const customer = failed.customerId
    ? await tx.customer.findFirst({ where: { id: failed.customerId } })
    : null;

  const candidates: ChannelCandidate[] = CHANNEL_ORDER.filter((c) => !triedChannels.has(c)).map(
    (channel): ChannelCandidate => {
      const address =
        channel === "WHATSAPP"
          ? (customer?.whatsappPhone ?? customer?.phone ?? null)
          : channel === "SMS"
            ? (customer?.phone ?? null)
            : (customer?.email ?? null);
      return {
        channel,
        address,
        isOptedOut: false, // revérifié par la conformité (RG-M11-02) au moment de l'envoi réel
        isAddressInvalid: channel === "EMAIL" ? !!customer?.emailInvalidAt : false,
        isChannelActive: true, // affiné par findActiveChannelConfig ci-dessous
      };
    },
  );

  const picked = pickChannel({ candidates });
  if (picked.channel === null) {
    logger.warn(
      { messageId: failed.id },
      "message.failed_all : plus aucun canal de repli disponible",
    );
    return null;
  }

  const activeConfig = await findActiveChannelConfig(tx, picked.channel);
  if (!activeConfig) {
    return null;
  }

  const fallback = await tx.message.create({
    data: {
      organizationId,
      conversationId: failed.conversationId,
      customerId: failed.customerId,
      reminderId: failed.reminderId,
      direction: "OUTBOUND",
      channel: picked.channel,
      to: picked.address,
      subject: failed.subject,
      body: failed.body,
      attachments: (failed.attachments ?? []) as Prisma.InputJsonValue,
      status: "QUEUED",
      provider: activeConfig.provider,
      kind: failed.kind as "REMINDER" | "TRANSACTIONAL" | "CONVERSATION" | "DIGEST" | "SYSTEM",
      templateKey: failed.templateKey,
      idempotencyKey: failed.idempotencyKey,
      sentById: failed.sentById,
      fallbackOfId: failed.id,
    },
  });

  return { id: fallback.id, channel: picked.channel };
}

function contentTypeFor(kind: string, filename: string): string {
  if (kind === "pdf" || filename.toLowerCase().endsWith(".pdf")) return "application/pdf";
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

/** Relit les fichiers stockés à l'enqueue (PDF de devis ou de facture) pour les joindre à l'email. */
async function loadEmailAttachments(raw: Prisma.JsonValue): Promise<OutboundAttachment[]> {
  if (!Array.isArray(raw)) return [];
  const files = raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { storageKey?: unknown; filename?: unknown; kind?: unknown };
    if (typeof row.storageKey !== "string" || typeof row.filename !== "string") return [];
    return [
      {
        storageKey: row.storageKey,
        filename: row.filename,
        kind: typeof row.kind === "string" ? row.kind : "pdf",
      },
    ];
  });
  if (files.length === 0) return [];
  const storage = getObjectStorage();
  const loaded: OutboundAttachment[] = [];
  for (const file of files) {
    const content = await storage.getObjectBytes(file.storageKey);
    loaded.push({
      filename: file.filename,
      contentType: contentTypeFor(file.kind, file.filename),
      content,
    });
  }
  return loaded;
}

/**
 * M10 — une relance suit son message : envoyé → relance `SENT` (date et canal réels) ; échec
 * définitif sans repli → relance `FAILED` avec la raison. Les relances pointent le premier
 * message de la chaîne de repli (`fallbackOfId`) : on remonte la chaîne pour les retrouver.
 */
async function messageChainIds(tx: TenantDb, message: { id: string; fallbackOfId: string | null }) {
  const ids = [message.id];
  let parent = message.fallbackOfId;
  for (let i = 0; parent && i < 5; i++) {
    ids.push(parent);
    const row = await tx.message.findFirst({
      where: { id: parent },
      select: { fallbackOfId: true },
    });
    parent = row?.fallbackOfId ?? null;
  }
  return ids;
}

async function syncRemindersOnSent(
  tx: TenantDb,
  message: { id: string; fallbackOfId: string | null; channel: string },
  sentAt: Date,
) {
  await tx.reminder.updateMany({
    where: { messageId: { in: await messageChainIds(tx, message) }, status: "QUEUED" },
    data: {
      status: "SENT",
      sentAt,
      channel: message.channel as Channel,
      messageId: message.id,
      skippedReason: null,
    },
  });
}

async function syncRemindersOnFailed(
  tx: TenantDb,
  message: { id: string; fallbackOfId: string | null },
  reason: string,
) {
  await tx.reminder.updateMany({
    where: { messageId: { in: await messageChainIds(tx, message) }, status: "QUEUED" },
    data: { status: "FAILED", skippedReason: reason },
  });
}

const FAILURE_LABELS: Record<string, string> = {
  OPTED_OUT: "Client désinscrit de ce canal.",
  NO_CONSENT: "Le client n'a pas accepté de recevoir des relances.",
  CHANNEL_INACTIVE: "Canal non configuré ou en erreur (Paramètres › Canaux).",
};

function failureReason(code: string): string {
  return FAILURE_LABELS[code] ?? `Échec d'envoi (${code}).`;
}

async function handlePermanentFailure(
  tx: TenantDb,
  organizationId: string,
  message: { id: string },
  errorCode: string,
): Promise<void> {
  await tx.message.update({
    where: { id: message.id },
    data: { status: "FAILED", errorCode, failedAt: new Date() },
  });
  const full = await tx.message.findFirstOrThrow({ where: { id: message.id } });
  const tried = await triedChannelsOf(tx, full);
  const fallback = await createFallbackMessage(tx, organizationId, full, tried);
  if (fallback) {
    await enqueueMessageSendJob(fallback.id);
  } else {
    await syncRemindersOnFailed(tx, full, failureReason(errorCode));
  }
}

export async function processMessagesSendJob(
  job: Job<MessagesSendJobData>,
  token?: string,
): Promise<void> {
  const { messageId } = job.data;

  const root = await adminDb.message.findUnique({
    where: { id: messageId },
    select: { organizationId: true },
  });
  if (!root) {
    logger.warn({ messageId }, "messages.send : message introuvable (déjà traité ou supprimé)");
    return;
  }
  const { organizationId } = root;
  const tx = db.forTenant({ organizationId });

  const message = await tx.message.findFirst({ where: { id: messageId } });
  if (!message) {
    logger.warn({ messageId }, "messages.send : message introuvable dans son organisation");
    return;
  }
  if (message.status === "SENT" || message.status === "DELIVERED" || message.status === "READ") {
    // Déjà envoyé (job rejoué après crash) : on rattrape le statut de la relance si besoin.
    await syncRemindersOnSent(tx, message, message.sentAt ?? new Date());
    return;
  }
  if (message.status === "FAILED") {
    return; // conformité déjà tranchée ou repli déjà créé
  }

  const organization = await adminDb.organization.findUnique({ where: { id: organizationId } });
  const settings = (organization?.settings ?? {}) as {
    messaging?: { quietHours?: { from: string; to: string } };
  };
  const quietHours = settings.messaging?.quietHours ?? DEFAULT_QUIET_HOURS;
  const timeZone = organization?.timezone ?? "Africa/Abidjan";

  // RG-M11-02 (4) : filet de sécurité, report au lendemain 08:00 si hors fenêtre d'envoi.
  if (
    (message.kind === "REMINDER" || message.kind === "DIGEST") &&
    !isWithinSendWindow(new Date(), timeZone, quietHours)
  ) {
    const retryAt = nextSendWindowStart(new Date(), timeZone);
    await job.moveToDelayed(retryAt.getTime(), token);
    throw new DelayedError();
  }

  const customer = message.customerId
    ? await tx.customer.findFirst({ where: { id: message.customerId } })
    : null;

  // RG-M11-02 (1)-(2) : conformité, avant tout appel fournisseur, sans repli.
  if (message.to && message.kind !== "TRANSACTIONAL") {
    const optOuts = await tx.optOut.findMany({ where: { address: message.to } });
    const isOptedOut = optOuts.some((o) => o.channel === null || o.channel === message.channel);
    if (isOptedOut) {
      await tx.message.update({
        where: { id: message.id },
        data: { status: "FAILED", errorCode: "OPTED_OUT", failedAt: new Date() },
      });
      await syncRemindersOnFailed(tx, message, failureReason("OPTED_OUT"));
      return;
    }
  }
  if (message.kind === "REMINDER" && customer && customer.remindersConsent === false) {
    await tx.message.update({
      where: { id: message.id },
      data: { status: "FAILED", errorCode: "NO_CONSENT", failedAt: new Date() },
    });
    await syncRemindersOnFailed(tx, message, failureReason("NO_CONSENT"));
    return;
  }

  // RG-M11-02 (5) : canal devenu inactif/en erreur entre l'enqueue et l'envoi → repli immédiat.
  const activeConfig = await findActiveChannelConfig(tx, message.channel as Channel);
  if (!activeConfig) {
    await handlePermanentFailure(tx, organizationId, message, "CHANNEL_INACTIVE");
    return;
  }

  await tx.message.update({ where: { id: message.id }, data: { status: "SENDING" } });

  const attempt = await tx.messageAttempt.create({
    data: {
      organizationId,
      messageId: message.id,
      attempt: message.attemptCount + 1,
      startedAt: new Date(),
      outcome: "PENDING",
    },
  });

  try {
    const provider = await resolveMessagingProvider(
      organizationId,
      message.channel as MessageChannel,
      {
        store: channelConfigStore(tx),
        encryptionKey: loadEncryptionKey(),
        outbox: defaultOutbox,
      },
    );

    const attachments =
      message.channel === "EMAIL" ? await loadEmailAttachments(message.attachments) : undefined;

    const result = await provider.send({
      organizationId,
      to: message.to ?? "",
      channel: message.channel as MessageChannel,
      body: message.body,
      subject: message.subject ?? undefined,
      templateKey: message.templateKey ?? undefined,
      templateName: job.data.whatsapp?.templateName,
      templateLanguage: job.data.whatsapp?.templateLanguage,
      templateParams: job.data.whatsapp?.templateParams,
      attachments,
      idempotencyKey: `${message.idempotencyKey ?? message.id}:attempt:${attempt.attempt}`,
    });

    await tx.messageAttempt.update({
      where: { id: attempt.id },
      data: { finishedAt: new Date(), outcome: "OK" },
    });
    const sentAt = new Date();
    await tx.message.update({
      where: { id: message.id },
      data: {
        status: nextStatus("SENDING", "SENT"),
        providerMessageId: result.providerMessageId,
        cost: result.cost,
        sentAt,
        attemptCount: attempt.attempt,
      },
    });
    await syncRemindersOnSent(tx, message, sentAt);
  } catch (error) {
    const category = errorCategory(error);
    const providerCode = errorProviderCode(error);

    await tx.messageAttempt.update({
      where: { id: attempt.id },
      data: {
        finishedAt: new Date(),
        outcome: category,
        providerCode,
        providerRaw: error instanceof Error ? { message: error.message } : undefined,
      },
    });

    if (message.channel === "WHATSAPP" && category === "PERMANENT_RECIPIENT" && customer) {
      await tx.customer.update({
        where: { id: customer.id },
        data: { hasWhatsapp: false, hasWhatsappCheckedAt: new Date() },
      });
    }

    if (category === "PERMANENT_CONFIG") {
      await tx.channelConfig.update({
        where: { id: activeConfig.id },
        data: {
          status: "ERROR",
          lastError: error instanceof Error ? error.message : "Erreur fournisseur",
        },
      });
    }

    if (category === "TEMPORARY" || category === "RATE_LIMIT") {
      if (attempt.attempt < MAX_RETRY_ATTEMPTS) {
        await tx.message.update({
          where: { id: message.id },
          data: { status: nextStatus("SENDING", "QUEUED"), attemptCount: attempt.attempt },
        });
        throw new RetryableMessagingError(
          providerCode ?? (error instanceof Error ? error.message : "Erreur temporaire"),
        );
      }
      const decision = fallbackDecision({ situation: "TEMPORARY_EXHAUSTED" });
      if (decision.shouldFallback) {
        await handlePermanentFailure(
          tx,
          organizationId,
          message,
          providerCode ?? "RETRIES_EXHAUSTED",
        );
      }
      return;
    }

    // PERMANENT_RECIPIENT, PERMANENT_TEMPLATE, PERMANENT_CONFIG
    await handlePermanentFailure(tx, organizationId, message, providerCode ?? category);
  }
}
