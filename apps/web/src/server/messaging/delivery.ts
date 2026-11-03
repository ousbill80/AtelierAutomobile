// Accusé de réception des messages envoyés aux clients (relances, documents) : état de remise
// calculé par core/messaging/delivery à partir des retours des fournisseurs.
import { deliveryState } from "@atelieros/core";
import type { db } from "@atelieros/db";

type TenantDb = ReturnType<typeof db.forTenant>;

export async function deliveriesFor(tenantDb: TenantDb, messageIds: string[]) {
  const messages = messageIds.length
    ? await tenantDb.message.findMany({
        where: { id: { in: messageIds } },
        select: {
          id: true,
          status: true,
          provider: true,
          channel: true,
          sentAt: true,
          deliveredAt: true,
          readAt: true,
        },
      })
    : [];
  return new Map(
    messages.map((m) => [
      m.id,
      {
        state: deliveryState(m),
        channel: m.channel,
        sentAt: m.sentAt,
        deliveredAt: m.deliveredAt,
        readAt: m.readAt,
      },
    ]),
  );
}
