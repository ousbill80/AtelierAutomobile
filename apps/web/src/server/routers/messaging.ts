import { TRPCError } from "@trpc/server";
import {
  clientNamespace,
  deliveryState,
  formatDate,
  formatFCFA,
  garageNamespace,
  isDomainError,
  normalizePhoneCI,
  renderTemplate,
  resolvePermissions,
  toWhatsappParams,
  vehicleNamespace,
  whatsappTemplateName,
  type Channel,
} from "@atelieros/core";
import { adminDb, db, type Prisma, type ScopedTenantClient } from "@atelieros/db";
import {
  conversationAssignInputSchema,
  conversationGetInputSchema,
  conversationListInputSchema,
  conversationMarkReadInputSchema,
  conversationReplyInputSchema,
  conversationSetStatusInputSchema,
  messageLogInputSchema,
  messagingHistoryInputSchema,
  messagingSendInputSchema,
  waLinkConfirmInputSchema,
  waLinkInputSchema,
} from "@atelieros/validators";
import { buildWaLinkUrl } from "@atelieros/core";
import { requirePermission, router } from "../trpc";

type AssigneeRow = { id: string; user: { name: string } } | null;
const assigneeSelect = { select: { id: true, user: { select: { name: true } } } } as const;
const toAssignee = (row: AssigneeRow, meId: string) =>
  row ? { id: row.id, name: row.user.name, isMe: row.id === meId } : null;

/** Membres actifs qui peuvent lire les messages : ceux à qui l'on peut confier une conversation. */
async function listAssignableMembers(tenantDb: ReturnType<typeof db.forTenant>) {
  const [members, roleRows] = await Promise.all([
    tenantDb.membership.findMany({
      where: { isActive: true },
      select: { id: true, role: true, permissions: true, user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    tenantDb.rolePermission.findMany({ select: { role: true, permissions: true } }),
  ]);
  const byRole = new Map(roleRows.map((r) => [r.role, r.permissions]));
  return members.filter((m) =>
    resolvePermissions({
      role: m.role,
      organizationRolePermissions: byRole.get(m.role),
      membershipOverrides: m.permissions,
    }).has("message:read"),
  );
}
import { createInvoicePaymentLink, issueInvoicePortalLink } from "../billing/paymentLinks";
import { messagingEnqueue, type EnqueueRequest } from "../messaging/enqueue";
import { enqueueMessageSendJob, type WhatsappSendJobPayload } from "../messaging/queue";

const CHANNEL_LABEL: Record<Channel, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "email",
};

function externalAddress(channel: Channel, raw: string): string {
  if (channel === "EMAIL") return raw.trim().toLowerCase();
  const result = normalizePhoneCI(raw);
  return result.status === "OK" && result.e164 ? result.e164 : raw;
}

function referencedVariables(template: string): Set<string> {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
    const name = match[1]!;
    if (name !== "formatMoney" && name !== "formatDate" && name !== "upper") found.add(name);
  }
  for (const match of template.matchAll(
    /\{\{\s*(?:formatMoney|formatDate|upper)\s+([a-zA-Z0-9_.]+)\s*\}\}/g,
  )) {
    found.add(match[1]!);
  }
  return found;
}

function needsVariable(vars: Set<string>, prefix: string): boolean {
  for (const name of vars) {
    if (name === prefix || name.startsWith(`${prefix}.`)) return true;
  }
  return false;
}

function contextValue(context: Record<string, unknown>, path: string): string {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, context);
  return value == null ? "" : String(value);
}

function recipientAddress(
  customer: { phone: string | null; whatsappPhone: string | null; email: string | null },
  channel: Channel,
): string | null {
  if (channel === "EMAIL") return customer.email;
  if (channel === "WHATSAPP") return customer.whatsappPhone ?? customer.phone;
  return customer.phone;
}

/** Ouvre ou réutilise la conversation du couple (canal, adresse) pour que l'envoi apparaisse dans la boîte. */
async function ensureConversation(
  tx: ScopedTenantClient,
  organizationId: string,
  customerId: string,
  channel: Channel,
  address: string,
): Promise<string> {
  const existing = await tx.conversation.findFirst({
    where: { channel, externalAddress: address },
  });
  const now = new Date();
  if (existing) {
    await tx.conversation.update({
      where: { id: existing.id },
      data: {
        customerId: existing.customerId ?? customerId,
        lastMessageAt: now,
        ...(existing.status === "CLOSED" ? { status: "OPEN" } : {}),
      },
    });
    return existing.id;
  }
  try {
    const created = await tx.conversation.create({
      data: {
        organizationId,
        customerId,
        channel,
        externalAddress: address,
        lastMessageAt: now,
        unreadCount: 0,
      },
    });
    return created.id;
  } catch (error) {
    const unique =
      typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    if (!unique) throw error;
    const raced = await tx.conversation.findFirst({
      where: { channel, externalAddress: address },
    });
    if (!raced) throw error;
    return raced.id;
  }
}

export const messagingRouter = router({
  send: requirePermission("message:send")
    .input(messagingSendInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!input.templateKey && !input.body) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Écrivez le message ou choisissez un modèle.",
        });
      }
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const customer = await tenantDb.customer.findFirst({ where: { id: input.customerId } });
      if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "Client introuvable." });

      const channel = input.channel;
      let conversationId: string | undefined;
      let context = input.context;
      let whatsappJob: WhatsappSendJobPayload | undefined;
      let whatsappParamPaths: string[] | undefined;
      let portalInvoiceId: string | undefined;
      let deliverViaWaLink = false;
      let templateBody: string | undefined;

      if (channel) {
        const raw = recipientAddress(customer, channel);
        if (!raw) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              channel === "EMAIL"
                ? "Ce client n'a pas d'adresse email."
                : "Ce client n'a pas de numéro de téléphone.",
          });
        }
        if (channel === "EMAIL" && customer.emailInvalidAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "L'adresse email de ce client n'est plus valide.",
          });
        }
        const address = externalAddress(channel, raw);
        const configs = await tenantDb.channelConfig.findMany({
          where: { channel, isActive: true },
        });
        const config =
          configs
            .filter((row) => row.status !== "ERROR")
            .sort((a, b) => a.priority - b.priority)[0] ?? null;
        if (!config) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Le canal ${CHANNEL_LABEL[channel]} n'est pas activé. Activez-le dans Paramètres → Canaux.`,
          });
        }
        if (config.provider === "console" && process.env.APP_ENV === "production") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Le canal ${CHANNEL_LABEL[channel]} est encore en mode simulation. Choisissez un fournisseur réel dans Paramètres → Canaux.`,
          });
        }
        if (config.provider === "wa_link") deliverViaWaLink = true;
        const optedOut = await tenantDb.optOut.findFirst({
          where: {
            address: { in: [raw, address] },
            OR: [{ channel: null }, { channel }],
          },
        });
        if (optedOut) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Ce client ne souhaite plus recevoir de messages par ${CHANNEL_LABEL[channel]}.`,
          });
        }
        if (channel === "WHATSAPP" && !input.templateKey && !deliverViaWaLink) {
          const existing = await tenantDb.conversation.findFirst({
            where: { channel: "WHATSAPP", externalAddress: address },
          });
          const windowOpen =
            !!existing?.whatsappWindowExpiresAt &&
            existing.whatsappWindowExpiresAt.getTime() > Date.now();
          if (!windowOpen) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Hors des 24 h après le dernier message WhatsApp du client, envoyez un modèle approuvé.",
            });
          }
        }

        if (input.templateKey) {
          const template = await tenantDb.messageTemplate.findFirst({
            where: { key: input.templateKey, channel, isActive: true },
          });
          if (!template) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Aucun modèle actif « ${input.templateKey} » pour le canal ${CHANNEL_LABEL[channel]}.`,
            });
          }
          templateBody = template.body;
          const vars = referencedVariables(`${template.subject ?? ""}\n${template.body}`);
          const unsupported = [...vars].find((name) =>
            ["rdv.", "devis.", "vt.", "revision.", "assurance.", "factures."].some((prefix) =>
              name.startsWith(prefix),
            ),
          );
          if (unsupported) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Ce modèle dépend d'un rendez-vous, d'un devis ou d'une échéance véhicule. Écrivez un texte libre, ou laissez la relance automatique l'envoyer.",
            });
          }
          const org = await adminDb.organization.findUnique({
            where: { id: ctx.organizationId },
          });
          const built: Record<string, unknown> = {
            ...(input.context ?? {}),
            garage: garageNamespace({
              name: org?.name,
              phone: org?.phone,
              address: org?.address,
              city: org?.city,
            }),
            client: clientNamespace({
              civility:
                customer.civility === "M" ||
                customer.civility === "MME" ||
                customer.civility === "MLLE"
                  ? customer.civility
                  : null,
              lastName: customer.lastName,
              displayName: customer.displayName,
            }),
            lien: {},
          };
          const needsInvoice =
            needsVariable(vars, "facture") || vars.has("lien.facture") || vars.has("lien.paiement");
          if (needsInvoice) {
            if (!input.invoiceId) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Choisissez la facture concernée : ce modèle en a besoin.",
              });
            }
            const invoice = await tenantDb.invoice.findFirst({
              where: { id: input.invoiceId, customerId: customer.id },
            });
            if (!invoice) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Cette facture n'appartient pas à ce client.",
              });
            }
            if (invoice.status === "DRAFT" || invoice.status === "VOID" || !invoice.number) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Cette facture n'est pas émise : elle ne peut pas partir dans un message.",
              });
            }
            built.facture = {
              numero: invoice.number,
              echeance: invoice.dueDate
                ? formatDate(invoice.dueDate, org?.timezone ?? "Africa/Abidjan")
                : "",
              solde: formatFCFA(invoice.balance),
            };
            if (needsVariable(vars, "vehicule")) {
              const vehicle = invoice.vehicleId
                ? await tenantDb.vehicle.findFirst({ where: { id: invoice.vehicleId } })
                : null;
              if (!vehicle) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Ce modèle cite le véhicule, et cette facture n'en a pas.",
                });
              }
              built.vehicule = vehicleNamespace(vehicle);
            }
            if (vars.has("lien.paiement")) {
              const link = await createInvoicePaymentLink({
                organizationId: ctx.organizationId,
                invoiceId: invoice.id,
                reuse: true,
                createdById: ctx.membership.id,
                now: new Date(),
              });
              (built.lien as Record<string, string>).paiement = link.url;
            }
            if (vars.has("lien.facture")) portalInvoiceId = invoice.id;
          }
          context = built;
          if (channel === "WHATSAPP" && !deliverViaWaLink) {
            const storedMap = Array.isArray(template.whatsappParamMap)
              ? template.whatsappParamMap.filter((item): item is string => typeof item === "string")
              : [];
            const paramMap =
              storedMap.length > 0 ? storedMap : toWhatsappParams(template.body).paramMap;
            whatsappParamPaths = paramMap;
            whatsappJob = {
              templateName:
                template.whatsappTemplateName ??
                whatsappTemplateName(org?.slug ?? "garage", template.key, template.whatsappVersion),
              templateLanguage: template.whatsappLanguage ?? "fr",
            };
          }
        }
      }

      if (deliverViaWaLink) {
        const raw = recipientAddress(customer, "WHATSAPP");
        if (!raw) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ce client n'a pas de numéro de téléphone.",
          });
        }
        if (portalInvoiceId && context) {
          try {
            await tenantDb.transaction(async (tx) => {
              const invoice = await tx.invoice.findFirst({
                where: { id: portalInvoiceId, customerId: customer.id },
              });
              if (!invoice) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Cette facture n'appartient pas à ce client.",
                });
              }
              const portal = await issueInvoicePortalLink(
                tx,
                invoice,
                ctx.membership.id,
                new Date(),
              );
              const lien = (context.lien ?? {}) as Record<string, string>;
              context.lien = { ...lien, facture: portal.url };
            });
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            if (isDomainError(error)) {
              throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
            }
            throw error;
          }
        }
        let body = input.body ?? "";
        if (input.templateKey) {
          if (!templateBody) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Modèle introuvable." });
          }
          try {
            body = renderTemplate({
              template: templateBody,
              context: (context ?? {}) as Record<string, unknown>,
              channel: "WHATSAPP",
            }).body;
          } catch (error) {
            if (isDomainError(error)) {
              throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
            }
            throw error;
          }
        }
        return {
          message: null,
          waUrl: buildWaLinkUrl(externalAddress("WHATSAPP", raw), body),
          body,
        };
      }

      const phone = customer.phone ? externalAddress("SMS", customer.phone) : null;
      const whatsappRaw = customer.whatsappPhone ?? customer.phone;
      const channels: Channel[] = channel ? [channel] : ["WHATSAPP", "SMS", "EMAIL"];
      const req: EnqueueRequest = {
        idempotencyKey: `manual:${customer.id}:${Date.now()}`,
        kind: "conversation",
        customerId: customer.id,
        to: {
          phone,
          whatsapp: whatsappRaw ? externalAddress("WHATSAPP", whatsappRaw) : null,
          email: customer.email ? externalAddress("EMAIL", customer.email) : null,
        },
        channels,
        templateKey: input.templateKey,
        whatsappTemplateName: whatsappJob?.templateName,
        bodyOverride: input.templateKey ? undefined : input.body,
        subjectOverride: input.subject,
        context,
        sentById: ctx.membership.id,
      };

      let result;
      try {
        result = await tenantDb.transaction(async (tx) => {
          if (channel) {
            const raw = recipientAddress(customer, channel);
            if (raw) {
              conversationId = await ensureConversation(
                tx,
                ctx.organizationId,
                customer.id,
                channel,
                externalAddress(channel, raw),
              );
            }
          }
          if (portalInvoiceId && context) {
            const invoice = await tx.invoice.findFirst({
              where: { id: portalInvoiceId, customerId: customer.id },
            });
            if (!invoice) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Cette facture n'appartient pas à ce client.",
              });
            }
            const portal = await issueInvoicePortalLink(tx, invoice, ctx.membership.id, new Date());
            const lien = (context.lien ?? {}) as Record<string, string>;
            context.lien = { ...lien, facture: portal.url };
          }
          return messagingEnqueue(tx, ctx.organizationId, { ...req, context, conversationId });
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        if (isDomainError(error)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        throw error;
      }
      if (!result.created && "reason" in result) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Aucun canal disponible pour ce client.",
        });
      }
      if (whatsappJob && whatsappParamPaths && whatsappParamPaths.length > 0 && context) {
        whatsappJob = {
          ...whatsappJob,
          templateParams: whatsappParamPaths.map((path) => contextValue(context, path)),
        };
      }
      try {
        await enqueueMessageSendJob(result.message.id, 0, whatsappJob);
      } catch (error) {
        if (isDomainError(error)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        throw error;
      }
      return {
        message: await tenantDb.message.findFirst({ where: { id: result.message.id } }),
        waUrl: null,
        body: null,
      };
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
      if (!customer || !address) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ce client n'a pas de numéro WhatsApp.",
        });
      }
      const normalized = externalAddress("WHATSAPP", address);
      const message = await tenantDb.transaction(async (tx) => {
        const conversationId = await ensureConversation(
          tx,
          ctx.organizationId,
          customer.id,
          "WHATSAPP",
          normalized,
        );
        return tx.message.create({
          data: {
            organizationId: ctx.organizationId,
            conversationId,
            customerId: input.customerId,
            direction: "OUTBOUND",
            channel: "WHATSAPP",
            to: normalized,
            body: input.body,
            status: "SENT",
            provider: "wa_link",
            kind: "CONVERSATION",
            sentById: ctx.membership.id,
            sentAt: new Date(),
          },
        });
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

  /** Messages › Envois : tout ce qui est parti vers les clients, avec l'accusé de remise. */
  log: requirePermission("message:read")
    .input(messageLogInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const base: Prisma.MessageWhereInput = { direction: "OUTBOUND" };
      if (input.channel) base.channel = input.channel;
      if (input.kind) base.kind = input.kind;
      const and: Prisma.MessageWhereInput[] = [];
      const q = input.q?.trim();
      if (q) {
        and.push({
          OR: [
            { customer: { displayName: { contains: q, mode: "insensitive" } } },
            { to: { contains: q.replace(/\s/g, ""), mode: "insensitive" } },
            { body: { contains: q, mode: "insensitive" } },
          ],
        });
      }
      const stateWhere: Record<string, Prisma.MessageWhereInput> = {
        PENDING: { status: { in: ["QUEUED", "SENDING"] } },
        FAILED: { status: "FAILED" },
        READ: { OR: [{ readAt: { not: null } }, { status: "READ" }] },
        DELIVERED: {
          readAt: null,
          OR: [{ deliveredAt: { not: null } }, { status: "DELIVERED" }],
        },
        UNCONFIRMED: {
          status: "SENT",
          deliveredAt: null,
          readAt: null,
          provider: { notIn: ["console", "wa_link"] },
          sentAt: { lt: new Date(now.getTime() - 2 * 3_600_000) },
        },
      };
      const where: Prisma.MessageWhereInput = {
        ...base,
        AND: [...and, ...(input.state ? [stateWhere[input.state]!] : [])],
      };
      const rows = await tenantDb.message.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          channel: true,
          kind: true,
          to: true,
          subject: true,
          body: true,
          status: true,
          provider: true,
          errorMessage: true,
          templateKey: true,
          conversationId: true,
          createdAt: true,
          sentAt: true,
          deliveredAt: true,
          readAt: true,
          customer: { select: { id: true, displayName: true } },
          sentBy: { select: { user: { select: { name: true } } } },
          primaryForReminders: { select: { type: true }, take: 1 },
        },
      });
      const page = rows.slice(0, input.limit);
      const nextCursor = rows.length > input.limit ? rows[input.limit - 1]!.id : null;

      let summary: Record<
        "PENDING" | "FAILED" | "UNCONFIRMED" | "DELIVERED" | "READ",
        number
      > | null = null;
      if (!input.cursor) {
        const scoped = (extra: Prisma.MessageWhereInput) => ({ ...base, AND: [...and, extra] });
        const [pending, failed, unconfirmed, delivered, read] = await Promise.all(
          (["PENDING", "FAILED", "UNCONFIRMED", "DELIVERED", "READ"] as const).map((s) =>
            tenantDb.message.count({ where: scoped(stateWhere[s]!) }),
          ),
        );
        summary = {
          PENDING: pending!,
          FAILED: failed!,
          UNCONFIRMED: unconfirmed!,
          DELIVERED: delivered!,
          READ: read!,
        };
      }

      return {
        items: page.map(({ primaryForReminders, sentBy, body, ...m }) => ({
          ...m,
          preview: body.slice(0, 220),
          delivery: deliveryState(m),
          reminderType: primaryForReminders[0]?.type ?? null,
          sentByName: sentBy?.user.name ?? null,
        })),
        nextCursor,
        summary,
      };
    }),

  conversations: router({
    list: requirePermission("message:read")
      .input(conversationListInputSchema)
      .query(async ({ ctx, input }) => {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        const where: Prisma.ConversationWhereInput = {};
        if (input.channel) where.channel = input.channel;
        if (input.filter === "UNREAD") where.unreadCount = { gt: 0 };
        if (input.filter === "ASSIGNED_TO_ME") where.assignedToId = ctx.membership.id;
        if (input.filter === "UNASSIGNED") where.assignedToId = null;
        const search = input.search?.trim();
        if (search) {
          where.OR = [
            { customer: { displayName: { contains: search, mode: "insensitive" } } },
            { externalAddress: { contains: search.replace(/\s/g, ""), mode: "insensitive" } },
          ];
        }
        const rows = await tenantDb.conversation.findMany({
          where,
          orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: {
            customer: { select: { id: true, displayName: true } },
            assignedTo: assigneeSelect,
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                body: true,
                subject: true,
                direction: true,
                createdAt: true,
                status: true,
                provider: true,
                sentAt: true,
                deliveredAt: true,
                readAt: true,
              },
            },
          },
        });
        const page = rows.slice(0, input.limit);
        const nextCursor = rows.length > input.limit ? rows[input.limit - 1]!.id : null;
        const [unreadTotal, counts] = await Promise.all([
          tenantDb.conversation.count({ where: { unreadCount: { gt: 0 } } }),
          input.cursor
            ? Promise.resolve(null)
            : Promise.all([
                tenantDb.conversation.count(),
                tenantDb.conversation.count({ where: { unreadCount: { gt: 0 } } }),
                tenantDb.conversation.count({ where: { assignedToId: ctx.membership.id } }),
                tenantDb.conversation.count({ where: { assignedToId: null } }),
              ]).then(([all, unread, mine, unassigned]) => ({
                ALL: all,
                UNREAD: unread,
                ASSIGNED_TO_ME: mine,
                UNASSIGNED: unassigned,
              })),
        ]);
        return {
          items: page.map(({ messages, assignedTo, ...conversation }) => {
            const last = messages[0];
            return {
              ...conversation,
              assignee: toAssignee(assignedTo, ctx.membership.id),
              lastMessage: last
                ? {
                    preview: (last.subject ? `${last.subject} — ` : "") + last.body.slice(0, 140),
                    direction: last.direction,
                    at: last.createdAt,
                    delivery: last.direction === "OUTBOUND" ? deliveryState(last) : null,
                  }
                : null,
            };
          }),
          nextCursor,
          unreadTotal,
          counts,
        };
      }),

    get: requirePermission("message:read")
      .input(conversationGetInputSchema)
      .query(async ({ ctx, input }) => {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        const conversation = await tenantDb.conversation.findFirst({
          where: { id: input.id },
          include: { customer: true, assignedTo: assigneeSelect },
        });
        if (!conversation) throw new TRPCError({ code: "NOT_FOUND" });
        // Fil complet : messages de la conversation + envois automatiques (relances, reçus,
        // documents) partis vers la même adresse, pour que la réponse du client ait son contexte.
        const rows = await tenantDb.message.findMany({
          where: {
            OR: [
              { conversationId: input.id },
              {
                conversationId: null,
                direction: "OUTBOUND",
                channel: conversation.channel,
                to: conversation.externalAddress,
              },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          include: {
            primaryForReminders: { select: { type: true, stepKey: true }, take: 1 },
          },
        });
        const messages = rows.reverse().map(({ primaryForReminders, ...m }) => ({
          ...m,
          delivery: m.direction === "OUTBOUND" ? deliveryState(m) : null,
          reminderType: primaryForReminders[0]?.type ?? null,
        }));
        const { assignedTo, ...rest } = conversation;
        return {
          conversation: { ...rest, assignee: toAssignee(assignedTo, ctx.membership.id) },
          messages,
          truncated: rows.length === 200,
          windowExpiresAt: conversation.whatsappWindowExpiresAt,
        };
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

    // Membres à qui confier une conversation (menu « Pris en charge par »).
    assignees: requirePermission("message:read").query(async ({ ctx }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const members = await listAssignableMembers(tenantDb);
      return members.map((m) => ({
        id: m.id,
        name: m.user.name,
        role: m.role,
        isMe: m.id === ctx.membership.id,
      }));
    }),

    assign: requirePermission("message:assign")
      .input(conversationAssignInputSchema)
      .mutation(async ({ ctx, input }) => {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        const conversation = await tenantDb.conversation.findFirst({
          where: { id: input.conversationId },
          select: { id: true },
        });
        if (!conversation) throw new TRPCError({ code: "NOT_FOUND" });
        if (input.assignedToId) {
          const members = await listAssignableMembers(tenantDb);
          if (!members.some((m) => m.id === input.assignedToId)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Ce membre ne peut pas recevoir de conversation (compte désactivé ou sans accès aux messages).",
            });
          }
        }
        const updated = await tenantDb.conversation.update({
          where: { id: conversation.id },
          data: { assignedToId: input.assignedToId },
          include: { assignedTo: assigneeSelect },
        });
        return { id: updated.id, assignee: toAssignee(updated.assignedTo, ctx.membership.id) };
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
