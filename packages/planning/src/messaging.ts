import { normalizePhoneCI } from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  createConsoleMessagingProvider,
  defaultOutbox,
  isLocalProvider,
  loadEncryptionKey,
  resolveMessagingProvider,
  type MessageChannel,
  type MessagingProvider,
} from "@atelieros/integrations";

export interface MessageRecipient {
  id: string;
  phone: string | null;
  phone2?: string | null;
  whatsappPhone: string | null;
  hasWhatsapp: boolean | null;
  email: string | null;
  preferredChannel: "WHATSAPP" | "SMS" | "EMAIL" | null;
}

function isMobile(e164: string | null | undefined): boolean {
  if (!e164) return false;
  try {
    const parsed = normalizePhoneCI(e164);
    return parsed.type === "MOBILE" || parsed.type === "FOREIGN";
  } catch {
    return false;
  }
}

/**
 * Ordre de repli M11 : WhatsApp → SMS → email (canal préféré du client en premier).
 * `null` = client injoignable par écrit (fixe uniquement) → « Appels de confirmation à passer ».
 */
export function pickChannel(
  recipient: MessageRecipient,
): { channel: MessageChannel; to: string } | null {
  const mobile = isMobile(recipient.phone)
    ? recipient.phone!
    : isMobile(recipient.phone2)
      ? recipient.phone2!
      : null;
  const whatsapp =
    recipient.hasWhatsapp !== false
      ? isMobile(recipient.whatsappPhone)
        ? recipient.whatsappPhone!
        : mobile
      : null;
  const candidates: Array<{ channel: MessageChannel; to: string } | null> = [
    whatsapp ? { channel: "WHATSAPP", to: whatsapp } : null,
    mobile ? { channel: "SMS", to: mobile } : null,
    recipient.email ? { channel: "EMAIL", to: recipient.email } : null,
  ];
  const ordered = recipient.preferredChannel
    ? [
        ...candidates.filter((c) => c?.channel === recipient.preferredChannel),
        ...candidates.filter((c) => c?.channel !== recipient.preferredChannel),
      ]
    : candidates;
  return ordered.find((c): c is { channel: MessageChannel; to: string } => c !== null) ?? null;
}

async function providerFor(
  organizationId: string,
  channel: MessageChannel,
): Promise<{ provider: MessagingProvider; name: string }> {
  const tenantDb = db.forTenant({ organizationId });
  const configs = await tenantDb.channelConfig.findMany({
    where: { channel, isActive: true },
    orderBy: { priority: "asc" },
  });
  if (configs.length === 0 || isLocalProvider(configs[0]!.provider)) {
    return { provider: createConsoleMessagingProvider(channel, defaultOutbox), name: "console" };
  }
  const provider = await resolveMessagingProvider(organizationId, channel, {
    store: { listActive: async () => configs },
    encryptionKey: loadEncryptionKey(),
    outbox: defaultOutbox,
  });
  return { provider, name: configs[0]!.provider };
}

export interface SendCustomerMessageInput {
  organizationId: string;
  recipient: MessageRecipient;
  body: string;
  templateKey: string;
  /** Clé d'idempotence (M11 §14) : un même événement n'envoie jamais deux fois. */
  idempotencyKey: string;
  sentById?: string | null;
  reminderId?: string | null;
}

/**
 * Message transactionnel (confirmation, déplacement, annulation, rappel) : résout le canal du
 * client, envoie via le fournisseur actif de l'organisation (console en local/tests) et trace une
 * ligne `Message`. Transactionnel = envoyé même si le client est désinscrit des relances (RG-M03-08).
 * Renvoie `null` si le client n'a aucun canal écrit.
 */
export async function sendCustomerMessage(
  input: SendCustomerMessageInput,
): Promise<{ messageId: string; channel: MessageChannel; to: string } | null> {
  const target = pickChannel(input.recipient);
  if (!target) return null;
  const tenantDb = db.forTenant({ organizationId: input.organizationId });

  const existing = await tenantDb.message.findFirst({
    where: { idempotencyKey: input.idempotencyKey, channel: target.channel },
    select: { id: true },
  });
  if (existing) {
    return { messageId: existing.id, channel: target.channel, to: target.to };
  }

  const { provider, name: providerName } = await providerFor(input.organizationId, target.channel);
  const message = await tenantDb.message.create({
    data: {
      organizationId: input.organizationId,
      customerId: input.recipient.id,
      reminderId: input.reminderId ?? null,
      direction: "OUTBOUND",
      channel: target.channel,
      to: target.to,
      body: input.body,
      status: "SENDING",
      provider: providerName,
      idempotencyKey: input.idempotencyKey,
      sentById: input.sentById ?? null,
    },
  });

  try {
    const result = await provider.send({
      to: target.to,
      channel: target.channel,
      body: input.body,
      templateKey: input.templateKey,
    });
    await tenantDb.message.update({
      where: { id: message.id },
      data: {
        status: "SENT",
        providerMessageId: result.providerMessageId,
        cost: result.cost ?? null,
        sentAt: new Date(),
      },
    });
  } catch (error) {
    await tenantDb.message.update({
      where: { id: message.id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
  }
  return { messageId: message.id, channel: target.channel, to: target.to };
}
