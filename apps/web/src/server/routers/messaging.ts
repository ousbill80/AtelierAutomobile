import { TRPCError } from "@trpc/server";
import type { Channel } from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  conversationAssignInputSchema,
  conversationGetInputSchema,
  conversationListInputSchema,
  conversationMarkReadInputSchema,
  conversationReplyInputSchema,
  conversationSetStatusInputSchema,
  messagingHistoryInputSchema,
  messagingSendInputSchema,
  waLinkConfirmInputSchema,
  waLinkInputSchema,
} from "@atelieros/validators";
import { buildWaLinkUrl } from "@atelieros/core";
import { requirePermission, router } from "../trpc";
import { messagingEnqueue, type EnqueueRequest } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";

export const messagingRouter = router({
  send: requirePermission("message:send")
    .input(messagingSendInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const customer = await tenantDb.customer.findFirst({ where: { id: input.customerId } });
      if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "Client introuvable." });

      const channels: Channel[] = input.channel ? [input.channel] : ["WHATSAPP", "SMS", "EMAIL"];
      const req: EnqueueRequest = {
        idempotencyKey: `manual:${customer.id}:${Date.now()}`,
        kind: "conversation",
        customerId: customer.id,
        to: {
          phone: customer.phone,
          whatsapp: customer.whatsappPhone ?? customer.phone,
          email: customer.email,
        },
        channels,
        templateKey: input.templateKey,
        bodyOverride: input.templateKey ? undefined : input.body,
        subjectOverride: input.subject,
        context: input.context,
        sentById: ctx.membership.id,
      };
      const result = await tenantDb.transaction((tx) =>
        messagingEnqueue(tx, ctx.organizationId, req),
      );
      if (!result.created && "reason" in result) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Aucun canal disponible pour ce client.",
        });
      }
      await enqueueMessageSendJob(result.message.id);
      return tenantDb.message.findFirst({ where: { id: result.message.id } });
    }),

  waLink: requirePermission("message:send")
    .input(waLinkInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const customer = await tenantDb.customer.findFirst({ where: { id: input.customerId } });
      const address = customer ? (customer.whatsappPhone ?? customer.phone) : null;
      if (!address) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ce client n'a pas de numéro WhatsApp.",
        });
      }
      return { url: buildWaLinkUrl(address, input.body) };
    }),

  waLinkConfirm: requirePermission("message:send")
    .input(waLinkConfirmInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!input.sent) return { message: null };
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const customer = await tenantDb.customer.findFirst({ where: { id: input.customerId } });
      const address = customer ? (customer.whatsappPhone ?? customer.phone) : null;
      if (!address) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ce client n'a pas de numéro WhatsApp.",
        });
      }
      const message = await tenantDb.message.create({
        data: {
          organizationId: ctx.organizationId,
          customerId: input.customerId,
          direction: "OUTBOUND",
          channel: "WHATSAPP",
          to: address,
          body: input.body,
          status: "SENT",
          provider: "wa_link",
          kind: "CONVERSATION",
          sentById: ctx.membership.id,
          sentAt: new Date(),
        },
      });
      return { message };
    }),

  history: requirePermission("message:history")
    .input(messagingHistoryInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const where: Record<string, unknown> = {};
      if (input.channel) where.channel = input.channel;
      if (input.customerId) where.customerId = input.customerId;
      if (input.from || input.to) {
        where.createdAt = {
          ...(input.from ? { gte: input.from } : {}),
          ...(input.to ? { lte: input.to } : {}),
        };
      }
      const items = await tenantDb.message.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
      const totalCost = items.reduce((sum, m) => sum + (m.cost ?? 0), 0);
      return { items, totals: { count: items.length, cost: totalCost } };
    }),

  conversations: router({
    list: requirePermission("message:read")
      .input(conversationListInputSchema)
      .query(async ({ ctx, input }) => {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        const where: Record<string, unknown> = {};
        if (input.channel) where.channel = input.channel;
        if (input.filter === "UNREAD") where.unreadCount = { gt: 0 };
        if (input.filter === "ASSIGNED_TO_ME") where.assignedToId = ctx.membership.id;
        if (input.filter === "UNASSIGNED") where.assignedToId = null;
        const items = await tenantDb.conversation.findMany({
          where,
          orderBy: { lastMessageAt: "desc" },
          take: input.limit,
          include: { customer: true },
        });
        const unreadTotal = await tenantDb.conversation.count({
          where: { unreadCount: { gt: 0 } },
        });
        return { items, nextCursor: null, unreadTotal };
      }),

    get: requirePermission("message:read")
      .input(conversationGetInputSchema)
      .query(async ({ ctx, input }) => {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        const conversation = await tenantDb.conversation.findFirst({
          where: { id: input.id },
          include: { customer: true },
        });
        if (!conversation) throw new TRPCError({ code: "NOT_FOUND" });
        const messages = await tenantDb.message.findMany({
          where: { conversationId: input.id },
          orderBy: { createdAt: "asc" },
        });
        return { conversation, messages, windowExpiresAt: conversation.whatsappWindowExpiresAt };
      }),

    reply: requirePermission("message:send")
      .input(conversationReplyInputSchema)
      .mutation(async ({ ctx, input }) => {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        const conversation = await tenantDb.conversation.findFirst({
          where: { id: input.conversationId },
        });
        if (!conversation) throw new TRPCError({ code: "NOT_FOUND" });

        const channel = conversation.channel as Channel;
        const to =
          channel === "EMAIL"
            ? { email: conversation.externalAddress }
            : channel === "WHATSAPP"
              ? { whatsapp: conversation.externalAddress }
              : { phone: conversation.externalAddress };

        const req: EnqueueRequest = {
          idempotencyKey: `reply:${conversation.id}:${Date.now()}`,
          kind: "conversation",
          customerId: conversation.customerId ?? undefined,
          conversationId: conversation.id,
          to,
          channels: [channel],
          templateKey: input.templateKey,
          bodyOverride: input.templateKey ? undefined : input.body,
          sentById: ctx.membership.id,
        };
        const result = await tenantDb.transaction((tx) =>
          messagingEnqueue(tx, ctx.organizationId, req),
        );
        if (!result.created && "reason" in result) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Canal indisponible pour cette conversation.",
          });
        }
        await enqueueMessageSendJob(result.message.id);
        await tenantDb.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date(), status: "OPEN" },
        });
        return tenantDb.message.findFirst({ where: { id: result.message.id } });
      }),

    assign: requirePermission("message:assign")
      .input(conversationAssignInputSchema)
      .mutation(async ({ ctx, input }) => {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        return tenantDb.conversation.update({
          where: { id: input.conversationId },
          data: { assignedToId: input.assignedToId },
        });
      }),

    setStatus: requirePermission("message:assign")
      .input(conversationSetStatusInputSchema)
      .mutation(async ({ ctx, input }) => {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        return tenantDb.conversation.update({
          where: { id: input.conversationId },
          data: { status: input.status },
        });
      }),

    markRead: requirePermission("message:read")
      .input(conversationMarkReadInputSchema)
      .mutation(async ({ ctx, input }) => {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        return tenantDb.conversation.update({
          where: { id: input.conversationId },
          data: { unreadCount: 0 },
        });
      }),
  }),
});
