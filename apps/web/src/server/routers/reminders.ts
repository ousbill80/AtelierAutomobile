// §8 — routeur `reminders` (file du jour, échéances, actions). RG-M10-20 (actions),
// RG-M10-21 (suppressions), RG-M10-31/32 (sans canal / numéro invalide).
import { TRPCError } from "@trpc/server";
import {
  addDays,
  buildManualDedupeKey,
  canSendAutomatically,
  channelsToSend,
  channelModes,
  countByDay,
  dayRange,
  monthRange,
  isDomainError,
  renderTemplate,
  smsSegments,
  type Channel,
} from "@atelieros/core";
import { db, type Prisma } from "@atelieros/db";
import {
  reminderApproveInputSchema,
  reminderCreateManualInputSchema,
  reminderDueCalendarInputSchema,
  reminderDueDatesInputSchema,
  reminderDueRemindInputSchema,
  reminderDueRemindPreviewInputSchema,
  reminderGetInputSchema,
  reminderHistoryInputSchema,
  reminderMarkAppointmentTakenInputSchema,
  reminderMarkInspectionDoneInputSchema,
  reminderMarkWaLinkSentInputSchema,
  reminderPreviewInputSchema,
  reminderQueueInputSchema,
  reminderRetryInputSchema,
  reminderSendViaInputSchema,
  reminderSkipInputSchema,
  reminderSnoozeInputSchema,
  reminderStatsInputSchema,
  reminderStepSchema,
  reminderUpdateInputSchema,
} from "@atelieros/validators";
import { z } from "zod";
import { emitDomainEvent } from "../events/emit";
import { buildPreviewContext } from "../reminders/context";
import { loadChannelModes, loadCustomerAddresses } from "../receivables/remind";
import { deliveriesFor } from "../messaging/delivery";
import { writeAuditLog } from "../audit";
import { createDueReminders, loadDueCandidates, requireDueRule } from "../reminders/dueRemind";
import { requirePermission, router } from "../trpc";

const CANCELLABLE_STATUSES = ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] as const;

/** Champ d'échéance du véhicule selon l'onglet de l'écran Échéances. */
function dueField(
  kind: "INSPECTION" | "SERVICE" | "INSURANCE",
): "inspectionExpiryDate" | "nextServiceDueDate" | "insuranceExpiryDate" {
  if (kind === "INSPECTION") return "inspectionExpiryDate";
  if (kind === "INSURANCE") return "insuranceExpiryDate";
  return "nextServiceDueDate";
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
const FINISHED_STATUSES = ["SENT", "FAILED", "CANCELLED", "SKIPPED"] as const;

/**
 * Relances terminées dont l'activité tombe dans [from, to] : date d'envoi pour une relance
 * envoyée, sinon date de dernière mise à jour (échec, annulation, ignorée).
 */
function historyWhere(input: {
  from: Date;
  to: Date;
  type?: Prisma.ReminderWhereInput["type"];
  channel?: Prisma.ReminderWhereInput["channel"];
  customerId?: string;
  vehicleId?: string;
  q?: string;
}): Prisma.ReminderWhereInput {
  const range = { gte: input.from, lte: input.to };
  const q = input.q?.trim();
  const compact = q?.replace(/[\s-]/g, "").toUpperCase();
  return {
    status: { in: [...FINISHED_STATUSES] },
    AND: [
      { OR: [{ sentAt: range }, { sentAt: null, updatedAt: range }] },
      ...(q
        ? [
            {
              OR: [
                { customer: { displayName: { contains: q, mode: "insensitive" as const } } },
                { vehicle: { plateCompact: { contains: compact } } },
                { invoice: { number: { contains: q, mode: "insensitive" as const } } },
              ],
            },
          ]
        : []),
    ],
    ...(input.type ? { type: input.type } : {}),
    ...(input.channel ? { channel: input.channel } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
  };
}

type TenantDb = ReturnType<typeof db.forTenant>;

/** Messages de relance réellement envoyés (≤ 7 j, > 2 h) sans accusé de remise. */
async function unconfirmedMessageIds(tenantDb: TenantDb, now: Date): Promise<string[]> {
  const rows = await tenantDb.message.findMany({
    where: {
      kind: "REMINDER",
      status: "SENT",
      deliveredAt: null,
      readAt: null,
      provider: { notIn: ["console", "wa_link"] },
      sentAt: {
        gte: new Date(now.getTime() - 7 * 86_400_000),
        lt: new Date(now.getTime() - 2 * 3_600_000),
      },
    },
    select: { id: true },
    take: 500,
  });
  return rows.map((m) => m.id);
}

function tabWhere(tab: string, now: Date): Prisma.ReminderWhereInput {
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  switch (tab) {
    case "TO_APPROVE":
      return { status: "NEEDS_APPROVAL", channel: { not: null } };
    case "PLANNED_TODAY":
      return { status: "PLANNED", scheduledFor: { gte: dayStart, lt: dayEnd } };
    case "SENT_TODAY":
      return { status: "SENT", sentAt: { gte: dayStart, lt: dayEnd } };
    case "FAILED":
      return { status: "FAILED" };
    case "TO_CALL":
      return { status: "NEEDS_APPROVAL", channel: null };
    case "EXPIRED":
      return { status: "SKIPPED", skippedReason: "Non traitée à temps" };
    case "BLOCKED":
      return { OR: [{ status: "FAILED" }, { status: "NEEDS_APPROVAL", channel: null }] };
    default:
      return {};
  }
}

export const remindersRouter = router({
  queue: requirePermission("reminder:read")
    .input(reminderQueueInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const unconfirmedIds = await unconfirmedMessageIds(tenantDb, now);
      const where: Prisma.ReminderWhereInput = {
        ...(input.tab === "UNCONFIRMED"
          ? { status: "SENT", messageId: { in: unconfirmedIds } }
          : tabWhere(input.tab, now)),
        ...(input.types && input.types.length > 0 ? { type: { in: input.types } } : {}),
        ...(input.channels && input.channels.length > 0 ? { channel: { in: input.channels } } : {}),
        ...(input.customerId ? { customerId: input.customerId } : {}),
        ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
      };

      const items = await tenantDb.reminder.findMany({
        where,
        orderBy: [{ priority: "asc" }, { scheduledFor: "asc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          customer: true,
          vehicle: true,
          invoice: { select: { number: true, balance: true } },
        },
      });
      const nextCursor = items.length > input.limit ? items[input.limit - 1]!.id : null;

      const tabs = [
        "TO_APPROVE",
        "PLANNED_TODAY",
        "SENT_TODAY",
        "FAILED",
        "TO_CALL",
        "EXPIRED",
        "BLOCKED",
      ] as const;
      // Une seule transaction : `forTenant` ouvre sinon une tx par count, et
      // Promise.all saturaient le pool (P2028) sous charge / en CI.
      const counts = await tenantDb.transaction(async (tx) => {
        const entries: Array<readonly [(typeof tabs)[number], number]> = [];
        for (const t of tabs) {
          entries.push([t, await tx.reminder.count({ where: tabWhere(t, now) })]);
        }
        entries.push([
          "UNCONFIRMED" as never,
          await tx.reminder.count({ where: { status: "SENT", messageId: { in: unconfirmedIds } } }),
        ]);
        return Object.fromEntries(entries);
      });

      // Accusé de réception de chaque relance (✓ envoyé, ✓✓ reçu, ✓✓ lu…).
      const page = items.slice(0, input.limit);
      const deliveries = await deliveriesFor(
        tenantDb,
        page.map((r) => r.messageId).filter((id): id is string => !!id),
      );
      return {
        items: page.map((r) => ({
          ...r,
          delivery: r.messageId ? (deliveries.get(r.messageId) ?? null) : null,
        })),
        counts,
        nextCursor,
      };
    }),

  get: requirePermission("reminder:read")
    .input(reminderGetInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const reminder = await tenantDb.reminder.findFirstOrThrow({
        where: { id: input.id },
        include: { customer: true, vehicle: true, rule: true },
      });
      const history = reminder.sequenceKey
        ? await tenantDb.reminder.findMany({
            where: { sequenceKey: reminder.sequenceKey },
            orderBy: { createdAt: "asc" },
          })
        : [];
      return { reminder, history };
    }),

  preview: requirePermission("reminder:read")
    .input(reminderPreviewInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const reminder = await tenantDb.reminder.findFirstOrThrow({
        where: { id: input.id },
        include: { rule: true },
      });

      const steps = z.array(reminderStepSchema).parse(reminder.rule.steps);
      const step = steps.find((s) => s.key === reminder.stepKey);
      const templateKey = step?.templateKey ?? reminder.stepKey;

      const context = await buildPreviewContext(tenantDb, ctx.organizationId, reminder);
      let body = reminder.renderedBody ?? "";
      let subject = reminder.renderedSubject ?? undefined;
      const warnings: string[] = [];
      if (!reminder.renderedBody) {
        const template = await tenantDb.messageTemplate.findFirst({
          where: { key: templateKey, channel: input.channel, isActive: true },
        });
        if (!template) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Aucun modèle actif pour ce canal." });
        }
        try {
          body = renderTemplate({ template: template.body, context, channel: input.channel }).body;
          subject = template.subject
            ? renderTemplate({ template: template.subject, context, channel: "EMAIL" }).body
            : undefined;
        } catch (error) {
          if (isDomainError(error)) {
            warnings.push(error.message);
          } else {
            throw error;
          }
        }
      }

      const sms = input.channel === "SMS" && body ? smsSegments(body) : null;
      if (sms && sms.encoding === "UCS2") {
        warnings.push(`Caractères non GSM-7 : ${sms.nonGsmChars.join(" ")}.`);
      }

      return { body, subject, sms, warnings };
    }),

  approve: requirePermission("reminder:approve")
    .input(reminderApproveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const reminders = await tenantDb.reminder.findMany({
        where: { id: { in: input.ids }, status: { in: ["NEEDS_APPROVAL", "PLANNED", "FAILED"] } },
        include: { rule: true },
      });

      const cancelled: { id: string; reason: string }[] = [];
      let queued = 0;
      let scheduled = 0;
      const now = new Date();

      for (const reminder of reminders) {
        const steps = z.array(reminderStepSchema).parse(reminder.rule.steps);
        const step = steps.find((s) => s.key === reminder.stepKey);
        if (step?.requiresPermission && !ctx.permissions.has(step.requiresPermission as never)) {
          cancelled.push({ id: reminder.id, reason: "Permission manquante pour ce palier." });
          continue;
        }
        await tenantDb.reminder.update({
          where: { id: reminder.id },
          data: {
            status: "PLANNED",
            approvedById: ctx.membership.id,
            approvedAt: now,
            scheduledFor: input.sendNow
              ? now
              : reminder.scheduledFor < now
                ? now
                : reminder.scheduledFor,
          },
        });
        if (input.sendNow) queued += 1;
        else scheduled += 1;
      }

      return { queued, scheduled, cancelled };
    }),

  update: requirePermission("reminder:approve")
    .input(reminderUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await tenantDb.reminder.findFirstOrThrow({
        where: { id: input.id, status: { in: ["NEEDS_APPROVAL", "PLANNED"] } },
      });
      return tenantDb.reminder.update({
        where: { id: input.id },
        data: {
          ...(input.body
            ? { renderedBody: input.body, editedBody: true, editedById: ctx.membership.id }
            : {}),
          ...(input.subject ? { renderedSubject: input.subject } : {}),
          ...(input.channel ? { channel: input.channel } : {}),
        },
      });
    }),

  snooze: requirePermission("reminder:approve")
    .input(reminderSnoozeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const result = await tenantDb.reminder.updateMany({
        where: { id: { in: input.ids }, status: { in: [...CANCELLABLE_STATUSES] } },
        data: { status: "SNOOZED", snoozedUntil: input.until },
      });
      return { updated: result.count };
    }),

  skip: requirePermission("reminder:approve")
    .input(reminderSkipInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const result = await tenantDb.reminder.updateMany({
        where: { id: { in: input.ids }, status: { in: [...CANCELLABLE_STATUSES] } },
        data: { status: "SKIPPED", skippedReason: input.reason },
      });
      if (input.stopSequence) {
        const reminders = await tenantDb.reminder.findMany({
          where: { id: { in: input.ids } },
          select: { sequenceKey: true },
        });
        for (const { sequenceKey } of reminders) {
          if (!sequenceKey) continue;
          await tenantDb.reminderSuppression.create({
            data: {
              organizationId: ctx.organizationId,
              sequenceKey,
              reason: "Arrêter la séquence",
              source: "staff",
              createdById: ctx.membership.id,
            },
          });
        }
      }
      return { updated: result.count };
    }),

  /** « Renvoyer par… » : canaux possibles pour cette relance (joignable ? configuré ?). */
  channelOptions: requirePermission("reminder:read")
    .input(reminderGetInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const reminder = await tenantDb.reminder.findFirstOrThrow({
        where: { id: input.id },
        select: { customerId: true },
      });
      const [addresses, configs] = await Promise.all([
        loadCustomerAddresses(tenantDb, reminder.customerId),
        tenantDb.channelConfig.findMany({
          select: { channel: true, provider: true, isActive: true, status: true, lastError: true },
        }),
      ]);
      const modes = channelModes(configs);
      return (["WHATSAPP", "SMS", "EMAIL"] as const).map((channel) => {
        const address = addresses[channel] ?? null;
        return {
          channel,
          mode: modes[channel],
          address,
          error:
            modes[channel] === "off"
              ? (configs.find((c) => c.channel === channel && c.isActive && c.status === "ERROR")
                  ?.lastError ?? null)
              : null,
        };
      });
    }),

  /** « Renvoyer par… » : envoie la relance tout de suite par le canal choisi, sans repli. */
  sendVia: requirePermission("reminder:approve")
    .input(reminderSendViaInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const reminder = await tenantDb.reminder.findFirst({
        where: {
          id: input.id,
          status: { in: ["NEEDS_APPROVAL", "FAILED", "PLANNED", "SNOOZED"] },
        },
      });
      if (!reminder) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cette relance est déjà partie ou a été annulée.",
        });
      }
      const [addresses, modes] = await Promise.all([
        loadCustomerAddresses(tenantDb, reminder.customerId),
        loadChannelModes(tenantDb),
      ]);
      const label = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "email" }[input.channel];
      if (!addresses[input.channel]) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            input.channel === "EMAIL"
              ? "Ce client n'a pas d'email : ajoutez-le sur sa fiche, ou choisissez un autre canal."
              : `Ce client n'a pas de numéro mobile pour le ${label} : complétez sa fiche, ou choisissez un autre canal.`,
        });
      }
      if (!canSendAutomatically(modes[input.channel])) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            modes[input.channel] === "manual_only"
              ? "WhatsApp est en mode lien : utilisez « Ouvrir dans WhatsApp »."
              : `Le canal ${label} n'est pas configuré ou est en erreur : voir Paramètres › Canaux.`,
        });
      }
      const now = new Date();
      await tenantDb.reminder.update({
        where: { id: reminder.id },
        data: {
          status: "PLANNED",
          channel: input.channel,
          channelLocked: true,
          scheduledFor: now,
          snoozedUntil: null,
          skippedReason: null,
          approvedById: ctx.membership.id,
          approvedAt: now,
        },
      });
      return { channel: input.channel };
    }),

  retry: requirePermission("reminder:approve")
    .input(reminderRetryInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await tenantDb.reminder.findFirstOrThrow({ where: { id: input.id, status: "FAILED" } });
      return tenantDb.reminder.update({
        where: { id: input.id },
        data: { status: "PLANNED", scheduledFor: new Date() },
      });
    }),

  createManual: requirePermission("reminder:approve")
    .input(reminderCreateManualInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const rule = await tenantDb.reminderRule.findFirst({ where: { type: input.type } });
      if (!rule) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Aucune règle pour ce type de relance.",
        });
      }
      const now = new Date();
      const dedupeKey = buildManualDedupeKey(input.type, input.vehicleId ?? input.customerId, now);
      return tenantDb.reminder.create({
        data: {
          organizationId: ctx.organizationId,
          ruleId: rule.id,
          type: input.type,
          stepKey: "MANUAL",
          customerId: input.customerId,
          vehicleId: input.vehicleId,
          dueDate: now,
          scheduledFor: now,
          status: "NEEDS_APPROVAL",
          channel: input.channel,
          renderedBody: input.body,
          dedupeKey,
        },
      });
    }),

  /** Échéances › « Relancer » : véhicules (et autres véhicules du client), canaux disponibles. */
  dueRemindPreview: requirePermission("reminder:approve")
    .input(reminderDueRemindPreviewInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const [vehicles, modes, configs] = await Promise.all([
        loadDueCandidates(tenantDb, input.kind, input.vehicleIds, new Date()),
        loadChannelModes(tenantDb),
        tenantDb.channelConfig.findMany({
          select: { channel: true, isActive: true, status: true, lastError: true },
        }),
      ]);
      return {
        channels: (["WHATSAPP", "SMS", "EMAIL"] as const).map((channel) => ({
          channel,
          mode: modes[channel],
          error:
            modes[channel] === "off"
              ? (configs.find((c) => c.channel === channel && c.isActive && c.status === "ERROR")
                  ?.lastError ?? null)
              : null,
        })),
        vehicles,
      };
    }),

  /**
   * Échéances › « Relancer » : une relance par véhicule et par canal, déjà approuvée ; chaque
   * véhicule a son propre message.
   */
  dueRemind: requirePermission("reminder:approve")
    .input(reminderDueRemindInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const rule = await requireDueRule(tenantDb, input.kind);
      const modes = await loadChannelModes(tenantDb);
      const wanted = new Set(input.vehicleIds);
      const candidates = (
        await loadDueCandidates(tenantDb, input.kind, input.vehicleIds, now)
      ).filter((c) => wanted.has(c.vehicleId));
      const customers = new Set<string>();
      let vehicles = 0;
      let messages = 0;
      const skipped: { plate: string; customerName: string; reason: string }[] = [];
      for (const candidate of candidates) {
        if (!candidate.eligible) {
          skipped.push({
            plate: candidate.plate,
            customerName: candidate.customerName,
            reason: candidate.reasonMessage!,
          });
          continue;
        }
        const channels = channelsToSend(input.channels, candidate.reachable, modes);
        if (channels.length === 0) {
          skipped.push({
            plate: candidate.plate,
            customerName: candidate.customerName,
            reason: "Aucun contact pour les canaux choisis.",
          });
          continue;
        }
        await createDueReminders(tenantDb, {
          organizationId: ctx.organizationId,
          membershipId: ctx.membership.id,
          ruleId: rule.id,
          kind: input.kind,
          candidate,
          channels,
          now,
        });
        vehicles += 1;
        messages += channels.length;
        customers.add(candidate.customerId);
      }
      // Un message par client et par canal (les véhicules d'un client sont regroupés).
      if (vehicles > 0) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "reminder.due_remind",
          entity: "Vehicle",
          entityId: input.vehicleIds[0]!,
          reason: `Relance d'échéance (${input.kind}) : ${vehicles} véhicule(s), ${customers.size} client(s), ${messages} message(s) (${input.channels.join(", ")}).`,
          after: { kind: input.kind, vehicleIds: input.vehicleIds, channels: input.channels },
          ip: ctx.ip,
        });
      }
      return { customers: customers.size, vehicles, messages, skipped };
    }),

  markWaLinkSent: requirePermission("reminder:approve")
    .input(reminderMarkWaLinkSentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const reminder = await tenantDb.reminder.findFirstOrThrow({
        where: { id: input.id, status: { in: ["NEEDS_APPROVAL", "PLANNED"] } },
      });
      const customer = await tenantDb.customer.findFirst({ where: { id: reminder.customerId } });
      const address = customer?.whatsappPhone ?? customer?.phone;
      if (!address) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ce client n'a pas de numéro WhatsApp.",
        });
      }
      const message = await tenantDb.message.create({
        data: {
          organizationId: ctx.organizationId,
          customerId: reminder.customerId,
          reminderId: reminder.id,
          direction: "OUTBOUND",
          channel: "WHATSAPP" as Channel,
          to: address,
          body: input.body ?? reminder.renderedBody ?? "",
          status: "SENT",
          provider: "wa_link",
          kind: "REMINDER",
          sentById: ctx.membership.id,
          sentAt: new Date(),
        },
      });
      return tenantDb.reminder.update({
        where: { id: reminder.id },
        data: { status: "SENT", channel: "WHATSAPP", messageId: message.id, sentAt: new Date() },
      });
    }),

  dueDates: requirePermission("reminder:read")
    .input(reminderDueDatesInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const field = dueField(input.kind);
      const now = startOfUtcDay(new Date());
      const where: Prisma.VehicleWhereInput = { deletedAt: null };
      if (input.day) {
        const { from, to } = dayRange(input.day);
        where[field] = { gte: from, lt: to };
      } else if (input.filter === "UPCOMING") where[field] = { gte: now };
      else if (input.filter === "EXPIRED") where[field] = { lt: now, not: null };
      else if (input.filter === "MISSING_DATA") where[field] = null;
      else if (input.filter === "CLIENT") where[field] = { gte: now, lte: addDays(now, 30) };
      else if (input.filter === "WORKSHOP")
        where[field] = { gt: addDays(now, 30), lte: addDays(now, 60) };
      else where[field] = { not: null };

      const vehicles = await tenantDb.vehicle.findMany({
        where,
        orderBy: { [field]: "asc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: { customer: true },
      });
      const nextCursor = vehicles.length > input.limit ? vehicles[input.limit - 1]!.id : null;
      return { items: vehicles.slice(0, input.limit), nextCursor };
    }),

  /** M10 §7.2 — calendrier mensuel : nombre d'échéances par jour (points colorés). */
  dueCalendar: requirePermission("reminder:read")
    .input(reminderDueCalendarInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const field = dueField(input.kind);
      const { from, to } = monthRange(input.month);
      const vehicles = await tenantDb.vehicle.findMany({
        where: { deletedAt: null, [field]: { gte: from, lt: to } },
        select: { inspectionExpiryDate: true, nextServiceDueDate: true, insuranceExpiryDate: true },
      });
      const days = countByDay(vehicles.map((vehicle) => vehicle[field]));
      return { month: input.month, days, total: vehicles.length };
    }),

  /** Compteurs de l'écran Échéances : préparation atelier (1 à 2 mois) et relance client (30 j). */
  dueOverview: requirePermission("reminder:read").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const today = startOfUtcDay(new Date());
    const in30 = addDays(today, 30);
    const in60 = addDays(today, 60);
    const count = (
      field: "inspectionExpiryDate" | "nextServiceDueDate" | "insuranceExpiryDate",
      where: Prisma.DateTimeNullableFilter,
    ) => tenantDb.vehicle.count({ where: { deletedAt: null, [field]: where } });
    const [workshop, client, expired, missing] = await Promise.all([
      count("inspectionExpiryDate", { gt: in30, lte: in60 }),
      count("inspectionExpiryDate", { gte: today, lte: in30 }),
      count("inspectionExpiryDate", { lt: today, not: null }),
      tenantDb.vehicle.count({ where: { deletedAt: null, inspectionExpiryDate: null } }),
    ]);
    return { workshop, client, expired, missing };
  }),

  markAppointmentTaken: requirePermission("reminder:approve")
    .input(reminderMarkAppointmentTakenInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const until = new Date((input.date ?? new Date()).getTime() + 24 * 60 * 60 * 1000);
      await tenantDb.reminderSuppression.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: input.vehicleId,
          until,
          reason: "RDV pris",
          source: "staff",
          createdById: ctx.membership.id,
        },
      });
      await tenantDb.reminder.updateMany({
        where: { vehicleId: input.vehicleId, status: { in: [...CANCELLABLE_STATUSES] } },
        data: { status: "CANCELLED", skippedReason: "RDV pris" },
      });
      // Simplification : la création d'un véritable Appointment relève de M03 (pas encore
      // construit) ; cette action ne fait que suspendre les relances du véhicule.
      return { suppressed: true };
    }),

  markInspectionDone: requirePermission("vehicle:update")
    .input(reminderMarkInspectionDoneInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: {
          inspectionExpiryDate: input.expiryDate,
          inspectionLastDate: input.lastDate,
          inspectionCenter: input.center,
        },
      });
      await tenantDb.reminder.updateMany({
        where: {
          vehicleId: input.vehicleId,
          type: "INSPECTION",
          status: { in: [...CANCELLABLE_STATUSES] },
        },
        data: { status: "CANCELLED", skippedReason: "Visite technique effectuée" },
      });
      await tenantDb.transaction((tx) =>
        emitDomainEvent(tx as never, ctx.organizationId, "vehicle.inspection_updated", {
          vehicleId: vehicle.id,
          newExpiryDate: input.expiryDate.toISOString(),
        }),
      );
      return vehicle;
    }),

  /**
   * Page « Résultats des relances » : historique paginé des relances terminées et, sur la
   * première page, synthèse de la période (par statut, par issue) avec les mêmes filtres de
   * type/canal — le filtre de statut ne s'applique qu'à la liste.
   */
  history: requirePermission("reminder:read")
    .input(reminderHistoryInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const base = historyWhere(input);
      const items = await tenantDb.reminder.findMany({
        where: input.status ? { ...base, status: input.status } : base,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          type: true,
          status: true,
          channel: true,
          stepKey: true,
          sentAt: true,
          updatedAt: true,
          skippedReason: true,
          outcome: true,
          outcomeAt: true,
          messageId: true,
          customer: { select: { id: true, displayName: true } },
          vehicle: { select: { id: true, plate: true, plateType: true } },
          invoice: { select: { id: true, number: true } },
        },
      });
      const page = items.slice(0, input.limit);
      const nextCursor = items.length > input.limit ? items[input.limit - 1]!.id : null;
      const deliveries = await deliveriesFor(
        tenantDb,
        page.map((r) => r.messageId).filter((id): id is string => !!id),
      );

      let summary: {
        byStatus: Record<(typeof FINISHED_STATUSES)[number], number>;
        byOutcome: { outcome: string; count: number }[];
        /** Nombre de lignes correspondant aux filtres (pour « 50 sur 120 »). */
        total: number;
        /** Remise des messages envoyés : reçus, lus, sans accusé (fournisseur réel). */
        delivery: { delivered: number; read: number; unconfirmed: number; simulated: number };
      } | null = null;
      if (!input.cursor) {
        const sentIds = await tenantDb.reminder.findMany({
          where: { ...base, status: "SENT", messageId: { not: null } },
          select: { messageId: true },
          distinct: ["messageId"],
          take: 5000,
        });
        const [statusGroups, outcomeGroups, total, messages] = await Promise.all([
          tenantDb.reminder.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
          tenantDb.reminder.groupBy({
            by: ["outcome"],
            where: { ...base, outcome: { not: null } },
            _count: { _all: true },
          }),
          tenantDb.reminder.count({
            where: input.status ? { ...base, status: input.status } : base,
          }),
          tenantDb.message.findMany({
            where: { id: { in: sentIds.map((r) => r.messageId!) } },
            select: { status: true, provider: true, deliveredAt: true, readAt: true },
          }),
        ]);
        const delivery = { delivered: 0, read: 0, unconfirmed: 0, simulated: 0 };
        for (const m of messages) {
          if (m.provider === "console") delivery.simulated += 1;
          else if (m.readAt || m.status === "READ") delivery.read += 1;
          else if (m.deliveredAt || m.status === "DELIVERED") delivery.delivered += 1;
          else if (m.provider !== "wa_link" && m.status === "SENT") delivery.unconfirmed += 1;
        }
        const byStatus = { SENT: 0, FAILED: 0, CANCELLED: 0, SKIPPED: 0 };
        for (const group of statusGroups) {
          if (group.status in byStatus) {
            byStatus[group.status as keyof typeof byStatus] = group._count._all;
          }
        }
        summary = {
          byStatus,
          byOutcome: outcomeGroups
            .filter((g) => g.outcome !== null)
            .map((g) => ({ outcome: g.outcome as string, count: g._count._all }))
            .sort((a, b) => b.count - a.count),
          total,
          delivery,
        };
      }

      return {
        items: page.map(({ messageId, ...r }) => ({
          ...r,
          delivery: messageId ? (deliveries.get(messageId) ?? null) : null,
        })),
        nextCursor,
        summary,
      };
    }),

  stats: requirePermission("report:read")
    .input(reminderStatsInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const where: Prisma.ReminderWhereInput = { createdAt: { gte: input.from, lte: input.to } };
      const [total, sent, failed, outcomes] = await Promise.all([
        tenantDb.reminder.count({ where }),
        tenantDb.reminder.count({ where: { ...where, status: "SENT" } }),
        tenantDb.reminder.count({ where: { ...where, status: "FAILED" } }),
        tenantDb.reminder.groupBy({
          by: ["outcome"],
          where: { ...where, outcome: { not: null } },
          _count: true,
        }),
      ]);
      const attributedAmount = await tenantDb.reminder.aggregate({
        where: { ...where, attributedAmount: { not: null } },
        _sum: { attributedAmount: true },
      });
      const attributedRevenue = await tenantDb.reminder.aggregate({
        where: { ...where, attributedRevenue: { not: null } },
        _sum: { attributedRevenue: true },
      });
      return {
        total,
        sent,
        failed,
        byOutcome: outcomes,
        attributedAmount: attributedAmount._sum.attributedAmount ?? 0,
        attributedRevenue: attributedRevenue._sum.attributedRevenue ?? 0,
      };
    }),
});
