import {
  availableSlots,
  computeCapacity,
  halfDayWindows,
  nextCivilDay,
  occupancyRate,
  startOfCivilDay,
  systemClock,
  type HalfDaySlots,
} from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { loadPlanningContext, loadRangeData } from "@atelieros/planning";
import {
  availableSlotsInputSchema,
  capacityInputSchema,
  suggestSlotInputSchema,
  updatePlanningSettingsInputSchema,
} from "@atelieros/validators";
import { writeAuditLog } from "../audit";
import { toTRPCError } from "../domain-error";
import { orgProcedure, requirePermission, requireSite, router } from "../trpc";

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return toTRPCError(error);
  }
}

async function slotsFor(
  organizationId: string,
  input: {
    siteId: string;
    type: "SERVICE" | "INSPECTION_PREP" | "REPAIR" | "DIAGNOSTIC" | "BODYWORK" | "TIRES" | "OTHER";
    durationMinutes?: number;
    from: Date;
    days: number;
    bayType?: "LIFT" | "DIAGNOSTIC" | "BODYWORK" | "PAINT" | "WASH" | "OTHER";
    bayId?: string;
    mechanicId?: string;
    limit?: number;
    requireBay: boolean;
  },
): Promise<{ durationMinutes: number; days: HalfDaySlots[] }> {
  const planning = await loadPlanningContext(organizationId, input.siteId);
  const tz = planning.organization.timeZone;
  const now = systemClock.now();
  const from = startOfCivilDay(input.from < now ? now : input.from, tz);
  let to = from;
  for (let i = 0; i < input.days; i++) to = nextCivilDay(to, tz);
  const data = await loadRangeData(organizationId, input.siteId, from, to);
  const durationMinutes =
    input.durationMinutes ?? planning.appointmentSettings.durations[input.type];
  const bays = input.bayType
    ? planning.bays.filter((b) => b.type === input.bayType)
    : planning.bays;
  const days = availableSlots({
    from,
    now,
    days: input.days,
    timeZone: tz,
    openingHours: planning.site.openingHours,
    holidays: planning.holidays,
    siteId: input.siteId,
    lunchBreak: planning.planningSettings.lunchBreak,
    type: input.type,
    durationMinutes,
    stepMinutes: planning.appointmentSettings.slotStepMinutes,
    minLeadMinutes: 0,
    bays,
    appointments: data.appointments,
    blocks: data.blocks,
    occupyingOrders: data.occupyingOrders,
    requireBay: input.requireBay,
    bayId: input.bayId ?? null,
    mechanicId: input.mechanicId ?? null,
    mechanicIds: planning.mechanics.map((m) => m.membershipId),
    productivityRate: planning.planningSettings.productivityRate,
    maxAppointmentsPerHalfDay: planning.appointmentSettings.maxAppointmentsPerHalfDay,
    limit: input.limit ?? null,
  });
  return { durationMinutes, days };
}

export const planningRouter = router({
  /** US-M03-02 — « Trouver un créneau » : prochains créneaux compatibles (pont adapté libre, capacité, horaires). */
  availableSlots: requirePermission("appointment:read")
    .input(availableSlotsInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      return run(() => slotsFor(ctx.organizationId, input));
    }),

  /** Capacité par demi-journée (jauge du bandeau et vue Semaine, RG-M03-05 / US-M03-11). */
  capacity: requirePermission("appointment:read")
    .input(capacityInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      return run(async () => {
        const planning = await loadPlanningContext(ctx.organizationId, input.siteId);
        const tz = planning.organization.timeZone;
        const data = await loadRangeData(ctx.organizationId, input.siteId, input.from, input.to);
        const result: Array<
          ReturnType<typeof computeCapacity> & { occupancy: number; start: Date; end: Date }
        > = [];
        for (
          let day = startOfCivilDay(input.from, tz);
          day < input.to;
          day = nextCivilDay(day, tz)
        ) {
          const windows = halfDayWindows(planning.site.openingHours, day, tz, {
            lunchBreak: planning.planningSettings.lunchBreak,
            holidays: planning.holidays,
            siteId: input.siteId,
          });
          for (const window of windows) {
            const capacity = computeCapacity({
              window,
              mechanicIds: planning.mechanics.map((m) => m.membershipId),
              blocks: data.blocks,
              productivityRate: planning.planningSettings.productivityRate,
              appointments: data.appointments,
              occupyingOrders: data.occupyingOrders,
              maxAppointmentsPerHalfDay: planning.appointmentSettings.maxAppointmentsPerHalfDay,
              activeBayCount: planning.bays.length,
            });
            result.push({
              ...capacity,
              occupancy: occupancyRate(capacity),
              start: window.start,
              end: window.end,
            });
          }
        }
        return result;
      });
    }),

  /**
   * US-M03-05 — suggestion de créneau. M17 (IA) n'est pas encore construit : suggestion
   * déterministe (3 créneaux libres les plus proches), sans appel IA ni `AiInteraction`.
   */
  suggestSlot: requirePermission("appointment:read")
    .input(suggestSlotInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      return run(async () => {
        const { days } = await slotsFor(ctx.organizationId, {
          siteId: input.siteId,
          type: input.type,
          from: systemClock.now(),
          days: 14,
          limit: 3,
          requireBay: true,
        });
        const suggestions = days
          .flatMap((d) => d.slots)
          .slice(0, 3)
          .map((slot) => ({
            startsAt: slot.startsAt,
            bayId: slot.bayId,
            reason: "Premier créneau libre compatible",
          }));
        return { suggestions, aiInteractionId: null as string | null };
      });
    }),

  getSettings: orgProcedure.query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { settings: true },
    });
    const { resolveAppointmentSettings, resolvePlanningSettings } = await import("@atelieros/core");
    return {
      appointments: resolveAppointmentSettings(org.settings),
      planning: resolvePlanningSettings(org.settings),
    };
  }),

  updateSettings: requirePermission("planning:manage")
    .input(updatePlanningSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { resolveAppointmentSettings, resolvePlanningSettings } =
        await import("@atelieros/core");
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { settings: true },
      });
      const before = {
        appointments: resolveAppointmentSettings(org.settings),
        planning: resolvePlanningSettings(org.settings),
      };
      const after = {
        appointments: {
          ...before.appointments,
          ...input.appointments,
          durations: { ...before.appointments.durations, ...(input.appointments?.durations ?? {}) },
        },
        planning: { ...before.planning, ...input.planning },
      };
      const current =
        typeof org.settings === "object" && org.settings
          ? (org.settings as Record<string, unknown>)
          : {};
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: {
          settings: { ...current, appointments: after.appointments, planning: after.planning },
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "settings.updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        before,
        after,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return after;
    }),
});
