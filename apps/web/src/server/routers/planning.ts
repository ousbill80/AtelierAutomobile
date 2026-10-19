// M03 §8 — `planning.availableSlots` / `planning.capacity` (hors `planning.suggestSlot`, M17,
// pas encore construit : écart documenté au message de commit).
import { availableSlots, computeCapacity } from "@atelieros/core";
import { formatInTimeZone } from "date-fns-tz";
import {
  planningAvailableSlotsInputSchema,
  planningCapacityInputSchema,
} from "@atelieros/validators";
import { requirePermission, requireSite, router } from "../trpc";
import {
  db,
  loadOccupancies,
  loadPlanningSettings,
  loadPresentMechanics,
  loadSiteContext,
} from "../appointments/helpers";

function weekdayRanges(
  openingHours: Record<string, readonly (readonly [string, string])[] | undefined>,
  at: Date,
  timeZone: string,
): readonly (readonly [string, string])[] {
  const weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const iso = Number(formatInTimeZone(at, timeZone, "i"));
  return openingHours[weekdayKeys[iso - 1]!] ?? [];
}

export const planningRouter = router({
  availableSlots: requirePermission("appointment:read")
    .input(planningAvailableSlotsInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const site = await loadSiteContext(tenantDb, ctx.organizationId, input.siteId);
      const settings = await loadPlanningSettings(ctx.organizationId);
      const durationMinutes =
        input.durationMinutes ?? settings.appointments.durations[input.type] ?? 60;
      const horizonDays = input.days ?? settings.appointments.portalHorizonDays;

      const bays = await tenantDb.bay.findMany({
        where: {
          siteId: input.siteId,
          isActive: true,
          ...(input.bayType ? { type: input.bayType as never } : {}),
        },
        select: { id: true },
      });
      const windowEnd = new Date(input.from.getTime() + horizonDays * 24 * 60 * 60 * 1000);
      const occupancies = await loadOccupancies(tenantDb, input.siteId, input.from, windowEnd);

      return availableSlots({
        from: input.from,
        horizonDays,
        stepMinutes: settings.appointments.slotStepMinutes,
        durationMinutes,
        timeZone: site.timeZone,
        openingHours: site.openingHours,
        holidays: site.holidays,
        siteId: site.siteId,
        minLeadHours: settings.appointments.portalMinLeadHours,
        occupancies,
        compatibleBayIds: settings.appointments.autoAssignBay ? bays.map((b) => b.id) : null,
        autoAssignBay: settings.appointments.autoAssignBay,
      });
    }),

  capacity: requirePermission("appointment:read")
    .input(planningCapacityInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const site = await loadSiteContext(tenantDb, ctx.organizationId, input.siteId);
      const settings = await loadPlanningSettings(ctx.organizationId);
      const activeBays = await tenantDb.bay.count({
        where: { siteId: input.siteId, isActive: true },
      });

      const results: {
        date: string;
        halfDay: "AM" | "PM";
        capacityMinutes: number;
        loadMinutes: number;
        appointmentsCount: number;
      }[] = [];

      for (
        let cursor = new Date(input.from);
        cursor.getTime() < input.to.getTime();
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
      ) {
        const ranges = weekdayRanges(site.openingHours, cursor, site.timeZone);
        if (ranges.length === 0) continue;
        const dateKey = formatInTimeZone(cursor, site.timeZone, "yyyy-MM-dd");
        const dayStart = new Date(`${dateKey}T00:00:00.000Z`);
        const dayEnd = new Date(`${dateKey}T23:59:59.999Z`);

        for (const [from, to] of ranges) {
          const toMinutes = (t: string) => {
            const [h, m] = t.split(":").map(Number);
            return h! * 60 + m!;
          };
          const rangeHours = (toMinutes(to) - toMinutes(from)) / 60;
          const fromH = toMinutes(from) / 60;
          const mechanics = await loadPresentMechanics(
            tenantDb,
            input.siteId,
            dayStart,
            dayEnd,
            rangeHours,
          );
          const appointments = await tenantDb.appointment.findMany({
            where: {
              siteId: input.siteId,
              startsAt: { gte: dayStart, lte: dayEnd },
              status: { notIn: ["CANCELLED", "NO_SHOW"] },
            },
            select: { startsAt: true, endsAt: true },
          });
          const inRange = appointments.filter((a) => {
            const minute = formatInTimeZone(a.startsAt, site.timeZone, "HH:mm");
            return minute >= from && minute < to;
          });
          const loadMinutes = inRange.reduce(
            (sum, a) => sum + (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000,
            0,
          );
          const capacity = computeCapacity({
            mechanicHoursAvailable: mechanics.map((m) => m.hoursAvailable),
            productivityRate: settings.planning.productivityRate,
            existingLoadMinutes: loadMinutes,
            existingAppointmentsCount: inRange.length,
            activeBaysCount: activeBays,
            maxAppointmentsPerHalfDay: settings.appointments.maxAppointmentsPerHalfDay,
          });
          results.push({
            date: dateKey,
            halfDay: fromH < 13 ? "AM" : "PM",
            capacityMinutes: capacity.capacityMinutes,
            loadMinutes,
            appointmentsCount: inRange.length,
          });
        }
      }
      return results;
    }),
});
