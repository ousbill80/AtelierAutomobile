// M03 §8 — routeurs `planning` (créneaux, capacité, suggestion), `resourceBlock` (blocages)
// et `planningSettings` (paramètres `/parametres/planning`).
import { TRPCError } from "@trpc/server";
import {
  DomainError,
  addDaysToKey,
  availableSlots,
  defaultDuration,
  detectConflicts,
  formatDayFr,
  formatTimeFr,
  halfDayLoad,
  localDateKey,
  occupancyTone,
  parsePreferredSlotText,
  resolvePlanningConfig,
  type HalfDay,
} from "@atelieros/core";
import { adminDb, db, writeAuditLog, type Prisma } from "@atelieros/db";
import {
  availableSlotsInputSchema,
  planningCapacityInputSchema,
  planningSettingsSchema,
  resourceBlockCreateInputSchema,
  resourceBlockDeleteInputSchema,
  resourceBlockListInputSchema,
  suggestSlotInputSchema,
} from "@atelieros/validators";
import { requirePermission, requireSite, router } from "../trpc";
import { computeSlotSuggestions, needsBay } from "../appointments/slotSuggestions";
import {
  asTx,
  dayBounds,
  loadOrganization,
  loadPlanning,
  notifyStaff,
  planningConfigOf,
  resolveSite,
} from "../appointments/service";

export const planningRouter = router({
  /** US-M03-02 — les N prochains créneaux libres compatibles (staff, sans plafond par demi-journée). */
  availableSlots: requirePermission("appointment:read")
    .input(availableSlotsInputSchema)
    .query(async ({ ctx, input }) => {
      const tx = asTx(db.forTenant({ organizationId: ctx.organizationId }));
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const config = planningConfigOf(org);
      const site = await resolveSite(tx, ctx, input.siteId);
      const fromDate = localDateKey(input.from ?? now, org.timezone);
      const { from } = dayBounds(fromDate, org.timezone);
      const { to } = dayBounds(addDaysToKey(fromDate, input.days - 1), org.timezone);
      const planning = await loadPlanning(tx, { org, site, from, to, now });
      const duration =
        input.durationMinutes ?? defaultDuration(input.type, [], config.appointments.durations);
      const groups = availableSlots({
        snapshot: planning.snapshot,
        now,
        type: input.type,
        durationMinutes: duration,
        fromDate,
        days: input.days,
        stepMinutes: config.appointments.slotStepMinutes,
        minLeadMinutes: 0,
        requireBay: needsBay(input.type, planning.bays),
        limit: input.limit,
        mechanicId: input.mechanicId ?? null,
      });
      return {
        durationMinutes: duration,
        groups: groups.map((g) => ({
          date: g.date,
          halfDay: g.halfDay,
          slots: g.slots.map((s) => ({
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            bayId: s.bayId ?? null,
            bayName: planning.bays.find((b) => b.id === s.bayId)?.name ?? null,
          })),
        })),
      };
    }),

  /** RG-M03-05 / US-M03-11 — capacité et charge par demi-journée (bandeau, vue Semaine). */
  capacity: requirePermission("appointment:read")
    .input(planningCapacityInputSchema)
    .query(async ({ ctx, input }) => {
      const tx = asTx(db.forTenant({ organizationId: ctx.organizationId }));
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const site = await resolveSite(tx, ctx, input.siteId);
      const { from } = dayBounds(input.from, org.timezone);
      const { to } = dayBounds(input.to, org.timezone);
      if (to.getTime() - from.getTime() > 32 * 86_400_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Période limitée à 31 jours." });
      }
      const planning = await loadPlanning(tx, { org, site, from, to, now });
      const activeBays = planning.bays.filter((b) => b.isActive).length;
      const rows = [];
      for (let day = input.from; day <= input.to; day = addDaysToKey(day, 1)) {
        for (const halfDay of ["AM", "PM"] as HalfDay[]) {
          const load = halfDayLoad(planning.snapshot, day, halfDay);
          // Occupation des ponts = heures réservées / heures ouvertes × ponts actifs (US-M03-11).
          const bayMinutes = load.openMinutes * Math.max(1, activeBays);
          const ratio = bayMinutes > 0 ? load.loadMinutes / bayMinutes : 0;
          rows.push({
            date: day,
            halfDay,
            capacityMinutes: load.capacityMinutes,
            loadMinutes: load.loadMinutes,
            appointmentsCount: load.appointmentsCount,
            maxAppointments: load.maxAppointments,
            openMinutes: load.openMinutes,
            occupancy: ratio,
            tone: occupancyTone(ratio),
          });
        }
      }
      return rows;
    }),

  /**
   * US-M03-05 / M17 — suggestion de créneau à partir d'une intention libre (« samedi matin »).
   * Heuristique déterministe journalisée dans `AiInteraction` : l'humain accepte ou change.
   * Mutation (et non query) : une ligne `AiInteraction` par demande explicite, pas par refetch.
   */
  suggestSlot: requirePermission("appointment:create")
    .input(suggestSlotInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const tx = asTx(tenantDb);
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const site = await resolveSite(tx, ctx, null);
      let text = input.preferredText ?? "";
      if (!text && input.conversationId) {
        const lastInbound = await tx.message.findFirst({
          where: { conversationId: input.conversationId, direction: "INBOUND" },
          orderBy: { createdAt: "desc" },
          select: { body: true },
        });
        text = lastInbound?.body ?? "";
      }
      const preference = parsePreferredSlotText(text, now, org.timezone);
      const suggestions = await computeSlotSuggestions(tx, {
        org,
        site,
        type: input.type,
        preference,
        now,
      });
      const interaction = await tenantDb.aiInteraction.create({
        data: {
          organizationId: ctx.organizationId,
          feature: "appointment_slot_suggestion",
          inputRef: input.conversationId ?? input.customerId,
          output: { preference, suggestions } as unknown as Prisma.InputJsonValue,
          createdById: ctx.membership.id,
        },
      });
      return { suggestions, aiInteractionId: interaction.id };
    }),
});

export const resourceBlockRouter = router({
  list: requirePermission("appointment:read")
    .input(resourceBlockListInputSchema)
    .query(async ({ ctx, input }) => {
      const tx = asTx(db.forTenant({ organizationId: ctx.organizationId }));
      const site = await resolveSite(tx, ctx, input.siteId);
      return tx.resourceBlock.findMany({
        where: { siteId: site.id, startsAt: { lt: input.to }, endsAt: { gt: input.from } },
        include: {
          bay: { select: { name: true } },
          membership: { select: { user: { select: { name: true } } } },
        },
        orderBy: { startsAt: "asc" },
      });
    }),

  /**
   * US-M03-10 / §11 — blocage d'un pont, d'un mécanicien ou du site. Refusé si des RDV sont
   * en conflit (`BLOCK_HAS_APPOINTMENTS`) sauf forçage : ils passent alors « À affecter »
   * (pont ou mécanicien retiré) et le chef d'atelier est notifié.
   */
  create: requirePermission("planning:manage")
    .input(resourceBlockCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrganization(ctx.organizationId);
      const result = await tenantDb.transaction(async (tx) => {
        const site = await resolveSite(tx, ctx, input.siteId);
        if (
          input.bayId &&
          !(await tx.bay.findFirst({ where: { id: input.bayId, siteId: site.id } }))
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Pont introuvable." });
        }
        if (
          input.membershipId &&
          !(await tx.membership.findFirst({ where: { id: input.membershipId } }))
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Mécanicien introuvable." });
        }
        const appointments = await tx.appointment.findMany({
          where: {
            siteId: site.id,
            startsAt: { lt: input.endsAt },
            endsAt: { gt: input.startsAt },
            status: { in: ["BOOKED", "CONFIRMED"] },
          },
          include: { customer: { select: { displayName: true } } },
        });
        const block = {
          id: "new",
          bayId: input.bayId ?? null,
          membershipId: input.membershipId ?? null,
          reason: input.reason,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
        };
        const affected = appointments.filter(
          (a) =>
            detectConflicts(
              { startsAt: a.startsAt, endsAt: a.endsAt, bayId: a.bayId, mechanicId: a.mechanicId },
              { appointments: [], blocks: [block] },
            ).length > 0,
        );
        const siteWide = !input.bayId && !input.membershipId;
        if (affected.length > 0 && siteWide) {
          // Fermeture du site : rien à « réaffecter », les RDV doivent être déplacés d'abord.
          const domain = new DomainError(
            "BLOCK_HAS_APPOINTMENTS",
            `${affected.length} RDV sont prévus pendant cette fermeture. Déplacez-les ou annulez-les avant de fermer l'atelier.`,
            { ids: affected.map((a) => a.id), forcible: false },
          );
          throw new TRPCError({ code: "CONFLICT", message: domain.message, cause: domain });
        }
        if (affected.length > 0 && !input.force) {
          const domain = new DomainError(
            "BLOCK_HAS_APPOINTMENTS",
            `${affected.length} RDV sont prévus sur cette période. Déplacez-les ou confirmez : ils passeront « À affecter ».`,
            { ids: affected.map((a) => a.id), forcible: true },
          );
          throw new TRPCError({ code: "CONFLICT", message: domain.message, cause: domain });
        }
        const created = await tx.resourceBlock.create({
          data: {
            organizationId: ctx.organizationId,
            siteId: site.id,
            bayId: input.bayId ?? null,
            membershipId: input.membershipId ?? null,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            reason: input.reason,
            createdById: ctx.membership.id,
          },
        });
        for (const a of affected) {
          await tx.appointment.update({
            where: { id: a.id },
            data: input.membershipId ? { mechanicId: null } : input.bayId ? { bayId: null } : {},
          });
        }
        if (affected.length > 0) {
          await notifyStaff(tx, {
            organizationId: ctx.organizationId,
            siteId: site.id,
            roles: ["MANAGER", "OWNER"],
            type: "appointment.block_conflicts",
            title: `${affected.length} RDV à réaffecter`,
            body: `${input.reason} : ${affected
              .map(
                (a) =>
                  `${a.customer.displayName} (${formatDayFr(a.startsAt, org.timezone)} ${formatTimeFr(a.startsAt, org.timezone)})`,
              )
              .join(", ")}`,
            link: "/rendez-vous",
            dedupeKey: `block:${created.id}`,
          });
        }
        return { block: created, affectedIds: affected.map((a) => a.id) };
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: result.block.siteId,
        action: "resource_block.created",
        entity: "ResourceBlock",
        entityId: result.block.id,
        after: result.block,
        reason: input.reason,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return result;
    }),

  delete: requirePermission("planning:manage")
    .input(resourceBlockDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const block = await tenantDb.resourceBlock.findFirst({ where: { id: input.id } });
      if (!block) throw new TRPCError({ code: "NOT_FOUND", message: "Blocage introuvable." });
      requireSite(ctx, block.siteId);
      await tenantDb.resourceBlock.delete({ where: { id: block.id } });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: block.siteId,
        action: "resource_block.deleted",
        entity: "ResourceBlock",
        entityId: block.id,
        before: block,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { ok: true } as const;
    }),
});

export const planningSettingsRouter = router({
  get: requirePermission("appointment:read").query(async ({ ctx }) => {
    const org = await loadOrganization(ctx.organizationId);
    return resolvePlanningConfig(org.settings);
  }),

  update: requirePermission("planning:manage")
    .input(planningSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const before = resolvePlanningConfig(org.settings);
      const current =
        typeof org.settings === "object" && org.settings
          ? (org.settings as Record<string, unknown>)
          : {};
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: {
          settings: {
            ...current,
            appointments: input.appointments,
            planning: input.planning,
          } as Prisma.InputJsonValue,
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "settings.planning_updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        before,
        after: input,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return resolvePlanningConfig({ ...current, ...input });
    }),
});
