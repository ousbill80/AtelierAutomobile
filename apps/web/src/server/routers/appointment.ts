import {
  computeInspectionStatus,
  computeServiceStatus,
  countNoShows12m,
  isLate,
  nextCivilDay,
  requiresMandatoryConfirmation,
  startOfCivilDay,
  systemClock,
} from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  APPOINTMENT_INCLUDE,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  createAppointment,
  createAppointmentBatch,
  ensureAppointmentLink,
  getAppointment,
  loadPlanningContext,
  loadRangeData,
  markArrived,
  markNoShow,
  pickChannel,
  revertNoShow,
  sendNoShowMessage,
  sendReminderNow,
  updateAppointment,
  type Actor,
  type AppointmentRecord,
} from "@atelieros/planning";
import {
  appointmentCancelInputSchema,
  appointmentCompleteInputSchema,
  appointmentConfirmInputSchema,
  appointmentCreateBatchInputSchema,
  appointmentCreateInputSchema,
  appointmentGetInputSchema,
  appointmentListInputSchema,
  appointmentMarkArrivedInputSchema,
  appointmentMarkNoShowInputSchema,
  appointmentRevertNoShowInputSchema,
  appointmentSendReminderNowInputSchema,
  appointmentTodayInputSchema,
  appointmentUpdateInputSchema,
} from "@atelieros/validators";
import { toTRPCError } from "../domain-error";
import { requirePermission, requireSite, router } from "../trpc";
import type { Ctx, CtxMembership, CtxUser } from "../context";

type OrgCtx = Ctx & { user: CtxUser; membership: CtxMembership; organizationId: string };

function actorFrom(ctx: OrgCtx): Actor {
  return {
    organizationId: ctx.organizationId,
    membershipId: ctx.membership.id,
    userId: ctx.user.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    canForce: ctx.permissions.has("planning:manage"),
  };
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return toTRPCError(error);
  }
}

/** Carte RDV du planning : RDV + indicateurs (retard, absences antérieures, VT bientôt, canal). */
function enrich(
  appointment: AppointmentRecord,
  options: { now: Date; lateAfterMinutes: number; noShowCounts: Map<string, number> },
) {
  const noShowCount12m = options.noShowCounts.get(appointment.customerId) ?? 0;
  const vehicle = appointment.vehicle;
  const inspectionStatus = vehicle
    ? computeInspectionStatus({ expiryDate: vehicle.inspectionExpiryDate, today: options.now })
    : "UNKNOWN";
  const serviceStatus = vehicle
    ? computeServiceStatus({
        nextServiceDueDate: vehicle.nextServiceDueDate,
        nextServiceDueMileage: vehicle.nextServiceDueMileage,
        currentMileage: vehicle.currentMileage,
        today: options.now,
      })
    : "UNKNOWN";
  return {
    ...appointment,
    mechanicName: appointment.mechanic?.user.name ?? null,
    advisorName: appointment.advisor?.user.name ?? null,
    durationMinutes: Math.round(
      (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000,
    ),
    flags: {
      late: isLate({
        startsAt: appointment.startsAt,
        status: appointment.status,
        now: options.now,
        lateAfterMinutes: options.lateAfterMinutes,
      }),
      noShowCount12m,
      mandatoryConfirmation: requiresMandatoryConfirmation(noShowCount12m),
      inspectionStatus,
      serviceStatus,
      reachable: pickChannel(appointment.customer) !== null,
      channel: pickChannel(appointment.customer)?.channel ?? null,
    },
  };
}

async function noShowCountsFor(organizationId: string, customerIds: string[], now: Date) {
  const tenantDb = db.forTenant({ organizationId });
  const counts = new Map<string, number>();
  if (customerIds.length === 0) return counts;
  const floor = new Date(now.getTime());
  floor.setUTCFullYear(floor.getUTCFullYear() - 1);
  const rows = await tenantDb.appointment.findMany({
    where: {
      customerId: { in: customerIds },
      status: "NO_SHOW",
      startsAt: { gte: floor, lte: now },
    },
    select: { customerId: true, status: true, startsAt: true },
  });
  for (const customerId of new Set(customerIds)) {
    counts.set(
      customerId,
      countNoShows12m(
        rows.filter((r) => r.customerId === customerId),
        now,
      ),
    );
  }
  return counts;
}

export const appointmentRouter = router({
  list: requirePermission("appointment:read")
    .input(appointmentListInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = systemClock.now();
      const planning = await run(() => loadPlanningContext(ctx.organizationId, input.siteId));
      const [appointments, data] = await Promise.all([
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
          include: APPOINTMENT_INCLUDE,
          orderBy: { startsAt: "asc" },
        }),
        loadRangeData(ctx.organizationId, input.siteId, input.from, input.to),
      ]);
      const noShowCounts = await noShowCountsFor(
        ctx.organizationId,
        appointments.map((a) => a.customerId),
        now,
      );
      return {
        appointments: appointments.map((a) =>
          enrich(a, {
            now,
            lateAfterMinutes: planning.appointmentSettings.lateAfterMinutes,
            noShowCounts,
          }),
        ),
        blocks: data.blocks,
        occupyingOrders: data.occupyingOrders,
        bays: planning.bays,
        mechanics: planning.mechanics,
        site: {
          id: planning.site.id,
          name: planning.site.name,
          openingHours: planning.site.openingHours,
        },
        timeZone: planning.organization.timeZone,
        operatingMode: planning.organization.operatingMode,
        settings: planning.appointmentSettings,
        lunchBreak: planning.planningSettings.lunchBreak,
        holidays: planning.holidays,
      };
    }),

  get: requirePermission("appointment:read")
    .input(appointmentGetInputSchema)
    .query(async ({ ctx, input }) => {
      const appointment = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, appointment.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = systemClock.now();
      const planning = await run(() => loadPlanningContext(ctx.organizationId, appointment.siteId));
      const [messages, noShowCounts, laborOperations] = await Promise.all([
        tenantDb.message.findMany({
          where: { idempotencyKey: { startsWith: `appointment:${appointment.id}:` } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            channel: true,
            direction: true,
            status: true,
            body: true,
            createdAt: true,
            sentAt: true,
            to: true,
          },
        }),
        noShowCountsFor(ctx.organizationId, [appointment.customerId], now),
        appointment.laborOperationIds.length > 0
          ? tenantDb.laborOperation.findMany({
              where: { id: { in: appointment.laborOperationIds } },
              select: { id: true, name: true, standardHours: true },
            })
          : Promise.resolve([]),
      ]);
      return {
        ...enrich(appointment, {
          now,
          lateAfterMinutes: planning.appointmentSettings.lateAfterMinutes,
          noShowCounts,
        }),
        messages,
        laborOperations,
        operatingMode: planning.organization.operatingMode,
        timeZone: planning.organization.timeZone,
      };
    }),

  /** Liste du jour pour l'accueil (US-M03-09, §7 `/rendez-vous/aujourdhui`). */
  today: requirePermission("appointment:read")
    .input(appointmentTodayInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = systemClock.now();
      const planning = await run(() => loadPlanningContext(ctx.organizationId, input.siteId));
      const tz = planning.organization.timeZone;
      const dayStart = startOfCivilDay(input.date ?? now, tz);
      const dayEnd = nextCivilDay(dayStart, tz);
      const appointments = await tenantDb.appointment.findMany({
        where: { siteId: input.siteId, startsAt: { gte: dayStart, lt: dayEnd } },
        include: APPOINTMENT_INCLUDE,
        orderBy: { startsAt: "asc" },
      });
      const noShowCounts = await noShowCountsFor(
        ctx.organizationId,
        appointments.map((a) => a.customerId),
        now,
      );
      const enriched = appointments.map((a) =>
        enrich(a, {
          now,
          lateAfterMinutes: planning.appointmentSettings.lateAfterMinutes,
          noShowCounts,
        }),
      );
      // Confirmations à obtenir par téléphone : client injoignable par écrit, ou absences répétées sans confirmation.
      const tomorrowStart = dayEnd;
      const tomorrowEnd = nextCivilDay(tomorrowStart, tz);
      const tomorrow = await tenantDb.appointment.findMany({
        where: {
          siteId: input.siteId,
          status: "BOOKED",
          startsAt: { gte: tomorrowStart, lt: tomorrowEnd },
        },
        include: APPOINTMENT_INCLUDE,
        orderBy: { startsAt: "asc" },
      });
      const tomorrowCounts = await noShowCountsFor(
        ctx.organizationId,
        tomorrow.map((a) => a.customerId),
        now,
      );
      const callsToMake = tomorrow
        .map((a) =>
          enrich(a, {
            now,
            lateAfterMinutes: planning.appointmentSettings.lateAfterMinutes,
            noShowCounts: tomorrowCounts,
          }),
        )
        .filter((a) => !a.flags.reachable || a.flags.mandatoryConfirmation);
      return {
        date: dayStart,
        timeZone: tz,
        operatingMode: planning.organization.operatingMode,
        appointments: enriched,
        counters: {
          total: enriched.filter((a) => a.status !== "CANCELLED").length,
          confirmed: enriched.filter(
            (a) => a.status === "CONFIRMED" || a.status === "ARRIVED" || a.status === "COMPLETED",
          ).length,
          unanswered: enriched.filter((a) => a.status === "BOOKED").length,
          late: enriched.filter((a) => a.flags.late).length,
          arrived: enriched.filter((a) => a.status === "ARRIVED").length,
          noShow: enriched.filter((a) => a.status === "NO_SHOW").length,
        },
        callsToMake,
      };
    }),

  create: requirePermission("appointment:create")
    .input(appointmentCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      return run(() => createAppointment(actorFrom(ctx), input));
    }),

  update: requirePermission("appointment:update")
    .input(appointmentUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, current.siteId);
      return run(() => updateAppointment(actorFrom(ctx), input));
    }),

  confirm: requirePermission("appointment:update")
    .input(appointmentConfirmInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, current.siteId);
      return run(() => confirmAppointment(actorFrom(ctx), input));
    }),

  markArrived: requirePermission("appointment:update")
    .input(appointmentMarkArrivedInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, current.siteId);
      return run(() => markArrived(actorFrom(ctx), input));
    }),

  complete: requirePermission("appointment:update")
    .input(appointmentCompleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, current.siteId);
      return run(() => completeAppointment(actorFrom(ctx), input));
    }),

  cancel: requirePermission("appointment:cancel")
    .input(appointmentCancelInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, current.siteId);
      return run(() => cancelAppointment(actorFrom(ctx), input));
    }),

  markNoShow: requirePermission("appointment:update")
    .input(appointmentMarkNoShowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, current.siteId);
      return run(() => markNoShow(actorFrom(ctx), input));
    }),

  revertNoShow: requirePermission("appointment:update")
    .input(appointmentRevertNoShowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, current.siteId);
      return run(() => revertNoShow(actorFrom(ctx), input));
    }),

  sendReminderNow: requirePermission("appointment:update")
    .input(appointmentSendReminderNowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, current.siteId);
      return run(() => sendReminderNow(actorFrom(ctx), input));
    }),

  /** US-M03-09 — envoi validé du message de reprogrammation après absence. */
  sendNoShowMessage: requirePermission("appointment:update")
    .input(appointmentSendReminderNowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, current.siteId);
      return run(() => sendNoShowMessage(actorFrom(ctx), input));
    }),

  /** Lien portail (confirmer / déplacer / annuler) pour un RDV existant. */
  createPortalLink: requirePermission("appointment:update")
    .input(appointmentGetInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await run(() => getAppointment(ctx.organizationId, input.id));
      requireSite(ctx, current.siteId);
      return run(() => ensureAppointmentLink(actorFrom(ctx), current));
    }),

  createBatch: requirePermission("appointment:create", "planning:manage")
    .input(appointmentCreateBatchInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      return run(() => createAppointmentBatch(actorFrom(ctx), input));
    }),
});
