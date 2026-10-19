// M03 — Rendez-vous : §8 API (hors `planning.suggestSlot`, M17, et `portal.appointment.*`,
// M14 — cf. message de commit pour le détail des écarts documentés).
import { TRPCError } from "@trpc/server";
import { formatInTimeZone } from "date-fns-tz";
import {
  attributeReminder,
  defaultDuration,
  detectConflicts,
  isWithinOpeningHours,
  type RecentReminderLike,
} from "@atelieros/core";
import {
  appointmentCancelInputSchema,
  appointmentCompleteInputSchema,
  appointmentConfirmInputSchema,
  appointmentCreateBatchInputSchema,
  appointmentCreateInputSchema,
  appointmentIdInputSchema,
  appointmentListInputSchema,
  appointmentRevertNoShowInputSchema,
  appointmentUpdateInputSchema,
} from "@atelieros/validators";
import {
  availableSlots,
  canRevertNoShow,
  computeCapacity,
  batchPlacement as computeBatchPlacement,
} from "@atelieros/core";
import { requirePermission, requireSite, router } from "../trpc";
import { writeAuditLog } from "../audit";
import {
  db,
  emitAppointmentEvent,
  loadOccupancies,
  loadPlanningSettings,
  loadPresentMechanics,
  loadSiteContext,
} from "../appointments/helpers";
import { adminDb } from "@atelieros/db";
import {
  notifyAppointmentBatchConfirmation,
  notifyAppointmentCancelled,
  notifyAppointmentConfirmation,
  notifyAppointmentReminderNow,
  notifyAppointmentRescheduled,
} from "../appointments/notify";

type OpeningHoursLike = Record<string, readonly (readonly [string, string])[] | undefined>;

function toMinutesOfDay(timeKey: string): number {
  const [h, m] = timeKey.split(":").map(Number);
  return h! * 60 + m!;
}

/** Plage d'ouverture (ex. matin/après-midi) contenant `at`, ou `null` si hors horaires. */
function openingRangeOf(
  openingHours: OpeningHoursLike,
  at: Date,
  timeZone: string,
): readonly [string, string] | null {
  const weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const iso = Number(formatInTimeZone(at, timeZone, "i"));
  const weekday = weekdayKeys[iso - 1]!;
  const ranges = openingHours[weekday] ?? [];
  const current = toMinutesOfDay(formatInTimeZone(at, timeZone, "HH:mm"));
  return (
    ranges.find(([from, to]) => toMinutesOfDay(from) <= current && current < toMinutesOfDay(to)) ??
    null
  );
}

/** Durée (en heures) de la plage d'ouverture contenant `at`, ou 0 si hors horaires. */
function openingRangeHours(openingHours: OpeningHoursLike, at: Date, timeZone: string): number {
  const range = openingRangeOf(openingHours, at, timeZone);
  if (!range) return 0;
  return (toMinutesOfDay(range[1]) - toMinutesOfDay(range[0])) / 60;
}

/** Vrai si `a` et `b` tombent dans la même plage d'ouverture du même jour (même demi-journée). */
function isSameOpeningRange(
  openingHours: OpeningHoursLike,
  a: Date,
  b: Date,
  timeZone: string,
): boolean {
  const dayOf = (d: Date) => formatInTimeZone(d, timeZone, "yyyy-MM-dd");
  if (dayOf(a) !== dayOf(b)) return false;
  const rangeA = openingRangeOf(openingHours, a, timeZone);
  const rangeB = openingRangeOf(openingHours, b, timeZone);
  return rangeA !== null && rangeB !== null && rangeA[0] === rangeB[0] && rangeA[1] === rangeB[1];
}

function dayWindow(date: Date): { start: Date; end: Date } {
  const key = date.toISOString().slice(0, 10);
  return { start: new Date(`${key}T00:00:00.000Z`), end: new Date(`${key}T23:59:59.999Z`) };
}

export const appointmentRouter = router({
  list: requirePermission("appointment:read")
    .input(appointmentListInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const [appointments, blocks] = await Promise.all([
        tenantDb.appointment.findMany({
          where: {
            siteId: input.siteId,
            startsAt: { lt: input.to },
            endsAt: { gt: input.from },
            ...(input.bayIds ? { bayId: { in: input.bayIds } } : {}),
            ...(input.mechanicIds ? { mechanicId: { in: input.mechanicIds } } : {}),
            ...(input.statuses ? { status: { in: input.statuses } } : {}),
            ...(input.types ? { type: { in: input.types } } : {}),
            ...(input.sources ? { source: { in: input.sources } } : {}),
          },
          include: {
            customer: { select: { id: true, displayName: true, noShowCount12m: true } },
            vehicle: { select: { id: true, plate: true, make: true, model: true } },
          },
          orderBy: { startsAt: "asc" },
        }),
        tenantDb.resourceBlock.findMany({
          where: { siteId: input.siteId, startsAt: { lt: input.to }, endsAt: { gt: input.from } },
        }),
      ]);
      const occupyingOrders = await tenantDb.repairOrder.findMany({
        where: {
          siteId: input.siteId,
          bayId: { not: null },
          status: { in: ["IN_PROGRESS", "WAITING_PARTS"] },
        },
        select: { id: true, bayId: true, promisedAt: true, number: true },
      });
      return { appointments, blocks, occupyingOrders };
    }),

  get: requirePermission("appointment:read")
    .input(appointmentIdInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const appointment = await tenantDb.appointment.findFirst({
        where: { id: input.id },
        include: {
          customer: true,
          vehicle: true,
          reminder: true,
        },
      });
      if (!appointment) throw new TRPCError({ code: "NOT_FOUND", message: "RDV introuvable." });
      requireSite(ctx, appointment.siteId);
      return appointment;
    }),

  create: requirePermission("appointment:create")
    .input(appointmentCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();

      const customer = await tenantDb.customer.findFirst({ where: { id: input.customerId } });
      if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "Client introuvable." });
      if (input.vehicleId) {
        const vehicle = await tenantDb.vehicle.findFirst({ where: { id: input.vehicleId } });
        if (!vehicle) throw new TRPCError({ code: "NOT_FOUND", message: "Véhicule introuvable." });
      }

      const settings = await loadPlanningSettings(ctx.organizationId);
      const site = await loadSiteContext(tenantDb, ctx.organizationId, input.siteId);

      let standardHours: number[] | undefined;
      if (input.laborOperationIds && input.laborOperationIds.length > 0) {
        const ops = await tenantDb.laborOperation.findMany({
          where: { id: { in: input.laborOperationIds } },
          select: { standardHours: true },
        });
        standardHours = ops.map((o) => o.standardHours);
      }
      const durationMinutes =
        input.durationMinutes ??
        defaultDuration(input.type, settings.appointments.durations, standardHours);
      const endsAt = new Date(input.startsAt.getTime() + durationMinutes * 60_000);

      const canForce = input.force === true && ctx.permissions.has("planning:manage");

      const withinHours = isWithinOpeningHours(
        input.startsAt,
        endsAt,
        site.timeZone,
        site.openingHours,
        {
          siteId: site.siteId,
          holidays: site.holidays,
        },
      );
      if (!withinHours && !canForce) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "OUTSIDE_OPENING_HOURS" });
      }

      const occupancies = await loadOccupancies(tenantDb, input.siteId, input.startsAt, endsAt);
      const conflict = detectConflicts(
        {
          bayId: input.bayId ?? null,
          mechanicId: input.mechanicId ?? null,
          startsAt: input.startsAt,
          endsAt,
        },
        occupancies,
      );
      if (conflict && !canForce) {
        throw new TRPCError({ code: "CONFLICT", message: `SLOT_CONFLICT:${conflict.id}` });
      }

      // RG-M03-05 : capacité de la demi-journée (ne couvre pas encore les travaux restants
      // estimés des OR en cours — M04/M06, pas encore construits — écart documenté).
      const halfDayHours = openingRangeHours(site.openingHours, input.startsAt, site.timeZone);
      if (halfDayHours > 0) {
        const { start: dayStart, end: dayEnd } = dayWindow(input.startsAt);
        const mechanics = await loadPresentMechanics(
          tenantDb,
          input.siteId,
          dayStart,
          dayEnd,
          halfDayHours,
        );
        const halfDayAppointments = await tenantDb.appointment.findMany({
          where: {
            siteId: input.siteId,
            startsAt: { gte: dayStart, lte: dayEnd },
            status: { notIn: ["CANCELLED", "NO_SHOW"] },
          },
          select: { startsAt: true, endsAt: true },
        });
        const sameHalfDay = halfDayAppointments.filter((r) =>
          isSameOpeningRange(site.openingHours, r.startsAt, input.startsAt, site.timeZone),
        );
        const existingLoad = sameHalfDay.reduce(
          (sum, r) => sum + (r.endsAt.getTime() - r.startsAt.getTime()) / 60_000,
          0,
        );
        const existingCount = sameHalfDay.length;
        const activeBays = await tenantDb.bay.count({
          where: { siteId: input.siteId, isActive: true },
        });
        const capacity = computeCapacity({
          mechanicHoursAvailable: mechanics.map((m) => m.hoursAvailable),
          existingLoadMinutes: existingLoad,
          existingAppointmentsCount: existingCount,
          activeBaysCount: activeBays,
          maxAppointmentsPerHalfDay: settings.appointments.maxAppointmentsPerHalfDay,
          candidateDurationMinutes: durationMinutes,
        });
        if (!capacity.accepted && !canForce) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              capacity.reason === "MAX_APPOINTMENTS_REACHED"
                ? "MAX_APPOINTMENTS_REACHED"
                : `CAPACITY_EXCEEDED:${capacity.loadBeforeMinutes}:${capacity.capacityMinutes}`,
          });
        }
      }

      if (input.vehicleId) {
        const { start, end } = dayWindow(input.startsAt);
        const duplicate = await tenantDb.appointment.findFirst({
          where: {
            vehicleId: input.vehicleId,
            startsAt: { gte: start, lte: end },
            status: { notIn: ["CANCELLED", "NO_SHOW"] },
          },
        });
        if (duplicate && !input.force) {
          throw new TRPCError({ code: "CONFLICT", message: `DUPLICATE_SAME_DAY:${duplicate.id}` });
        }
      }

      let recentReminders: RecentReminderLike[] = [];
      if (!input.reminderId) {
        const reminders = await tenantDb.reminder.findMany({
          where: {
            OR: input.vehicleId
              ? [{ vehicleId: input.vehicleId }]
              : [{ customerId: input.customerId }],
            type: { in: ["INSPECTION", "SERVICE"] },
            status: "SENT",
            sentAt: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
          },
          select: { id: true, vehicleId: true, customerId: true, type: true, sentAt: true },
        });
        recentReminders = reminders
          .filter((r) => r.sentAt !== null)
          .map((r) => ({ ...r, sentAt: r.sentAt! }));
      }
      const reminderId = attributeReminder({
        explicitReminderId: input.reminderId ?? null,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        createdAt: now,
        recentReminders,
      });

      const appointment = await tenantDb.transaction(async (tx) => {
        const created = await tx.appointment.create({
          data: {
            organizationId: ctx.organizationId,
            siteId: input.siteId,
            customerId: input.customerId,
            vehicleId: input.vehicleId,
            bayId: input.bayId,
            mechanicId: input.mechanicId,
            advisorId: input.advisorId ?? ctx.membership.id,
            startsAt: input.startsAt,
            endsAt,
            type: input.type,
            source: input.source,
            reminderId,
            notes: input.notes,
            complaint: input.complaint,
            laborOperationIds: input.laborOperationIds ?? [],
            overbooked: Boolean(conflict && canForce),
            outsideHours: !withinHours && canForce,
            createdById: ctx.membership.id,
          },
          include: { customer: true, vehicle: true },
        });
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "appointment.created",
          entity: "Appointment",
          entityId: created.id,
          after: created,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        await emitAppointmentEvent(tx, ctx.organizationId, "appointment.created", {
          appointmentId: created.id,
          customerId: created.customerId,
          vehicleId: created.vehicleId,
          startsAt: created.startsAt.toISOString(),
        });
        if (input.notifyCustomer) {
          const org = await adminDb.organization.findUniqueOrThrow({
            where: { id: ctx.organizationId },
            select: { name: true },
          });
          await notifyAppointmentConfirmation(
            tx,
            ctx.organizationId,
            created.id,
            created.startsAt,
            created.type,
            site.timeZone,
            org.name,
            created.customer,
            created.vehicle,
          );
        }
        return created;
      });

      return appointment;
    }),

  update: requirePermission("appointment:update")
    .input(appointmentUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.appointment.findFirst({
        where: { id: input.id },
        include: { customer: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "RDV introuvable." });
      requireSite(ctx, existing.siteId);
      if (existing.status === "CANCELLED" || existing.status === "COMPLETED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "RDV déjà clôturé." });
      }

      const canForce = input.force === true && ctx.permissions.has("planning:manage");
      const startsAt = input.startsAt ?? existing.startsAt;
      const durationMinutes =
        input.durationMinutes ?? (existing.endsAt.getTime() - existing.startsAt.getTime()) / 60_000;
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
      const bayId = input.bayId !== undefined ? input.bayId : existing.bayId;
      const mechanicId = input.mechanicId !== undefined ? input.mechanicId : existing.mechanicId;
      const rescheduled = startsAt.getTime() !== existing.startsAt.getTime();

      if (rescheduled || bayId !== existing.bayId) {
        const site = await loadSiteContext(tenantDb, ctx.organizationId, existing.siteId);
        const withinHours = isWithinOpeningHours(
          startsAt,
          endsAt,
          site.timeZone,
          site.openingHours,
          {
            siteId: site.siteId,
            holidays: site.holidays,
          },
        );
        if (!withinHours && !canForce) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "OUTSIDE_OPENING_HOURS" });
        }
        const occupancies = await loadOccupancies(
          tenantDb,
          existing.siteId,
          startsAt,
          endsAt,
          existing.id,
        );
        const conflict = detectConflicts({ bayId, mechanicId, startsAt, endsAt }, occupancies);
        if (conflict && !canForce) {
          throw new TRPCError({ code: "CONFLICT", message: `SLOT_CONFLICT:${conflict.id}` });
        }
      }

      const updated = await tenantDb.transaction(async (tx) => {
        const result = await tx.appointment.update({
          where: { id: input.id },
          data: {
            startsAt,
            endsAt,
            bayId,
            mechanicId,
            type: input.type,
            complaint: input.complaint,
            notes: input.notes,
          },
          include: { customer: true },
        });
        await emitAppointmentEvent(tx, ctx.organizationId, "appointment.updated", {
          appointmentId: result.id,
          vehicleId: result.vehicleId,
          rescheduled,
        });
        if (rescheduled && (input.notifyCustomer ?? true)) {
          const site = await loadSiteContext(tx as never, ctx.organizationId, result.siteId);
          await notifyAppointmentRescheduled(
            tx,
            ctx.organizationId,
            result.id,
            result.startsAt,
            site.timeZone,
            result.customer,
          );
        }
        return result;
      });
      return updated;
    }),

  confirm: requirePermission("appointment:update")
    .input(appointmentConfirmInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.appointment.findFirst({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "RDV introuvable." });
      requireSite(ctx, existing.siteId);
      const now = new Date();
      return tenantDb.transaction(async (tx) => {
        const updated = await tx.appointment.update({
          where: { id: input.id },
          data: { status: "CONFIRMED", confirmedAt: now, confirmedVia: input.via },
        });
        await emitAppointmentEvent(tx, ctx.organizationId, "appointment.confirmed", {
          appointmentId: updated.id,
        });
        return updated;
      });
    }),

  markArrived: requirePermission("appointment:update")
    .input(appointmentIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.appointment.findFirst({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "RDV introuvable." });
      requireSite(ctx, existing.siteId);
      const now = new Date();
      const appointment = await tenantDb.transaction(async (tx) => {
        const updated = await tx.appointment.update({
          where: { id: input.id },
          data: { status: "ARRIVED", arrivedAt: now },
        });
        await emitAppointmentEvent(tx, ctx.organizationId, "appointment.arrived", {
          appointmentId: updated.id,
          vehicleId: updated.vehicleId,
        });
        return updated;
      });
      // M04 (étape 3.2) n'existe pas encore : lien d'avance vers la future réception, le
      // paramètre `appointmentId` pré-remplira le formulaire une fois M04 construit.
      return {
        appointment,
        receptionUrl: `/ordres-reparation/nouveau?appointmentId=${appointment.id}`,
      };
    }),

  complete: requirePermission("appointment:update")
    .input(appointmentCompleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.appointment.findFirst({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "RDV introuvable." });
      requireSite(ctx, existing.siteId);
      return tenantDb.transaction(async (tx) => {
        const updated = await tx.appointment.update({
          where: { id: input.id },
          data: { status: "COMPLETED", notes: input.reason },
        });
        await emitAppointmentEvent(tx, ctx.organizationId, "appointment.completed", {
          appointmentId: updated.id,
        });
        return updated;
      });
    }),

  cancel: requirePermission("appointment:cancel")
    .input(appointmentCancelInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.appointment.findFirst({
        where: { id: input.id },
        include: { customer: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "RDV introuvable." });
      requireSite(ctx, existing.siteId);
      if (existing.status === "ARRIVED" || existing.status === "COMPLETED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Annulation impossible : RDV déjà arrivé.",
        });
      }
      const now = new Date();
      return tenantDb.transaction(async (tx) => {
        const updated = await tx.appointment.update({
          where: { id: input.id },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancelledBy: input.cancelledBy,
            cancelReason: input.reason,
          },
        });
        await emitAppointmentEvent(tx, ctx.organizationId, "appointment.cancelled", {
          appointmentId: updated.id,
          vehicleId: updated.vehicleId,
        });
        if (input.cancelledBy === "GARAGE" && input.notifyCustomer) {
          await notifyAppointmentCancelled(tx, ctx.organizationId, updated.id, existing.customer);
        }
        return updated;
      });
    }),

  markNoShow: requirePermission("appointment:update")
    .input(appointmentIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.appointment.findFirst({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "RDV introuvable." });
      requireSite(ctx, existing.siteId);
      const now = new Date();
      return tenantDb.transaction(async (tx) => {
        const updated = await tx.appointment.update({
          where: { id: input.id },
          data: { status: "NO_SHOW", noShowAt: now },
        });
        if (updated.customerId) {
          await tx.customer.update({
            where: { id: updated.customerId },
            data: { noShowCount12m: { increment: 1 } },
          });
        }
        await emitAppointmentEvent(tx, ctx.organizationId, "appointment.no_show", {
          appointmentId: updated.id,
          vehicleId: updated.vehicleId,
        });
        return updated;
      });
    }),

  revertNoShow: requirePermission("appointment:update")
    .input(appointmentRevertNoShowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.appointment.findFirst({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "RDV introuvable." });
      requireSite(ctx, existing.siteId);
      if (existing.status !== "NO_SHOW" || !existing.noShowAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ce RDV n'est pas marqué absent." });
      }
      if (!canRevertNoShow(existing.noShowAt, new Date())) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Délai de correction (48 h) dépassé.",
        });
      }
      const updated = await tenantDb.appointment.update({
        where: { id: input.id },
        data: { status: "ARRIVED", arrivedAt: new Date(), notes: input.reason },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "appointment.no_show_reverted",
        entity: "Appointment",
        entityId: updated.id,
        reason: input.reason,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    }),

  sendReminderNow: requirePermission("appointment:update")
    .input(appointmentIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.appointment.findFirst({
        where: { id: input.id },
        include: { customer: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "RDV introuvable." });
      requireSite(ctx, existing.siteId);
      const site = await loadSiteContext(tenantDb, ctx.organizationId, existing.siteId);
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { name: true },
      });
      const messageId = await tenantDb.transaction((tx) =>
        notifyAppointmentReminderNow(
          tx,
          ctx.organizationId,
          existing.id,
          existing.startsAt,
          site.timeZone,
          org.name,
          existing.customer,
        ),
      );
      return { messageId };
    }),

  createBatch: requirePermission("planning:manage")
    .input(appointmentCreateBatchInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const site = await loadSiteContext(tenantDb, ctx.organizationId, input.siteId);
      const settings = await loadPlanningSettings(ctx.organizationId);
      const durationMinutes = settings.appointments.durations[input.type] ?? 60;
      const { start, end } = dayWindow(input.date);
      const occupancies = await loadOccupancies(tenantDb, input.siteId, start, end);

      const bays = await tenantDb.bay.findMany({ where: { siteId: input.siteId, isActive: true } });
      const days = availableSlots({
        from: input.date,
        horizonDays: 1,
        stepMinutes: settings.appointments.slotStepMinutes,
        durationMinutes,
        timeZone: site.timeZone,
        openingHours: site.openingHours,
        holidays: site.holidays,
        siteId: site.siteId,
        minLeadHours: 0,
        maxSlotsPerHalfDay: 99,
        occupancies,
        compatibleBayIds: bays.map((b) => b.id),
        autoAssignBay: true,
      });
      const slots = days.flatMap((d) => d.slots);
      const placement = computeBatchPlacement({
        vehicleIds: input.vehicleIds,
        availableSlots: slots,
        maxParallel: input.maxParallel,
      });

      if (placement.placements.length === 0) {
        return { groupId: null, appointments: [], unplaced: placement.unplaced };
      }

      const groupId = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const created = await tenantDb.transaction(async (tx) => {
        const results = [];
        for (const placed of placement.placements) {
          const endsAt = new Date(placed.startsAt.getTime() + durationMinutes * 60_000);
          const appointment = await tx.appointment.create({
            data: {
              organizationId: ctx.organizationId,
              siteId: input.siteId,
              customerId: input.customerId,
              vehicleId: placed.vehicleId,
              bayId: placed.bayId,
              startsAt: placed.startsAt,
              endsAt,
              type: input.type,
              source: "STAFF",
              groupId,
              createdById: ctx.membership.id,
            },
          });
          results.push(appointment);
          await emitAppointmentEvent(tx, ctx.organizationId, "appointment.created", {
            appointmentId: appointment.id,
            customerId: appointment.customerId,
            vehicleId: appointment.vehicleId,
            startsAt: appointment.startsAt.toISOString(),
          });
        }
        const customer = await tx.customer.findFirst({ where: { id: input.customerId } });
        if (customer) {
          const org = await adminDb.organization.findUniqueOrThrow({
            where: { id: ctx.organizationId },
            select: { name: true },
          });
          const vehicles = await tx.vehicle.findMany({
            where: { id: { in: results.map((r) => r.vehicleId!) } },
            select: { id: true, plate: true },
          });
          const plateById = new Map(vehicles.map((v) => [v.id, v.plate]));
          await notifyAppointmentBatchConfirmation(
            tx,
            ctx.organizationId,
            groupId,
            site.timeZone,
            org.name,
            customer,
            results.map((r) => ({
              plate: plateById.get(r.vehicleId!) ?? "?",
              startsAt: r.startsAt,
            })),
          );
        }
        return results;
      });

      return { groupId, appointments: created, unplaced: placement.unplaced };
    }),
});
