// RG-M11-26 : simulateurs `/dev/outbox`, jamais exposés en production. Pas de session requise
// (cf. page `/dev/outbox`, hors du groupe de routes authentifiées) : garde explicite NODE_ENV.
import { TRPCError } from "@trpc/server";
import type { Channel } from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  devOutboxSimulateInputSchema,
  devOutboxSimulateReplyInputSchema,
} from "@atelieros/validators";
import { publicProcedure, router } from "../trpc";
import { recordInboundMessage, recordStatusEvent } from "../messaging/inbound";
import { markMessageFailedWithFallback } from "../messaging/fallback";
import { enqueueMessageSendJob } from "../messaging/queue";

const devProcedure = publicProcedure.use(({ next }) => {
  if (process.env.APP_ENV === "production") {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return next();
});

async function findMessageOrThrow(providerMessageId: string) {
  const message = await adminDb.message.findFirst({ where: { providerMessageId } });
  if (!message) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Message introuvable dans l'outbox." });
  }
  return message;
}

export const devOutboxRouter = router({
  simulate: devProcedure.input(devOutboxSimulateInputSchema).mutation(async ({ input }) => {
    const message = await findMessageOrThrow(input.providerMessageId);

    if (input.outcome === "DELIVERED" || input.outcome === "READ") {
      await recordStatusEvent({
        organizationId: message.organizationId,
        providerMessageId: input.providerMessageId,
        status: input.outcome,
        occurredAt: new Date(),
      });
      return { ok: true };
    }

    const errorCode =
      input.outcome === "FAILED_NOT_ON_WHATSAPP" ? "NOT_ON_WHATSAPP" : "SIMULATED_FAILURE";
    if (
      input.outcome === "FAILED_NOT_ON_WHATSAPP" &&
      message.channel === "WHATSAPP" &&
      message.customerId
    ) {
      await db.forTenant({ organizationId: message.organizationId }).customer.update({
        where: { id: message.customerId },
        data: { hasWhatsapp: false, hasWhatsappCheckedAt: new Date() },
      });
    }
    const fallback = await markMessageFailedWithFallback(
      message.organizationId,
      message.id,
      errorCode,
    );
    if (fallback) {
      await enqueueMessageSendJob(fallback.id);
    }
    return { ok: true };
  }),

  simulateReply: devProcedure
    .input(devOutboxSimulateReplyInputSchema)
    .mutation(async ({ input }) => {
      const message = await findMessageOrThrow(input.providerMessageId);
      await recordInboundMessage({
        organizationId: message.organizationId,
        channel: message.channel as Channel,
        from: message.to,
        body: input.body,
        occurredAt: new Date(),
      });
      return { ok: true };
    }),
});
