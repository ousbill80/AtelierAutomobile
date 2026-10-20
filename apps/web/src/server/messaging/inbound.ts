// RG-M11-18 (rattachement), RG-M11-19 (STOP/START), RG-M11-21 (assignation/statuts),
// RG-M11-11/16 (statuts sortants, idempotence). Partagé par les 3 routes webhooks
// (whatsapp, sms/[provider], email/[provider]).
//
// Simplifications documentées :
// - RG-M11-20 (classement IA de l'intention) : délégué à M17 (`ai/inbox.ts`, RG-M17-11/12),
//   après l'enregistrement du message, hors mots-clés STOP/START.
// - RG-M11-21 (assignation au dernier conseiller) : nécessite M03/M04/M10, non branché ; une
//   nouvelle conversation reste toujours non assignée (file commune).
import { adminDb, db } from "@atelieros/db";
import {
  isStartKeyword,
  isStopKeyword,
  nextStatus,
  normalizePhoneCI,
  type Channel,
  type OutboundMessageStatus,
} from "@atelieros/core";
import type { ProviderMessageStatus } from "@atelieros/integrations";
import { processInboundAi } from "../ai/inbox";
import { emitDomainEvent } from "../events/emit";
import { markMessageFailedWithFallback } from "./fallback";
import { enqueueMessageSendJob } from "./queue";

type TenantDb = ReturnType<typeof db.forTenant>;

function normalizeAddress(channel: Channel, address: string): string {
  if (channel === "EMAIL") return address.trim().toLowerCase();
  const result = normalizePhoneCI(address);
  return result.status === "OK" && result.e164 ? result.e164 : address;
}

async function findCandidateCustomerIds(
  tx: TenantDb,
  channel: Channel,
  address: string,
): Promise<string[]> {
  if (channel === "EMAIL") {
    const customers = await tx.customer.findMany({ where: { email: address, deletedAt: null } });
    return customers.map((c) => c.id);
  }
  const [byCustomer, byContact, byVehicle] = await Promise.all([
    tx.customer.findMany({
      where: {
        OR: [{ phone: address }, { phone2: address }, { whatsappPhone: address }],
        deletedAt: null,
      },
    }),
    tx.customerContact.findMany({ where: { OR: [{ phone: address }, { phone2: address }] } }),
    tx.vehicle.findMany({ where: { driverPhone: address } }),
  ]);
  const ids = new Set<string>();
  for (const c of byCustomer) ids.add(c.id);
  for (const c of byContact) ids.add(c.customerId);
  for (const v of byVehicle) ids.add(v.customerId);
  return [...ids];
}

export interface InboundMessageInput {
  organizationId: string;
  channel: Channel;
  from: string;
  body: string;
  occurredAt: Date;
}

/** RG-M11-18/19/21 : rattachement, STOP/START, création du `Message` entrant. */
export async function recordInboundMessage(input: InboundMessageInput): Promise<void> {
  const tx = db.forTenant({ organizationId: input.organizationId });
  const address = normalizeAddress(input.channel, input.from);

  let conversation = await tx.conversation.findFirst({
    where: { channel: input.channel, externalAddress: address },
  });

  let customerId: string | null = conversation?.customerId ?? null;
  let candidateCustomerIds: string[] = [];
  if (
    !conversation ||
    (!conversation.customerId && conversation.candidateCustomerIds.length === 0)
  ) {
    const candidates = await findCandidateCustomerIds(tx, input.channel, address);
    if (candidates.length === 1) {
      customerId = candidates[0]!;
    } else if (candidates.length > 1) {
      candidateCustomerIds = candidates;
    }
  } else {
    candidateCustomerIds = conversation.candidateCustomerIds;
  }

  const windowExpiresAt =
    input.channel === "WHATSAPP"
      ? new Date(input.occurredAt.getTime() + 24 * 60 * 60 * 1000)
      : null;

  if (conversation) {
    conversation = await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        customerId,
        candidateCustomerIds,
        lastMessageAt: input.occurredAt,
        lastInboundAt: input.occurredAt,
        unreadCount: { increment: 1 },
        status: "OPEN", // RG-M11-21 : un message entrant rouvre PENDING/CLOSED
        ...(windowExpiresAt ? { whatsappWindowExpiresAt: windowExpiresAt } : {}),
      },
    });
  } else {
    conversation = await tx.conversation.create({
      data: {
        organizationId: input.organizationId,
        customerId,
        candidateCustomerIds,
        channel: input.channel,
        externalAddress: address,
        lastMessageAt: input.occurredAt,
        lastInboundAt: input.occurredAt,
        unreadCount: 1,
        ...(windowExpiresAt ? { whatsappWindowExpiresAt: windowExpiresAt } : {}),
      },
    });
  }

  const message = await tx.message.create({
    data: {
      organizationId: input.organizationId,
      conversationId: conversation.id,
      customerId,
      direction: "INBOUND",
      channel: input.channel,
      to: "",
      from: address,
      body: input.body,
      status: "RECEIVED",
      provider: "webhook",
      kind: "CONVERSATION",
      sentById: null,
    },
  });

  const stop = isStopKeyword(input.body);
  if (stop) {
    await handleOptOut(tx, input.organizationId, address, customerId, message.id, conversation.id);
  } else if (isStartKeyword(input.body)) {
    await handleOptIn(tx, address, customerId);
  }

  // RG-M10-22 : consommé par `reminders.on_event` (STOP → OPTED_OUT ; sinon → REPLIED,
  // séquence suspendue 48 h).
  await emitDomainEvent(tx, input.organizationId, "message.inbound_received", {
    address,
    customerId,
    messageId: message.id,
    conversationId: conversation.id,
    stop,
    occurredAt: input.occurredAt.toISOString(),
  });

  if (!stop && !isStartKeyword(input.body)) {
    // M17 : classification + brouillon. Attente bornée (RG-M17-01 : « dans les 10 s ») pour ne
    // jamais retenir le webhook ; au-delà, le traitement se poursuit en arrière-plan.
    const work = processInboundAi({
      organizationId: input.organizationId,
      conversationId: conversation.id,
      messageId: message.id,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      work,
      new Promise((resolve) => {
        timer = setTimeout(resolve, INBOUND_AI_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }
}

const INBOUND_AI_WAIT_MS = 9_000;

async function handleOptOut(
  tx: TenantDb,
  organizationId: string,
  address: string,
  customerId: string | null,
  messageId: string,
  conversationId: string,
): Promise<void> {
  const existing = await tx.optOut.findFirst({ where: { address, channel: null } });
  if (existing) return; // déjà désinscrit (accusé déjà envoyé une fois)

  await tx.optOut.create({
    data: { organizationId, address, channel: null, source: "keyword", messageId },
  });
  if (customerId) {
    await tx.customer.update({ where: { id: customerId }, data: { optedOutAt: new Date() } });
  }
  await tx.conversation.update({ where: { id: conversationId }, data: { lastIntent: "OPT_OUT" } });
}

async function handleOptIn(
  tx: TenantDb,
  address: string,
  customerId: string | null,
): Promise<void> {
  await tx.optOut.deleteMany({ where: { address, channel: null } });
  if (customerId) {
    await tx.customer.update({ where: { id: customerId }, data: { optedOutAt: null } });
  }
}

export interface StatusEventInput {
  organizationId: string;
  providerMessageId: string;
  status: ProviderMessageStatus;
  occurredAt: Date;
}

const STATUS_TIMESTAMP_FIELD: Record<
  ProviderMessageStatus,
  "sentAt" | "deliveredAt" | "readAt" | null
> = {
  SENT: "sentAt",
  DELIVERED: "deliveredAt",
  READ: "readAt",
  FAILED: null,
};

/** RG-M11-11/16 : idempotence par (providerMessageId, status), mise à jour monotone du statut. */
export async function recordStatusEvent(input: StatusEventInput): Promise<void> {
  const tx = db.forTenant({ organizationId: input.organizationId });

  const message = await tx.message.findFirst({
    where: { providerMessageId: input.providerMessageId },
  });
  if (!message) {
    console.warn("webhook : message introuvable (isolation ou id inconnu)", {
      providerMessageId: input.providerMessageId,
    });
    return;
  }

  const existingEvent = await tx.messageStatusEvent.findFirst({
    where: { providerMessageId: input.providerMessageId, status: input.status },
  });
  if (existingEvent) return; // doublon (webhook rejoué)

  await tx.messageStatusEvent.create({
    data: {
      organizationId: input.organizationId,
      messageId: message.id,
      providerMessageId: input.providerMessageId,
      status: input.status,
      occurredAt: input.occurredAt,
    },
  });

  const resolvedStatus = nextStatus(
    message.status as OutboundMessageStatus,
    input.status as OutboundMessageStatus,
  );
  const timestampField = STATUS_TIMESTAMP_FIELD[input.status];

  if (input.status === "FAILED" && resolvedStatus === "FAILED") {
    // RG-M11-05 : un FAILED signalé après coup (webhook) déclenche le même repli immédiat
    // qu'une erreur synchrone à l'envoi (cf. markMessageFailedWithFallback).
    const fallback = await markMessageFailedWithFallback(
      input.organizationId,
      message.id,
      "PROVIDER_REPORTED_FAILURE",
    );
    if (fallback) {
      await enqueueMessageSendJob(fallback.id);
    }
  } else {
    await tx.message.update({
      where: { id: message.id },
      data: {
        status: resolvedStatus,
        ...(timestampField ? { [timestampField]: input.occurredAt } : {}),
      },
    });
  }

  if (
    message.channel === "WHATSAPP" &&
    (input.status === "DELIVERED" || input.status === "READ") &&
    message.customerId
  ) {
    await tx.customer.update({
      where: { id: message.customerId },
      data: { hasWhatsapp: true, hasWhatsappCheckedAt: input.occurredAt },
    });
  }

  // RG-M11-17 : rebond définitif ou plainte → email invalide, plus d'envoi jusqu'à correction.
  // `ProviderEvent` ne distingue pas rebond/plainte (les deux deviennent `FAILED` dans
  // l'adaptateur Resend) : on applique donc par prudence la même conséquence aux deux plutôt
  // que de risquer de réessayer vers une adresse qui rejette.
  if (message.channel === "EMAIL" && input.status === "FAILED" && message.customerId) {
    await tx.customer.update({
      where: { id: message.customerId },
      data: { emailInvalidAt: input.occurredAt },
    });
  }
}

/**
 * Routage multi-organisation WhatsApp (RG-M11-11) : balaye les `ChannelConfig` actifs
 * `whatsapp_cloud` (hors tenant, le webhook n'a pas encore de contexte locataire) pour trouver
 * celui dont les identifiants déchiffrés portent ce `phoneNumberId`.
 */
export async function findOrganizationByWhatsappPhoneNumberId(
  phoneNumberId: string,
  decrypt: (ciphertext: string) => string,
): Promise<{ organizationId: string; credentials: Record<string, unknown> } | null> {
  const configs = await adminDb.channelConfig.findMany({
    where: { channel: "WHATSAPP", provider: "whatsapp_cloud", isActive: true },
  });
  for (const config of configs) {
    try {
      const credentials = JSON.parse(decrypt(config.credentials)) as Record<string, unknown>;
      if (credentials.phoneNumberId === phoneNumberId) {
        return { organizationId: config.organizationId, credentials };
      }
    } catch {
      continue; // secret illisible (mauvaise clé) : ignoré, pas ce canal
    }
  }
  return null;
}

/** Routage SMS/email (RG-M11-16/17) : jeton secret dans l'URL, propre à chaque `ChannelConfig`. */
export async function findOrganizationByWebhookToken(
  channel: Channel,
  provider: string,
  token: string,
  decrypt: (ciphertext: string) => string,
): Promise<{ organizationId: string; credentials: Record<string, unknown> } | null> {
  const config = await adminDb.channelConfig.findFirst({
    where: { channel, provider, isActive: true, webhookVerifyToken: token },
  });
  if (!config) return null;
  try {
    return {
      organizationId: config.organizationId,
      credentials: JSON.parse(decrypt(config.credentials)),
    };
  } catch {
    return null;
  }
}
