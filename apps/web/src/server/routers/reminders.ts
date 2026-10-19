// §8 — routeur `reminders` (file du jour, échéances, actions). RG-M10-20 (actions),
// RG-M10-21 (suppressions), RG-M10-31/32 (sans canal / numéro invalide).
import { TRPCError } from "@trpc/server";
import {
  buildManualDedupeKey,
  isDomainError,
  renderTemplate,
  smsSegments,
  type Channel,
} from "@atelieros/core";
import { db, type Prisma } from "@atelieros/db";
import {
  reminderApproveInputSchema,
  reminderCreateManualInputSchema,
  reminderDueDatesInputSchema,
  reminderGetInputSchema,
  reminderHistoryInputSchema,
  reminderMarkAppointmentTakenInputSchema,
  reminderMarkInspectionDoneInputSchema,
  reminderMarkWaLinkSentInputSchema,
  reminderPreviewInputSchema,
  reminderQueueInputSchema,
  reminderRetryInputSchema,
  reminderSkipInputSchema,
  reminderSnoozeInputSchema,
  reminderStatsInputSchema,
  reminderStepSchema,
  reminderUpdateInputSchema,
} from "@atelieros/validators";
import { z } from "zod";
import { emitDomainEvent } from "../events/emit";
import { buildPreviewContext } from "../reminders/context";
import { requirePermission, router } from "../trpc";

const CANCELLABLE_STATUSES = ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] as const;
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
}): Prisma.ReminderWhereInput {
  const range = { gte: input.from, lte: input.to };
  return {
    status: { in: [...FINISHED_STATUSES] },
    OR: [{ sentAt: range }, { sentAt: null, updatedAt: range }],
    ...(input.type ? { type: input.type } : {}),
    ...(input.channel ? { channel: input.channel } : {}),
  };
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
      const where: Prisma.ReminderWhereInput = {
        ...tabWhere(input.tab, now),
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
        include: { customer: true, vehicle: true },
      });
      const nextCursor = items.length > input.limit ? items[input.limit]!.id : null;

      const tabs = [
        "TO_APPROVE",
        "PLANNED_TODAY",
        "SENT_TODAY",
        "FAILED",
        "TO_CALL",
        "EXPIRED",
      ] as const;
      const counts = Object.fromEntries(
        await Promise.all(
          tabs.map(
            async (t) => [t, await tenantDb.reminder.count({ where: tabWhere(t, now) })] as const,
          ),
        ),
      );

      return { items: items.slice(0, input.limit), counts, nextCursor };
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
          body: reminder.renderedBody ?? "",
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
      const field =
        input.kind === "INSPECTION"
          ? "inspectionExpiryDate"
          : input.kind === "INSURANCE"
            ? "insuranceExpiryDate"
            : "nextServiceDueDate";
      const now = new Date();
      const where: Prisma.VehicleWhereInput = { deletedAt: null };
      if (input.filter === "UPCOMING") where[field] = { gte: now };
      else if (input.filter === "EXPIRED") where[field] = { lt: now, not: null };
      else if (input.filter === "MISSING_DATA") where[field] = null;
      else where[field] = { not: null };

      const vehicles = await tenantDb.vehicle.findMany({
        where,
        orderBy: { [field]: "asc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: { customer: true },
      });
      const nextCursor = vehicles.length > input.limit ? vehicles[input.limit]!.id : null;
      return { items: vehicles.slice(0, input.limit), nextCursor };
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
          customer: { select: { id: true, displayName: true } },
          vehicle: { select: { id: true, plate: true, plateType: true } },
        },
      });
      const nextCursor = items.length > input.limit ? items[input.limit]!.id : null;

      let summary: {
        byStatus: Record<(typeof FINISHED_STATUSES)[number], number>;
        byOutcome: { outcome: string; count: number }[];
      } | null = null;
      if (!input.cursor) {
        const [statusGroups, outcomeGroups] = await Promise.all([
          tenantDb.reminder.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
          tenantDb.reminder.groupBy({
            by: ["outcome"],
            where: { ...base, outcome: { not: null } },
            _count: { _all: true },
          }),
        ]);
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
        };
      }

      return { items: items.slice(0, input.limit), nextCursor, summary };
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
