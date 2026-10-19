// RG-M11-01 : point d'entrée unique de tout envoi de message. Aucun autre module n'appelle
// un fournisseur directement (M11 §1) : tous passent par `messagingEnqueue`, appelée dans la
// transaction de l'appelant. L'ajout du job BullMQ (« après commit ») est à la charge de
// l'appelant (`enqueueMessageSendJob`, apps/web/src/server/messaging/queue.ts) une fois la
// transaction validée — cette fonction ne peut pas le faire elle-même puisqu'elle s'exécute
// à l'intérieur de cette transaction.
import {
  DomainError,
  pickChannel,
  renderTemplate,
  type Channel,
  type ChannelCandidate,
} from "@atelieros/core";
import type { Prisma, ScopedTenantClient } from "@atelieros/db";

export type EnqueueKind = "reminder" | "transactional" | "conversation" | "digest" | "system";

export interface EnqueueAttachment {
  kind: "pdf" | "image";
  storageKey: string;
  filename: string;
}

export interface EnqueueRequest {
  /** "rem:<groupKey>", "inv:<invoiceId>:issued", "rcpt:<paymentId>"… (RG-M11-01). */
  idempotencyKey: string;
  kind: EnqueueKind;
  customerId?: string;
  conversationId?: string;
  to: { phone?: string | null; whatsapp?: string | null; email?: string | null; name?: string };
  /** Ordre de préférence (repli), RG-M10-12 côté appelant. */
  channels: Channel[];
  templateKey?: string;
  context?: Record<string, unknown>;
  bodyOverride?: string;
  subjectOverride?: string;
  attachments?: EnqueueAttachment[];
  reminderId?: string;
  sentById?: string | null;
}

export type EnqueueResult =
  | { created: true; message: { id: string; channel: Channel } }
  | { created: false; message: { id: string; channel: Channel } } // idempotence : message déjà créé
  | { created: false; reason: "NO_CHANNEL_AVAILABLE" };

function addressFor(channel: Channel, to: EnqueueRequest["to"]): string | null {
  if (channel === "WHATSAPP") return to.whatsapp ?? to.phone ?? null;
  if (channel === "SMS") return to.phone ?? null;
  return to.email ?? null;
}

/**
 * Candidats de canal pour `pickChannel` (core). `Customer.phoneInvalidAt` (RG-M11-02 (3))
 * n'existe pas encore : ajouté par M10 §14 (RG-M10-32), pas par M11. En attendant cette
 * étape, SMS/WHATSAPP ne sont jamais écartés pour adresse invalide (écart documenté, à
 * lever quand M10 est implémenté).
 */
async function buildCandidates(
  tx: ScopedTenantClient,
  organizationId: string,
  req: EnqueueRequest,
): Promise<ChannelCandidate[]> {
  const address = {
    WHATSAPP: addressFor("WHATSAPP", req.to),
    SMS: addressFor("SMS", req.to),
    EMAIL: addressFor("EMAIL", req.to),
  } as const;

  const configs = await tx.channelConfig.findMany({ where: { channel: { in: req.channels } } });
  const optOuts = await tx.optOut.findMany({
    where: {
      address: {
        in: [address.WHATSAPP, address.SMS, address.EMAIL].filter((a): a is string => !!a),
      },
    },
  });
  const customer = req.customerId
    ? await tx.customer.findFirst({ where: { id: req.customerId } })
    : null;

  const whatsappConversation =
    address.WHATSAPP != null
      ? await tx.conversation.findFirst({
          where: { channel: "WHATSAPP", externalAddress: address.WHATSAPP },
        })
      : null;
  const whatsappWindowOpen =
    !!whatsappConversation?.whatsappWindowExpiresAt &&
    whatsappConversation.whatsappWindowExpiresAt.getTime() > Date.now();
  const approvedWhatsappTemplate = req.templateKey
    ? await tx.messageTemplate.findFirst({
        where: { key: req.templateKey, channel: "WHATSAPP", whatsappStatus: "APPROVED" },
      })
    : null;

  function isOptedOut(channel: Channel, addr: string | null): boolean {
    if (!addr || req.kind === "transactional") return false;
    return optOuts.some((o) => o.address === addr && (o.channel === null || o.channel === channel));
  }

  return req.channels.map((channel): ChannelCandidate => {
    const addr = address[channel];
    const activeConfig = [...configs]
      .filter((c) => c.channel === channel && c.isActive && c.status !== "ERROR")
      .sort((a, b) => a.priority - b.priority)[0];
    const candidate: ChannelCandidate = {
      channel,
      address: addr,
      isOptedOut: isOptedOut(channel, addr),
      isAddressInvalid: channel === "EMAIL" ? !!customer?.emailInvalidAt : false,
      isChannelActive: !!activeConfig,
    };
    if (channel === "WHATSAPP") {
      candidate.hasApprovedTemplate = whatsappWindowOpen || !!approvedWhatsappTemplate;
    }
    return candidate;
  });
}

async function findActiveChannelConfig(tx: ScopedTenantClient, channel: Channel) {
  const configs = await tx.channelConfig.findMany({ where: { channel, isActive: true } });
  // `status: { not: "ERROR" }` exclurait aussi les lignes status = NULL (sémantique SQL NULL) : filtré en JS.
  return (
    configs.filter((c) => c.status !== "ERROR").sort((a, b) => a.priority - b.priority)[0] ?? null
  );
}

export async function messagingEnqueue(
  tx: ScopedTenantClient,
  organizationId: string,
  req: EnqueueRequest,
): Promise<EnqueueResult> {
  const candidates = await buildCandidates(tx, organizationId, req);
  const picked = pickChannel({ candidates });
  if (picked.channel === null) {
    return { created: false, reason: "NO_CHANNEL_AVAILABLE" };
  }

  const existing = await tx.message.findFirst({
    where: { idempotencyKey: req.idempotencyKey, channel: picked.channel },
  });
  if (existing) {
    return { created: false, message: { id: existing.id, channel: picked.channel } };
  }

  const activeConfig = await findActiveChannelConfig(tx, picked.channel);
  const provider = activeConfig?.provider ?? "console";

  let body: string;
  let subject: string | undefined;
  if (req.bodyOverride !== undefined) {
    body = req.bodyOverride;
    subject = req.subjectOverride;
  } else {
    if (!req.templateKey) {
      throw new DomainError(
        "messaging.template_key_required",
        "Un templateKey ou un bodyOverride est requis pour envoyer un message.",
      );
    }
    const template = await tx.messageTemplate.findFirst({
      where: { key: req.templateKey, channel: picked.channel, isActive: true },
    });
    if (!template) {
      throw new DomainError(
        "messaging.template_not_found",
        `Aucun modèle actif « ${req.templateKey} » pour le canal ${picked.channel}.`,
        { templateKey: req.templateKey, channel: picked.channel },
      );
    }
    body = renderTemplate({
      template: template.body,
      context: req.context ?? {},
      channel: picked.channel,
    }).body;
    subject =
      req.subjectOverride ??
      (template.subject
        ? renderTemplate({
            template: template.subject,
            context: req.context ?? {},
            channel: "EMAIL",
          }).body
        : undefined);
  }

  const data: Prisma.MessageUncheckedCreateInput = {
    organizationId,
    conversationId: req.conversationId,
    customerId: req.customerId,
    reminderId: req.reminderId,
    direction: "OUTBOUND",
    channel: picked.channel,
    to: picked.address,
    subject,
    body,
    attachments: (req.attachments ?? []) as unknown as Prisma.InputJsonValue,
    status: "QUEUED",
    provider,
    kind: req.kind.toUpperCase() as
      "REMINDER" | "TRANSACTIONAL" | "CONVERSATION" | "DIGEST" | "SYSTEM",
    templateKey: req.templateKey,
    idempotencyKey: req.idempotencyKey,
    sentById: req.sentById ?? null,
  };

  try {
    const message = await tx.message.create({ data });
    return { created: true, message: { id: message.id, channel: picked.channel } };
  } catch (error) {
    // Course entre deux appels concurrents avec la même idempotencyKey (RG-M11-01) :
    // l'un des deux perd la contrainte unique, on renvoie le message créé par l'autre.
    const isUniqueViolation =
      typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    if (isUniqueViolation) {
      const concurrent = await tx.message.findFirst({
        where: { idempotencyKey: req.idempotencyKey, channel: picked.channel },
      });
      if (concurrent) {
        return { created: false, message: { id: concurrent.id, channel: picked.channel } };
      }
    }
    throw error;
  }
}
