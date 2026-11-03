// M06 §8 — routeur `workshop` : kanban (RG-M06-01/02), ponts (RG-M06-03), mécaniciens et
// affectation suggérée (RG-M06-04), pointages et corrections (RG-M06-16), productivité
// (RG-M06-08 à 10), file de contrôle qualité, sous-traitance (RG-M06-12). Les transitions
// d'OR sont celles de M04 (`applyTransition`) ; les décisions viennent de `@atelieros/core`.
import { TRPCError } from "@trpc/server";
import {
  allowedColumns,
  assertSubcontractTransition,
  availableHoursToday,
  BAY_OCCUPYING_STATUSES,
  businessDate,
  checkBoardMove,
  columnForStatus,
  computeDurationMinutes,
  DomainError,
  pauseEntry,
  isSubcontractLoss,
  isSubcontractOverdue,
  presenceMinutes,
  rankAssignees,
  taskProgress,
  timeEntryState,
  WORKSHOP_BOARD_STATUSES,
  WORKSHOP_COLUMN_KEYS,
  workshopLateness,
  type OpeningHours,
  type SubcontractStatusValue,
  type TransitionContext,
} from "@atelieros/core";
import { db, type Prisma, type ScopedTenantClient } from "@atelieros/db";
import {
  assignBayInputSchema,
  editTimeEntryInputSchema,
  productivityInputSchema,
  recordAttendanceInputSchema,
  reviewTimeEntryInputSchema,
  subcontractListInputSchema,
  subcontractUpdateStatusInputSchema,
  suggestAssigneesInputSchema,
  timeEntriesInputSchema,
  workshopBaysInputSchema,
  workshopBoardInputSchema,
  workshopMechanicsInputSchema,
  workshopMoveInputSchema,
} from "@atelieros/validators";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import {
  applyTransition,
  assertRoModule,
  assertTransition,
  badRequest,
  loadOrgRoContext,
  membersWithRoles,
  notFound,
  notify,
  roNow,
  transitionFacts,
} from "../repairOrders/helpers";
import { loadProductivity } from "../workshop/productivity";
import { requirePermission, requireSite, router } from "../trpc";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "../context";

type Tx = ScopedTenantClient;
type OrgCtx = Ctx & {
  user: CtxUser;
  session: CtxSession;
  membership: CtxMembership;
  organizationId: string;
};

function siteWhere(ctx: OrgCtx, siteId?: string): Prisma.RepairOrderWhereInput {
  if (siteId) {
    requireSite(ctx, siteId);
    return { siteId };
  }
  return ctx.allowedSiteIds === "ALL" ? {} : { siteId: { in: ctx.allowedSiteIds } };
}

const MECHANICS_WHERE: Prisma.MembershipWhereInput = { isActive: true, role: "MECHANIC" };

/** Mécaniciens rattachés au site (`siteIds` vide ou NULL = tous les sites, RG-M01-09). */
function onSite<T extends { siteIds: string[] | null }>(members: T[], siteId?: string): T[] {
  if (!siteId) return members;
  return members.filter((m) => !m.siteIds?.length || m.siteIds.includes(siteId));
}

/** Site de la présence : site actif de la session, sinon le premier site du mécanicien. */
function attendanceSiteId(ctx: OrgCtx, memberSiteIds: string[]): string | null {
  const active = ctx.session.activeSiteId ?? null;
  if (!memberSiteIds.length) return active;
  if (active && memberSiteIds.includes(active)) return active;
  return memberSiteIds[0] ?? null;
}

const CARD_INCLUDE = {
  vehicle: { select: { plate: true, make: true, model: true } },
  customer: { select: { displayName: true } },
  advisor: { select: { id: true, user: { select: { name: true } } } },
  bay: { select: { id: true, name: true } },
  lines: {
    select: {
      id: true,
      type: true,
      status: true,
      approval: true,
      quantity: true,
      subcontractStatus: true,
      assignedTo: { select: { id: true, user: { select: { name: true } } } },
    },
  },
  partRequests: {
    where: { status: { in: ["REQUESTED", "PREPARING", "ORDERED"] } },
    select: { id: true },
  },
  timeEntries: {
    where: { endedAt: null },
    select: {
      membership: { select: { id: true, user: { select: { name: true } } } },
      pausedAt: true,
    },
  },
} satisfies Prisma.RepairOrderInclude;

type CardRow = Prisma.RepairOrderGetPayload<{ include: typeof CARD_INCLUDE }>;

function toBoardCard(row: CardRow, now: Date, ctx: TransitionContext) {
  const live = row.lines.filter((l) => l.status !== "CANCELLED");
  const mechanics = new Map<string, string>();
  for (const l of live) if (l.assignedTo) mechanics.set(l.assignedTo.id, l.assignedTo.user.name);
  const missingParts = row.status === "WAITING_PARTS" || row.partRequests.length > 0;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    column: columnForStatus(row.status),
    priority: row.priority,
    promisedAt: row.promisedAt,
    plate: row.vehicle.plate,
    vehicle: `${row.vehicle.make} ${row.vehicle.model}`.trim(),
    customerName: row.customer.displayName,
    advisorName: row.advisor?.user.name ?? null,
    bay: row.bay,
    mechanics: [...mechanics.entries()].map(([id, name]) => ({ id, name })),
    activeMechanics: row.timeEntries.map((e) => ({
      id: e.membership.id,
      name: e.membership.user.name,
      paused: !!e.pausedAt,
    })),
    progress: taskProgress(row.lines),
    lateness: workshopLateness(row, row.lines, now),
    badges: {
      missingParts,
      subcontract: live.some((l) => l.type === "SUBCONTRACT" && l.subcontractStatus !== "RETURNED"),
    },
    allowedColumns: allowedColumns(row, row.lines, {
      ...ctx,
      unavailablePartLines: missingParts ? 1 : 0,
    }),
  };
}

async function todayAttendance(tx: Tx, now: Date, timeZone: string) {
  return tx.attendance.findMany({ where: { date: businessDate(now, timeZone) } });
}

/** Charge restante (heures barème) par mécanicien sur les OR ouverts du site (RG-M06-04). */
async function remainingLoads(tx: Tx, siteId: string | undefined) {
  const lines = await tx.repairOrderLine.findMany({
    where: {
      type: "LABOR",
      assignedToId: { not: null },
      status: { in: ["PENDING", "IN_PROGRESS"] },
      approval: { not: "DECLINED" },
      repairOrder: {
        deletedAt: null,
        status: { in: [...BAY_OCCUPYING_STATUSES] },
        ...(siteId ? { siteId } : {}),
      },
    },
    select: { assignedToId: true, quantity: true, repairOrderId: true },
  });
  const load = new Map<string, number>();
  for (const l of lines) load.set(l.assignedToId!, (load.get(l.assignedToId!) ?? 0) + l.quantity);
  return { load, lines };
}

export const workshopRouter = router({
  /** US-M06-01 — kanban par colonne (RG-M06-01), retard et « à risque » (RG-M06-02). */
  board: requirePermission("workshop:view")
    .input(workshopBoardInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const where: Prisma.RepairOrderWhereInput = {
        ...siteWhere(ctx, input.siteId),
        deletedAt: null,
        status: { in: [...WORKSHOP_BOARD_STATUSES] },
        ...(input.advisorId ? { advisorId: input.advisorId } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.mechanicId ? { lines: { some: { assignedToId: input.mechanicId } } } : {}),
      };
      const rows = await tenantDb.repairOrder.findMany({
        where,
        include: CARD_INCLUDE,
        orderBy: [{ promisedAt: "asc" }, { createdAt: "asc" }],
        take: 300,
      });
      const tctx: TransitionContext = {
        permissions: ctx.permissions,
        qcRequired: org.settings.qcRequired,
      };
      let cards = rows.map((r) => toBoardCard(r, now, tctx));
      const lateCount = cards.filter((c) => c.lateness.late).length;
      if (input.lateOnly) cards = cards.filter((c) => c.lateness.late);
      return {
        columns: WORKSHOP_COLUMN_KEYS.map((key) => ({
          key,
          cards: cards.filter((c) => c.column === key),
        })),
        lateCount,
        timeZone: org.timeZone,
        serverNow: now,
      };
    }),

  /** Glisser-déposer : transition M04 correspondant à la colonne (US-M06-01). */
  move: requirePermission("workshop:view")
    .input(workshopMoveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const order = await tx.repairOrder.findFirst({
          where: { id: input.repairOrderId, deletedAt: null },
        });
        if (!order) notFound();
        requireSite(ctx, order.siteId);
        const lines = await tx.repairOrderLine.findMany({ where: { repairOrderId: order.id } });
        const facts = await transitionFacts(tx, order);
        const check = checkBoardMove(order, lines, input.to, {
          permissions: ctx.permissions,
          qcRequired: org.settings.qcRequired,
          ...facts,
          reason: input.reason,
        });
        if (!check.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: check.message,
            cause: new DomainError("TRANSITION_NOT_ALLOWED", check.message, { reason: check.code }),
          });
        }
        // Validation / refus du contrôle qualité : écran dédié (check-list, RG-M06-11).
        if (check.viaQualityCheck) {
          return { status: order.status, redirect: `/ordres/${order.id}/controle-qualite` };
        }
        const to = assertTransition(order, lines, check.transition, {
          permissions: ctx.permissions,
          qcRequired: org.settings.qcRequired,
          ...facts,
          reason: input.reason,
        });
        const updated = await applyTransition(tx, {
          order,
          to,
          transition: check.transition,
          reason: input.reason,
          membershipId: ctx.membership.id,
          now,
        });
        if (updated.status === "QUALITY_CHECK") {
          await notify(tx, ctx.organizationId, await membersWithRoles(tx, ["MANAGER"]), {
            type: "repair_order.qc_needed",
            title: `${order.number} prêt pour contrôle qualité`,
            link: `/ordres/${order.id}/controle-qualite`,
          });
        }
        return { status: updated.status, redirect: null };
      });
    }),

  /** US-M06-02 — une colonne par pont actif du site, zone parking. */
  bays: requirePermission("workshop:view")
    .input(workshopBaysInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const siteId = input.siteId ?? ctx.session.activeSiteId ?? undefined;
      const sw = siteWhere(ctx, siteId);
      const bays = await tenantDb.bay.findMany({
        where: {
          isActive: true,
          ...(siteId
            ? { siteId }
            : ctx.allowedSiteIds === "ALL"
              ? {}
              : { siteId: { in: ctx.allowedSiteIds } }),
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      const rows = await tenantDb.repairOrder.findMany({
        where: { ...sw, deletedAt: null, status: { in: [...BAY_OCCUPYING_STATUSES] } },
        include: CARD_INCLUDE,
        orderBy: [{ promisedAt: "asc" }, { createdAt: "asc" }],
        take: 300,
      });
      const tctx: TransitionContext = {
        permissions: ctx.permissions,
        qcRequired: org.settings.qcRequired,
      };
      const cards = rows.map((r) => toBoardCard(r, now, tctx));
      return {
        bays: bays.map((bay) => ({
          bay: { id: bay.id, name: bay.name, type: bay.type },
          repairOrder: cards.find((c) => c.bay?.id === bay.id) ?? null,
        })),
        parking: cards.filter((c) => !c.bay || !bays.some((b) => b.id === c.bay!.id)),
        timeZone: org.timeZone,
      };
    }),

  /** RG-M06-03 — un pont accueille au plus un OR actif ; `force` envoie l'occupant au parking. */
  assignBay: requirePermission("repair_order:update")
    .input(assignBayInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const order = await tx.repairOrder.findFirst({
          where: { id: input.repairOrderId, deletedAt: null },
        });
        if (!order) notFound();
        requireSite(ctx, order.siteId);
        if (!BAY_OCCUPYING_STATUSES.includes(order.status)) {
          badRequest("Seul un OR en cours d'atelier peut occuper un pont.");
        }
        let displaced: string | null = null;
        if (input.bayId) {
          const bay = await tx.bay.findFirst({ where: { id: input.bayId, isActive: true } });
          if (!bay || bay.siteId !== order.siteId) badRequest("Pont introuvable sur ce site.");
          const occupant = await tx.repairOrder.findFirst({
            where: {
              bayId: bay.id,
              id: { not: order.id },
              deletedAt: null,
              status: { in: [...BAY_OCCUPYING_STATUSES] },
            },
          });
          if (occupant) {
            if (!input.force) {
              throw new TRPCError({
                code: "CONFLICT",
                message: `Le ${bay.name} est occupé par ${occupant.number}. Déplacer celui-ci vers le parking ?`,
                cause: new DomainError("BAY_OCCUPIED", "Pont occupé", {
                  occupantId: occupant.id,
                  occupantNumber: occupant.number,
                  bayName: bay.name,
                }),
              });
            }
            await tx.repairOrder.update({ where: { id: occupant.id }, data: { bayId: null } });
            displaced = occupant.id;
          }
        }
        const updated = await tx.repairOrder.update({
          where: { id: order.id },
          data: { bayId: input.bayId },
        });
        return { repairOrder: { id: updated.id, bayId: updated.bayId }, displaced };
      });
    }),

  /** /atelier/mecaniciens — présence, tâche en cours, charge restante, compétences. */
  mechanics: requirePermission("workshop:view")
    .input(workshopMechanicsInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const members = onSite(
          await tx.membership.findMany({
            where: MECHANICS_WHERE,
            include: { user: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          }),
          input.siteId,
        );
        const attendance = await todayAttendance(tx, now, org.timeZone);
        const { load } = await remainingLoads(tx, input.siteId);
        const open = await tx.timeEntry.findMany({
          where: { endedAt: null, membershipId: { in: members.map((m) => m.id) } },
          include: {
            repairOrder: { select: { id: true, number: true } },
            repairOrderLine: { select: { description: true } },
          },
        });
        const unassigned = await tx.repairOrderLine.findMany({
          where: {
            type: "LABOR",
            assignedToId: null,
            status: { in: ["PENDING", "IN_PROGRESS"] },
            approval: { in: ["APPROVED", "NOT_REQUIRED"] },
            repairOrder: {
              ...siteWhere(ctx, input.siteId),
              deletedAt: null,
              status: { in: [...BAY_OCCUPYING_STATUSES] },
            },
          },
          include: {
            repairOrder: {
              select: { id: true, number: true, vehicle: { select: { plate: true } } },
            },
            laborOperation: { select: { requiredSkill: true } },
          },
          orderBy: { createdAt: "asc" },
          take: 100,
        });
        return {
          serverNow: now,
          mechanics: members.map((m) => {
            const att = attendance.find((a) => a.membershipId === m.id) ?? null;
            const active =
              open
                .filter((e) => e.membershipId === m.id)
                .sort((a, b) => Number(!!a.pausedAt) - Number(!!b.pausedAt))[0] ?? null;
            return {
              membershipId: m.id,
              name: m.user.name,
              skills: m.skills,
              attendance: att ? { clockIn: att.clockIn, clockOut: att.clockOut } : null,
              present: !!att?.clockIn && !att.clockOut,
              remainingLoad: Math.round((load.get(m.id) ?? 0) * 100) / 100,
              activeEntry: active
                ? {
                    id: active.id,
                    startedAt: active.startedAt,
                    state: timeEntryState(active),
                    minutes: computeDurationMinutes(active, now),
                    repairOrder: active.repairOrder,
                    lineDescription: active.repairOrderLine?.description ?? null,
                  }
                : null,
            };
          }),
          unassigned: unassigned.map((l) => ({
            id: l.id,
            description: l.description,
            hours: l.quantity,
            requiredSkill: l.laborOperation?.requiredSkill ?? null,
            repairOrder: {
              id: l.repairOrder.id,
              number: l.repairOrder.number,
              plate: l.repairOrder.vehicle.plate,
            },
          })),
        };
      });
    }),

  /** US-M06-03 / RG-M06-04 — mécaniciens classés par score (top 5). */
  suggestAssignees: requirePermission("repair_order:assign")
    .input(suggestAssigneesInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const line = await tx.repairOrderLine.findFirst({
          where: { id: input.repairOrderLineId },
          include: {
            laborOperation: { select: { requiredSkill: true } },
            repairOrder: { include: { site: { select: { openingHours: true } } } },
          },
        });
        if (!line) notFound("Ligne introuvable.");
        requireSite(ctx, line.repairOrder.siteId);
        const siteId = line.repairOrder.siteId;
        const members = onSite(
          await tx.membership.findMany({
            where: MECHANICS_WHERE,
            include: { user: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          }),
          siteId,
        );
        const attendance = await todayAttendance(tx, now, org.timeZone);
        const { load, lines } = await remainingLoads(tx, siteId);
        const hours = availableHoursToday(now, {
          timeZone: org.timeZone,
          openingHours: (line.repairOrder.site.openingHours ?? {}) as OpeningHours,
        });
        const requiredSkill = line.laborOperation?.requiredSkill ?? null;
        const ranked = rankAssignees(
          members.map((m) => {
            const att = attendance.find((a) => a.membershipId === m.id);
            return {
              membershipId: m.id,
              skills: m.skills,
              present: !!att?.clockIn && !att.clockOut,
              remainingLoadHours: load.get(m.id) ?? 0,
              alreadyOnOrder: lines.some(
                (l) => l.repairOrderId === line.repairOrderId && l.assignedToId === m.id,
              ),
            };
          }),
          requiredSkill,
          hours,
          5,
        );
        const byId = new Map(members.map((m) => [m.id, m]));
        return {
          requiredSkill,
          availableHours: Math.round(hours * 10) / 10,
          candidates: ranked.map((r) => ({
            ...r,
            name: byId.get(r.membershipId)!.user.name,
            skills: byId.get(r.membershipId)!.skills,
            remainingLoad: load.get(r.membershipId) ?? 0,
            present: !r.reasons.includes("absent"),
          })),
        };
      });
    }),

  /** /atelier/pointages — entrées filtrées (date, mécanicien, OR, `needsReview`). */
  timeEntries: requirePermission("time:edit")
    .input(timeEntriesInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const entryInclude = {
        membership: { select: { user: { select: { name: true } } } },
        repairOrder: { select: { id: true, number: true } },
        repairOrderLine: { select: { description: true } },
      } as const;
      const entryWhere = {
        ...(input.membershipId ? { membershipId: input.membershipId } : {}),
        ...(input.repairOrderId ? { repairOrderId: input.repairOrderId } : {}),
        ...(input.needsReview !== undefined ? { needsReview: input.needsReview } : {}),
        repairOrder: siteWhere(ctx, input.siteId),
      };
      const [startedInRange, stillOpen] = await Promise.all([
        tenantDb.timeEntry.findMany({
          where: { ...entryWhere, startedAt: { gte: input.from, lt: input.to } },
          include: entryInclude,
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        }),
        tenantDb.timeEntry.findMany({
          where: { ...entryWhere, endedAt: null, startedAt: { lt: input.from } },
          include: entryInclude,
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: 50,
        }),
      ]);
      const seen = new Set(stillOpen.map((e) => e.id));
      const rows = [
        ...stillOpen,
        ...startedInRange.filter((e) => !seen.has(e.id)).slice(0, input.limit),
      ];
      const dayFrom = businessDate(input.from, org.timeZone);
      const dayTo = businessDate(new Date(input.to.getTime() - 1), org.timeZone);
      const attendances = await tenantDb.attendance.findMany({
        where: {
          date: { gte: dayFrom, lte: dayTo },
          ...(input.membershipId ? { membershipId: input.membershipId } : {}),
        },
        include: { membership: { select: { user: { select: { name: true } } } } },
        orderBy: [{ date: "desc" }],
      });
      const mechanics = onSite(
        await tenantDb.membership.findMany({
          where: MECHANICS_WHERE,
          select: { id: true, siteIds: true, user: { select: { name: true } } },
          orderBy: { user: { name: "asc" } },
        }),
        input.siteId,
      ).filter((m) => !input.membershipId || m.id === input.membershipId);
      const attendanceByMember = new Map(attendances.map((a) => [a.membershipId, a]));
      const items = rows.map((e) => ({
        id: e.id,
        mechanicName: e.membership.user.name,
        membershipId: e.membershipId,
        repairOrder: e.repairOrder,
        lineDescription: e.repairOrderLine?.description ?? null,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
        pausedAt: e.pausedAt,
        pauseMinutes: e.pauseMinutes,
        minutes: computeDurationMinutes(e, now),
        state: timeEntryState(e),
        kind: e.kind,
        source: e.source,
        needsReview: e.needsReview,
        reviewReason: e.reviewReason,
        carriedOver: e.startedAt.getTime() < input.from.getTime(),
      }));
      const byMember = new Map<string, typeof items>();
      for (const item of items) {
        const list = byMember.get(item.membershipId) ?? [];
        list.push(item);
        byMember.set(item.membershipId, list);
      }
      return {
        timeZone: org.timeZone,
        items,
        nextCursor:
          startedInRange.length > input.limit ? startedInRange[input.limit - 1]!.id : null,
        attendances: attendances.map((a) => ({
          id: a.id,
          mechanicName: a.membership.user.name,
          date: a.date,
          clockIn: a.clockIn,
          clockOut: a.clockOut,
          breakMinutes: a.breakMinutes,
          autoClosed: a.autoClosed,
          presenceMinutes: presenceMinutes(a, now),
        })),
        team: mechanics.map((m) => {
          const attendance = attendanceByMember.get(m.id) ?? null;
          const status = !attendance?.clockIn ? "absent" : attendance.clockOut ? "left" : "present";
          const mine = byMember.get(m.id) ?? [];
          const active = mine.find((entry) => entry.state !== "STOPPED") ?? null;
          return {
            membershipId: m.id,
            name: m.user.name,
            attendanceId: attendance?.id ?? null,
            clockIn: attendance?.clockIn ?? null,
            clockOut: attendance?.clockOut ?? null,
            breakMinutes: attendance?.breakMinutes ?? 0,
            autoClosed: attendance?.autoClosed ?? false,
            presenceMinutes: attendance ? presenceMinutes(attendance, now) : 0,
            pointedMinutes: mine.reduce((sum, entry) => sum + entry.minutes, 0),
            status,
            active: active
              ? {
                  state: active.state,
                  minutes: active.minutes,
                  repairOrder: active.repairOrder,
                  lineDescription: active.lineDescription,
                }
              : null,
          };
        }),
      };
    }),

  /** RG-M06-16 — correction de pointage : motif obligatoire, audit avant/après. */
  editTimeEntry: requirePermission("time:edit")
    .input(editTimeEntryInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      if (
        input.startedAt.getTime() > now.getTime() ||
        (input.endedAt && input.endedAt.getTime() > now.getTime())
      ) {
        badRequest("Un pointage ne peut pas être dans le futur.");
      }
      return tenantDb.transaction(async (tx) => {
        const entry = await tx.timeEntry.findFirst({
          where: { id: input.id },
          include: { repairOrder: { select: { siteId: true } } },
        });
        if (!entry) notFound("Pointage introuvable.");
        requireSite(ctx, entry.repairOrder.siteId);
        const updated = await tx.timeEntry.update({
          where: { id: entry.id },
          data: {
            startedAt: input.startedAt,
            endedAt: input.endedAt,
            pauseMinutes: input.pauseMinutes,
            pausedAt: input.endedAt ? null : entry.pausedAt,
            needsReview: false,
          },
        });
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          siteId: entry.repairOrder.siteId,
          action: "time_entry.edit",
          entity: "TimeEntry",
          entityId: entry.id,
          before: {
            startedAt: entry.startedAt,
            endedAt: entry.endedAt,
            pauseMinutes: entry.pauseMinutes,
          },
          after: {
            startedAt: updated.startedAt,
            endedAt: updated.endedAt,
            pauseMinutes: updated.pauseMinutes,
          },
          reason: input.reason,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return { entry: { ...updated, minutes: computeDurationMinutes(updated, now) } };
      });
    }),

  /** Valider une entrée signalée (`needsReview`) sans la modifier. */
  reviewTimeEntry: requirePermission("time:edit")
    .input(reviewTimeEntryInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const entry = await tx.timeEntry.findFirst({
          where: { id: input.id },
          include: { repairOrder: { select: { siteId: true } } },
        });
        if (!entry) notFound("Pointage introuvable.");
        requireSite(ctx, entry.repairOrder.siteId);
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          siteId: entry.repairOrder.siteId,
          action: "time_entry.review",
          entity: "TimeEntry",
          entityId: entry.id,
          before: { needsReview: entry.needsReview, reviewReason: entry.reviewReason },
          after: { needsReview: false },
          reason: "Pointage vérifié",
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return tx.timeEntry.update({ where: { id: entry.id }, data: { needsReview: false } });
      });
    }),

  /**
   * Présence saisie ou corrigée depuis le bureau (oubli de tablette).
   * Un départ met en pause la tâche en cours, comme le pointage tablette.
   */
  recordAttendance: requirePermission("time:edit")
    .input(recordAttendanceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      if (
        input.clockIn.getTime() > now.getTime() ||
        (input.clockOut && input.clockOut.getTime() > now.getTime())
      ) {
        badRequest("Une présence ne peut pas être dans le futur.");
      }
      const day = businessDate(input.clockIn, org.timeZone);
      if (
        input.clockOut &&
        businessDate(input.clockOut, org.timeZone).getTime() !== day.getTime()
      ) {
        badRequest("L'arrivée et le départ doivent être le même jour.");
      }
      return tenantDb.transaction(async (tx) => {
        const member = await tx.membership.findFirst({
          where: { id: input.membershipId, isActive: true, role: "MECHANIC" },
          select: { id: true, siteIds: true },
        });
        if (!member) notFound("Mécanicien introuvable.");
        const siteId = attendanceSiteId(ctx, member.siteIds);
        requireSite(ctx, siteId);
        const existing = await tx.attendance.findFirst({
          where: { membershipId: member.id, date: day },
        });
        if (existing) requireSite(ctx, existing.siteId);
        if (input.clockOut) {
          const running = await tx.timeEntry.findMany({
            where: { membershipId: member.id, endedAt: null, pausedAt: null },
          });
          for (const entry of running) {
            const patch = pauseEntry(entry, input.clockOut, "other");
            if (patch) await tx.timeEntry.update({ where: { id: entry.id }, data: patch });
          }
        }
        const data = {
          clockIn: input.clockIn,
          clockOut: input.clockOut,
          breakMinutes: input.breakMinutes,
          autoClosed: false,
          siteId: existing?.siteId ?? siteId,
        };
        const saved = existing
          ? await tx.attendance.update({ where: { id: existing.id }, data })
          : await tx.attendance.create({
              data: {
                ...data,
                organizationId: ctx.organizationId,
                membershipId: member.id,
                date: day,
              },
            });
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          siteId: saved.siteId,
          action: "attendance.edit",
          entity: "Attendance",
          entityId: saved.id,
          before: existing
            ? {
                clockIn: existing.clockIn,
                clockOut: existing.clockOut,
                breakMinutes: existing.breakMinutes,
                autoClosed: existing.autoClosed,
              }
            : null,
          after: {
            clockIn: saved.clockIn,
            clockOut: saved.clockOut,
            breakMinutes: saved.breakMinutes,
            autoClosed: saved.autoClosed,
          },
          reason: input.reason,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return {
          attendance: {
            id: saved.id,
            clockIn: saved.clockIn,
            clockOut: saved.clockOut,
            breakMinutes: saved.breakMinutes,
            autoClosed: saved.autoClosed,
            presenceMinutes: presenceMinutes(saved, now),
          },
        };
      });
    }),

  /** US-M06-12 / RG-M06-08 à 10 — temps facturé vs passé par mécanicien. */
  productivity: requirePermission("workshop:productivity")
    .input(productivityInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction((tx) =>
        loadProductivity(tx, {
          timeZone: org.timeZone,
          from: input.from,
          to: input.to,
          siteId: input.siteId,
          repairOrderWhere: siteWhere(ctx, input.siteId),
          now,
        }),
      );
    }),

  /** /atelier/controle-qualite — OR en attente de contrôle, contrôles précédents. */
  qcQueue: requirePermission("repair_order:qc")
    .input(z.object({ siteId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const rows = await tenantDb.repairOrder.findMany({
        where: { ...siteWhere(ctx, input.siteId), deletedAt: null, status: "QUALITY_CHECK" },
        include: {
          vehicle: { select: { plate: true, make: true, model: true } },
          customer: { select: { displayName: true } },
          qualityChecks: {
            orderBy: { createdAt: "desc" },
            select: { id: true, result: true, createdAt: true, comment: true },
          },
          lines: {
            where: { type: { in: ["LABOR", "SUBCONTRACT"] }, status: { not: "CANCELLED" } },
            select: { id: true },
          },
        },
        orderBy: [{ completedAt: "asc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        plate: r.vehicle.plate,
        vehicle: `${r.vehicle.make} ${r.vehicle.model}`.trim(),
        customerName: r.customer.displayName,
        completedAt: r.completedAt,
        tasks: r.lines.length,
        previousChecks: r.qualityChecks,
      }));
    }),

  /** US-M06-11 — lignes de sous-traitance par statut, retour prévu, vente à perte. */
  subcontractList: requirePermission("workshop:subcontract")
    .input(subcontractListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const lines = await tenantDb.repairOrderLine.findMany({
        where: {
          type: "SUBCONTRACT",
          status: { not: "CANCELLED" },
          ...(input.status
            ? input.status === "TO_SEND"
              ? { OR: [{ subcontractStatus: "TO_SEND" }, { subcontractStatus: null }] }
              : { subcontractStatus: input.status }
            : {}),
          repairOrder: {
            ...siteWhere(ctx, input.siteId),
            deletedAt: null,
            status: { notIn: ["CANCELLED", "INVOICED"] },
          },
        },
        include: {
          repairOrder: { select: { id: true, number: true, vehicle: { select: { plate: true } } } },
        },
        orderBy: [{ subcontractExpectedAt: "asc" }, { createdAt: "asc" }],
        take: 200,
      });
      const supplierIds = [
        ...new Set(lines.map((l) => l.supplierId).filter((s): s is string => !!s)),
      ];
      const suppliers = supplierIds.length
        ? await tenantDb.supplier.findMany({
            where: { id: { in: supplierIds } },
            select: { id: true, name: true },
          })
        : [];
      return lines.map((l) => ({
        id: l.id,
        description: l.description,
        repairOrder: {
          id: l.repairOrder.id,
          number: l.repairOrder.number,
          plate: l.repairOrder.vehicle.plate,
        },
        supplierName: suppliers.find((s) => s.id === l.supplierId)?.name ?? null,
        status: (l.subcontractStatus ?? "TO_SEND") as SubcontractStatusValue,
        expectedAt: l.subcontractExpectedAt,
        returnedAt: l.subcontractReturnedAt,
        cost: l.costPrice,
        salePrice: Math.round(l.unitPrice * l.quantity),
        loss: isSubcontractLoss(l),
        overdue: isSubcontractOverdue(l, now),
      }));
    }),

  subcontractUpdateStatus: requirePermission("workshop:subcontract")
    .input(subcontractUpdateStatusInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const line = await tx.repairOrderLine.findFirst({
          where: { id: input.lineId },
          include: { repairOrder: { select: { siteId: true, status: true } } },
        });
        if (!line) notFound("Ligne introuvable.");
        requireSite(ctx, line.repairOrder.siteId);
        if (line.type !== "SUBCONTRACT") badRequest("Cette ligne n'est pas une sous-traitance.");
        try {
          assertSubcontractTransition(
            line.subcontractStatus as SubcontractStatusValue | null,
            input.status,
          );
        } catch (error) {
          if (error instanceof DomainError) badRequest(error.message, error);
          throw error;
        }
        return tx.repairOrderLine.update({
          where: { id: line.id },
          data: {
            subcontractStatus: input.status,
            subcontractReturnedAt:
              input.status === "RETURNED" ? (input.returnedAt ?? now) : line.subcontractReturnedAt,
          },
        });
      });
    }),
});
