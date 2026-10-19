// RG-M11-05 : crée le message de repli sur le prochain canal disponible. Partagé par les
// webhooks (statut FAILED signalé après coup) et les simulateurs `/dev/outbox` (RG-M11-26).
//
// Duplique volontairement une partie de `apps/worker/src/jobs/messagesSend.ts` (même
// construction des candidats, même ordre de repli par défaut) : les deux apps n'ont pas de
// package partagé pour la logique d'orchestration touchant la base (packages/core reste pur,
// packages/integrations se limite aux adaptateurs fournisseurs) — dupliquer ce petit bloc est
// plus simple qu'introduire un nouveau package partagé pour ce seul besoin.
import { db, type Prisma } from "@atelieros/db";
import { pickChannel, type Channel, type ChannelCandidate } from "@atelieros/core";

type TenantDb = ReturnType<typeof db.forTenant>;
const CHANNEL_ORDER: Channel[] = ["WHATSAPP", "SMS", "EMAIL"];

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

async function findActiveChannelConfig(tx: TenantDb, channel: Channel) {
  const configs = await tx.channelConfig.findMany({ where: { channel, isActive: true } });
  // `status: { not: "ERROR" }` exclurait aussi les lignes status = NULL (sémantique SQL NULL) : filtré en JS.
  return (
    configs.filter((c) => c.status !== "ERROR").sort((a, b) => a.priority - b.priority)[0] ?? null
  );
}

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
        isOptedOut: false,
        isAddressInvalid: channel === "EMAIL" ? !!customer?.emailInvalidAt : false,
        isChannelActive: true,
      };
    },
  );

  const picked = pickChannel({ candidates });
  if (picked.channel === null) return null;

  const activeConfig = await findActiveChannelConfig(tx, picked.channel);
  if (!activeConfig) return null;

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

/** Marque le message FAILED et crée le repli (RG-M11-05) ; renvoie l'id du message de repli créé. */
export async function markMessageFailedWithFallback(
  organizationId: string,
  messageId: string,
  errorCode: string,
): Promise<{ id: string; channel: Channel } | null> {
  const tx = db.forTenant({ organizationId });
  await tx.message.update({
    where: { id: messageId },
    data: { status: "FAILED", errorCode, failedAt: new Date() },
  });
  const full = await tx.message.findFirstOrThrow({ where: { id: messageId } });
  const tried = await triedChannelsOf(tx, full);
  return createFallbackMessage(tx, organizationId, full, tried);
}
