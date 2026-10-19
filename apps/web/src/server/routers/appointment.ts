// M03 §8 — routeur `appointment` : planning, création, déplacement, cycle de vie du RDV.
// Chaque procédure vérifie sa permission (M03 §10) et la portée par site (RG-M01-09).
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  DomainError,
  GARAGE_CANCEL_REASONS,
  REQUIRED_BAY_TYPES,
  assertTransition,
  attributeReminder,
  batchConfirmationMessage,
  batchPlacement,
  canRevertNoShow,
  cancelledMessage,
  clientNamespace,
  confirmationMessage,
  defaultDuration,
  halfDayBoundary,
  isBayCompatible,
  isAppointmentLate,
  isLateCancellation,
  isDomainError,
  localDateKey,
  localMinutes,
  noShowCount12m,
  noShowMessage,
  openIntervalsForDay,
  reminderNowMessage,
  rescheduledMessage,
  requiresMandatoryConfirmation,
  zonedInstant,
  type AppointmentStatusKey,
  type AppointmentTypeKey,
} from "@atelieros/core";
import { db, writeAuditLog, type Prisma } from "@atelieros/db";
import {
  appointmentCancelInputSchema,
  appointmentCompleteInputSchema,
  appointmentConfirmInputSchema,
  appointmentCreateBatchInputSchema,
  appointmentCreateInputSchema,
  appointmentIdInputSchema,
  appointmentListInputSchema,
  appointmentRevertNoShowInputSchema,
  appointmentTodayInputSchema,
  appointmentUpdateInputSchema,
} from "@atelieros/validators";
import { emitDomainEvent } from "../events/emit";
import { requirePermission, requireSite, router } from "../trpc";
import {
  RECEPTION_PATH,
  assertBookable,
  asTx,
  concurrentConflictError,
  dayBounds,
  dispatchNotifications,
  enqueueAppointmentMessage,
  extendAppointmentLink,
  hasConfirmTemplate,
  isOverlapViolation,
  issueAppointmentLink,
  issueBookingLink,
  loadOrganization,
  loadPlanning,
  openRepairOrderWarning,
  planningConfigOf,
  resolveSite,
  templateContext,
  vehicleAppointmentsSameDay,
  type AppointmentNotification,
  type Tx,
} from "../appointments/service";

const CANCEL_REASON_LABELS: Record<(typeof GARAGE_CANCEL_REASONS)[number], string> = {
  PART_UNAVAILABLE: "Pièce non disponible",
  WORKSHOP_OVERLOADED: "Atelier surchargé",
  MECHANIC_ABSENT: "Mécanicien absent",
  DUPLICATE: "Doublon",
  OTHER: "Autre",
};

const CANCELLABLE_REMINDER_STATUSES = ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] as const;

/** Traduit une DomainError métier en TRPCError (le code reste lisible via `data.domainCode`). */
function rethrow(error: unknown): never {
  if (isOverlapViolation(error)) {
    const domain = concurrentConflictError();
    throw new TRPCError({ code: "CONFLICT", message: domain.message, cause: domain });
  }
  if (isDomainError(error)) {
    const conflictCodes = [
      "SLOT_CONFLICT",
      "SLOT_BLOCKED",
      "DUPLICATE_SAME_DAY",
      "CAPACITY_EXCEEDED",
      "MECHANIC_ABSENT",
    ];
    throw new TRPCError({
      code: conflictCodes.includes(error.code) ? "CONFLICT" : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  throw error;
}

const appointmentInclude = {
  customer: {
    select: {
      id: true,
      displayName: true,
      civility: true,
      lastName: true,
      phone: true,
      whatsappPhone: true,
      email: true,
      hasWhatsapp: true,
    },
  },
  vehicle: {
    select: {
      id: true,
      plate: true,
      make: true,
      model: true,
      year: true,
      inspectionExpiryDate: true,
      nextServiceDueDate: true,
    },
  },
  bay: { select: { id: true, name: true, type: true } },
  mechanic: { select: { id: true, user: { select: { name: true } } } },
  advisor: { select: { id: true, user: { select: { name: true } } } },
} satisfies Prisma.AppointmentInclude;

type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

async function loadAppointment(tx: Tx, id: string): Promise<AppointmentRow> {
  const appointment = await tx.appointment.findFirst({
    where: { id },
    include: appointmentInclude,
  });
  if (!appointment) throw new TRPCError({ code: "NOT_FOUND", message: "Rendez-vous introuvable." });
  return appointment;
}

async function noShowCounts(
  tx: Tx,
  customerIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (customerIds.length === 0) return new Map();
  const since = new Date(now);
  since.setUTCFullYear(since.getUTCFullYear() - 1);
  const rows = await tx.appointment.findMany({
    where: { customerId: { in: customerIds }, status: "NO_SHOW", startsAt: { gte: since } },
    select: { customerId: true, status: true, startsAt: true },
  });
  const counts = new Map<string, number>();
  for (const id of customerIds) {
    counts.set(
      id,
      noShowCount12m(
        rows
          .filter((r) => r.customerId === id)
          .map((r) => ({ status: r.status as AppointmentStatusKey, startsAt: r.startsAt })),
        now,
      ),
    );
  }
  return counts;
}

function enrich(
  a: AppointmentRow,
  ctx: { now: Date; lateAfterMinutes: number; noShows: Map<string, number> },
) {
  const noShowCount = ctx.noShows.get(a.customerId) ?? 0;
  const inspectionSoon =
    !!a.vehicle?.inspectionExpiryDate &&
    a.vehicle.inspectionExpiryDate.getTime() - ctx.now.getTime() < 30 * 86_400_000;
  return {
    id: a.id,
    siteId: a.siteId,
    customerId: a.customerId,
    vehicleId: a.vehicleId,
    bayId: a.bayId,
    mechanicId: a.mechanicId,
    advisorId: a.advisorId,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    durationMinutes: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000),
    type: a.type,
    status: a.status,
    source: a.source,
    reminderId: a.reminderId,
    complaint: a.complaint,
    notes: a.notes,
    repairOrderId: a.repairOrderId,
    groupId: a.groupId,
    overbooked: a.overbooked,
    outsideHours: a.outsideHours,
    confirmedAt: a.confirmedAt,
    confirmedVia: a.confirmedVia,
    arrivedAt: a.arrivedAt,
    cancelledAt: a.cancelledAt,
    cancelledBy: a.cancelledBy,
    cancelReason: a.cancelReason,
    noShowAt: a.noShowAt,
    customer: {
      id: a.customer.id,
      displayName: a.customer.displayName,
      phone: a.customer.phone,
      whatsappPhone: a.customer.whatsappPhone,
    },
    vehicle: a.vehicle,
    bay: a.bay,
    mechanicName: a.mechanic?.user.name ?? null,
    advisorName: a.advisor?.user.name ?? null,
    flags: {
      late: isAppointmentLate(
        { status: a.status as AppointmentStatusKey, startsAt: a.startsAt },
        ctx.now,
        ctx.lateAfterMinutes,
      ),
      noShowCount,
      mandatoryConfirmation: requiresMandatoryConfirmation(noShowCount),
      inspectionSoon,
      vehicleToIdentify: !a.vehicleId,
      noChannel: !a.customer.phone && !a.customer.whatsappPhone,
    },
  };
}

export type EnrichedAppointment = ReturnType<typeof enrich>;

interface Actor {
  organizationId: string;
  user: { id: string };
  membership: { id: string };
  ip: string;
  userAgent: string;
}

async function audit(
  ctx: Actor,
  action: string,
  entityId: string,
  extra: { before?: unknown; after?: unknown; reason?: string | null; siteId?: string | null },
) {
  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    membershipId: ctx.membership.id,
    siteId: extra.siteId ?? null,
    action,
    entity: "Appointment",
    entityId,
    before: extra.before,
    after: extra.after,
    reason: extra.reason ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

async function cancelAppointmentReminders(tx: Tx, appointmentId: string, reason: string) {
  await tx.reminder.updateMany({
    where: {
      appointmentId,
      type: "APPOINTMENT",
      status: { in: [...CANCELLABLE_REMINDER_STATUSES] },
    },
    data: { status: "CANCELLED", skippedReason: reason },
  });
}

function toEnrichCtx(lateAfterMinutes: number, now: Date, noShows: Map<string, number>) {
  return { now, lateAfterMinutes, noShows };
}

export const appointmentRouter = router({
  /** §8 `appointment.list` — RDV enrichis + blocages + OR occupant un pont + colonnes. */
  list: requirePermission("appointment:read")
    .input(appointmentListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const tx = asTx(tenantDb);
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const config = planningConfigOf(org);
      const site = await resolveSite(tx, ctx, input.siteId);
      const where: Prisma.AppointmentWhereInput = {
        siteId: site.id,
        startsAt: { lt: input.to },
        endsAt: { gt: input.from },
        ...(input.bayIds ? { bayId: { in: input.bayIds } } : {}),
        ...(input.mechanicIds ? { mechanicId: { in: input.mechanicIds } } : {}),
        ...(input.statuses ? { status: { in: input.statuses } } : {}),
        ...(input.types ? { type: { in: input.types } } : {}),
        ...(input.sources ? { source: { in: input.sources } } : {}),
      };
      // ADVISOR/MANAGER voient tout le site ; un MECHANIC ne voit que ses RDV (§10).
      if (ctx.membership.role === "MECHANIC") where.mechanicId = ctx.membership.id;
      const [rows, planning] = await Promise.all([
        tx.appointment.findMany({
          where,
          include: appointmentInclude,
          orderBy: { startsAt: "asc" },
        }),
        loadPlanning(tx, { org, site, from: input.from, to: input.to, now }),
      ]);
      const noShows = await noShowCounts(tx, [...new Set(rows.map((r) => r.customerId))], now);
      return {
        site: { id: site.id, name: site.name, openingHours: site.openingHours },
        timeZone: org.timezone,
        operatingMode: org.operatingMode,
        slotStepMinutes: config.appointments.slotStepMinutes,
        halfDayBoundaryMinutes: halfDayBoundary(config.planning.lunchBreak),
        appointments: rows.map((r) =>
          enrich(r, toEnrichCtx(config.appointments.lateAfterMinutes, now, noShows)),
        ),
        blocks: planning.snapshot.blocks,
        occupyingOrders: planning.snapshot.orders,
        bays: planning.bays.filter((b) => b.isActive),
        mechanics: planning.mechanics.map((m) => ({
          ...m,
          absent: planning.snapshot.blocks.some((b) => b.membershipId === m.id),
        })),
      };
    }),

  /** §8 `appointment.get` — RDV, client, véhicule, messages liés, relance d'origine. */
  get: requirePermission("appointment:read")
    .input(appointmentIdInputSchema)
    .query(async ({ ctx, input }) => {
      const tx = asTx(db.forTenant({ organizationId: ctx.organizationId }));
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const config = planningConfigOf(org);
      const appointment = await loadAppointment(tx, input.id);
      requireSite(ctx, appointment.siteId);
      if (ctx.membership.role === "MECHANIC" && appointment.mechanicId !== ctx.membership.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Rendez-vous introuvable." });
      }
      const [messages, reminder, noShows, repairOrder] = await Promise.all([
        tx.message.findMany({
          where: {
            OR: [
              { idempotencyKey: { startsWith: `appt:${appointment.id}:` } },
              ...(appointment.groupId
                ? [{ idempotencyKey: { startsWith: `appt:${appointment.groupId}:` } }]
                : []),
            ],
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            channel: true,
            status: true,
            body: true,
            createdAt: true,
            direction: true,
          },
        }),
        appointment.reminderId
          ? tx.reminder.findFirst({
              where: { id: appointment.reminderId },
              select: { id: true, type: true, stepKey: true, sentAt: true },
            })
          : null,
        noShowCounts(tx, [appointment.customerId], now),
        appointment.repairOrderId
          ? tx.repairOrder.findFirst({
              where: { id: appointment.repairOrderId },
              select: { id: true, number: true, status: true },
            })
          : null,
      ]);
      return {
        ...enrich(appointment, toEnrichCtx(config.appointments.lateAfterMinutes, now, noShows)),
        messages,
        reminder,
        repairOrder,
        timeZone: org.timezone,
        operatingMode: org.operatingMode,
        canRevertNoShow: canRevertNoShow(appointment.noShowAt, now),
      };
    }),

  /** §8 `appointment.create` — US-M03-01, RG-M03-01 à 05, 12, 13. */
  create: requirePermission("appointment:create")
    .input(appointmentCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const config = planningConfigOf(org);
      const canForce = ctx.permissions.has("planning:manage");
      const notifications: Array<AppointmentNotification | null> = [];
      const warnings: string[] = [];
      let created: { id: string } | null = null;
      try {
        created = await tenantDb.transaction(async (tx) => {
          const site = await resolveSite(tx, ctx, input.siteId);
          const customer = await tx.customer.findFirst({
            where: { id: input.customerId, deletedAt: null },
          });
          if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "Client introuvable." });
          const vehicle = input.vehicleId
            ? await tx.vehicle.findFirst({
                where: { id: input.vehicleId, customerId: customer.id, deletedAt: null },
              })
            : null;
          if (input.vehicleId && !vehicle) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Véhicule introuvable pour ce client.",
            });
          }
          const operations = input.laborOperationIds.length
            ? await tx.laborOperation.findMany({ where: { id: { in: input.laborOperationIds } } })
            : [];
          const duration =
            input.durationMinutes ??
            defaultDuration(
              input.type,
              operations.map((o) => o.standardHours),
              config.appointments.durations,
            );
          const startsAt = input.startsAt;
          const endsAt = new Date(startsAt.getTime() + duration * 60_000);
          const dayKey = localDateKey(startsAt, org.timezone);
          const { from, to } = dayBounds(dayKey, org.timezone);
          const planning = await loadPlanning(tx, { org, site, from, to, now });
          const check = assertBookable({
            planning,
            config,
            startsAt,
            endsAt,
            type: input.type,
            bayId: input.bayId ?? null,
            mechanicId: input.mechanicId ?? null,
            vehicleId: input.vehicleId ?? null,
            force: input.force,
            canForce,
            checkLoad: true,
            vehicleSameDay: await vehicleAppointmentsSameDay(
              tx,
              input.vehicleId ?? null,
              startsAt,
              org.timezone,
            ),
          });
          warnings.push(...check.warnings);
          const workshopWarning = await openRepairOrderWarning(tx, input.vehicleId ?? null);
          if (workshopWarning) warnings.push(workshopWarning);

          // RG-M03-12 : attribution à la relance VT/révision des 14 derniers jours.
          const recentReminders = input.vehicleId
            ? await tx.reminder.findMany({
                where: {
                  customerId: customer.id,
                  vehicleId: input.vehicleId,
                  status: "SENT",
                  type: { in: ["INSPECTION", "SERVICE"] },
                  sentAt: { gte: new Date(now.getTime() - 14 * 86_400_000) },
                },
                select: { id: true, type: true, customerId: true, vehicleId: true, sentAt: true },
              })
            : [];
          const reminderId = attributeReminder(
            {
              customerId: customer.id,
              vehicleId: input.vehicleId ?? null,
              createdAt: now,
              reminderId: input.reminderId,
            },
            recentReminders,
          );

          const appointment = await tx.appointment.create({
            data: {
              organizationId: ctx.organizationId,
              siteId: site.id,
              customerId: customer.id,
              vehicleId: input.vehicleId ?? null,
              bayId: input.bayId ?? null,
              mechanicId: input.mechanicId ?? null,
              advisorId: input.advisorId ?? ctx.membership.id,
              startsAt,
              endsAt,
              type: input.type,
              source: input.source,
              reminderId,
              complaint: input.complaint || null,
              notes: input.notes || null,
              laborOperationIds: input.laborOperationIds,
              overbooked: check.overbooked,
              outsideHours: check.outsideHours,
              createdById: ctx.membership.id,
            },
          });
          if (reminderId) {
            await tx.reminder.updateMany({
              where: { id: reminderId },
              data: { outcome: "APPOINTMENT_BOOKED", outcomeAt: now },
            });
          }
          const link = await issueAppointmentLink(tx, {
            organizationId: ctx.organizationId,
            appointmentId: appointment.id,
            customerId: customer.id,
            startsAt,
            reminderId,
            createdById: ctx.membership.id,
          });
          await emitDomainEvent(tx as never, ctx.organizationId, "appointment.created", {
            appointmentId: appointment.id,
            customerId: customer.id,
            vehicleId: appointment.vehicleId,
            startsAt: startsAt.toISOString(),
            reminderId,
            source: appointment.source,
          });
          if (input.notifyCustomer) {
            const useTemplate = await hasConfirmTemplate(tx);
            notifications.push(
              await enqueueAppointmentMessage(tx, {
                organizationId: ctx.organizationId,
                appointmentId: appointment.id,
                kind: "confirm",
                idempotencySuffix: startsAt.toISOString(),
                customer,
                body: confirmationMessage({
                  salutation: clientNamespace(customer).salutation,
                  garageName: org.name,
                  type: input.type,
                  startsAt,
                  timeZone: org.timezone,
                  vehicle,
                  link,
                }),
                sentById: ctx.membership.id,
                timeZone: org.timezone,
                now,
                ...(useTemplate
                  ? {
                      templateKey: "rdv_confirm",
                      context: templateContext({
                        org,
                        site,
                        customer,
                        vehicle,
                        startsAt,
                        type: input.type,
                      }),
                    }
                  : {}),
              }),
            );
          }
          return appointment;
        });
      } catch (error) {
        rethrow(error);
      }
      await dispatchNotifications(notifications, now);
      const appointment = await loadAppointment(asTx(tenantDb), created!.id);
      if (appointment.overbooked || appointment.outsideHours) {
        await audit(ctx, "appointment.forced", appointment.id, {
          siteId: appointment.siteId,
          after: { overbooked: appointment.overbooked, outsideHours: appointment.outsideHours },
          reason: "Forçage planning (surréservation, capacité ou hors horaires)",
        });
      }
      return {
        appointment: enrich(
          appointment,
          toEnrichCtx(config.appointments.lateAfterMinutes, now, new Map()),
        ),
        warnings,
        notified: notifications.some((n) => n !== null),
      };
    }),

  /** §8 `appointment.update` — déplacer (glisser-déposer), redimensionner, éditer. */
  update: requirePermission("appointment:update")
    .input(appointmentUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const config = planningConfigOf(org);
      const canForce = ctx.permissions.has("planning:manage");
      const notifications: Array<AppointmentNotification | null> = [];
      const warnings: string[] = [];
      let before: AppointmentRow | null = null;
      try {
        await tenantDb.transaction(async (tx) => {
          const current = await loadAppointment(tx, input.id);
          before = current;
          requireSite(ctx, current.siteId);
          const status = current.status as AppointmentStatusKey;
          const startsAt = input.startsAt ?? current.startsAt;
          const duration =
            input.durationMinutes ??
            Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60_000);
          const endsAt = new Date(startsAt.getTime() + duration * 60_000);
          const bayId = input.bayId === undefined ? current.bayId : input.bayId;
          const mechanicId = input.mechanicId === undefined ? current.mechanicId : input.mechanicId;
          const type = (input.type ?? current.type) as AppointmentTypeKey;
          const timeChanged =
            startsAt.getTime() !== current.startsAt.getTime() ||
            endsAt.getTime() !== current.endsAt.getTime();
          const placementChanged =
            timeChanged || bayId !== current.bayId || mechanicId !== current.mechanicId;
          const onlyNotes =
            !placementChanged && input.type === undefined && input.complaint === undefined;
          if (!onlyNotes) assertTransition(status, placementChanged ? "reschedule" : "edit");

          let overbooked = current.overbooked;
          let outsideHours = current.outsideHours;
          if (placementChanged) {
            const site = await resolveSite(tx, ctx, current.siteId);
            const { from, to } = dayBounds(localDateKey(startsAt, org.timezone), org.timezone);
            const planning = await loadPlanning(tx, { org, site, from, to, now });
            const check = assertBookable({
              planning,
              config,
              startsAt,
              endsAt,
              type,
              bayId,
              mechanicId,
              vehicleId: current.vehicleId,
              excludeId: current.id,
              force: input.force,
              canForce,
              checkLoad: timeChanged,
              vehicleSameDay: timeChanged
                ? await vehicleAppointmentsSameDay(tx, current.vehicleId, startsAt, org.timezone)
                : [],
            });
            warnings.push(...check.warnings);
            overbooked = check.overbooked;
            outsideHours = check.outsideHours;
          }
          await tx.appointment.update({
            where: { id: current.id },
            data: {
              startsAt,
              endsAt,
              bayId,
              mechanicId,
              type,
              overbooked,
              outsideHours,
              ...(input.complaint !== undefined ? { complaint: input.complaint } : {}),
              ...(input.notes !== undefined ? { notes: input.notes } : {}),
            },
          });
          const rescheduled = startsAt.getTime() !== current.startsAt.getTime();
          if (placementChanged || input.type !== undefined) {
            await emitDomainEvent(tx as never, ctx.organizationId, "appointment.updated", {
              appointmentId: current.id,
              vehicleId: current.vehicleId,
              customerId: current.customerId,
              rescheduled,
              previousStartsAt: current.startsAt.toISOString(),
              startsAt: startsAt.toISOString(),
            });
          }
          if (rescheduled) {
            // M10 recalcule le J-1 au prochain passage du planificateur (dueDate = nouveau jour).
            await cancelAppointmentReminders(tx, current.id, "Rendez-vous déplacé.");
            await extendAppointmentLink(tx, current.id, startsAt);
            if (input.notifyCustomer) {
              notifications.push(
                await enqueueAppointmentMessage(tx, {
                  organizationId: ctx.organizationId,
                  appointmentId: current.id,
                  kind: "moved",
                  idempotencySuffix: `${startsAt.toISOString()}@${now.getTime()}`,
                  customer: current.customer,
                  body: rescheduledMessage({
                    salutation: clientNamespace(current.customer).salutation,
                    garageName: org.name,
                    type,
                    startsAt,
                    timeZone: org.timezone,
                    vehicle: current.vehicle,
                  }),
                  sentById: ctx.membership.id,
                  timeZone: org.timezone,
                  now,
                }),
              );
            }
          }
        });
      } catch (error) {
        rethrow(error);
      }
      await dispatchNotifications(notifications, now);
      const appointment = await loadAppointment(asTx(tenantDb), input.id);
      if (
        (appointment.overbooked && !before!.overbooked) ||
        (appointment.outsideHours && !before!.outsideHours)
      ) {
        await audit(ctx, "appointment.forced", appointment.id, {
          siteId: appointment.siteId,
          before: { startsAt: before!.startsAt, bayId: before!.bayId },
          after: {
            startsAt: appointment.startsAt,
            bayId: appointment.bayId,
            overbooked: appointment.overbooked,
          },
          reason: "Forçage planning (surréservation, capacité ou hors horaires)",
        });
      }
      return {
        appointment: enrich(
          appointment,
          toEnrichCtx(config.appointments.lateAfterMinutes, now, new Map()),
        ),
        warnings,
        notified: notifications.some((n) => n !== null),
      };
    }),

  /** RG-M03-09 — confirmation manuelle (téléphone, en personne…). */
  confirm: requirePermission("appointment:update")
    .input(appointmentConfirmInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      await tenantDb.transaction(async (tx) => {
        const current = await loadAppointment(tx, input.id);
        requireSite(ctx, current.siteId);
        withDomain(() => assertTransition(current.status as AppointmentStatusKey, "confirm"));
        await tx.appointment.update({
          where: { id: current.id },
          data: { status: "CONFIRMED", confirmedAt: now, confirmedVia: input.via },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "appointment.confirmed", {
          appointmentId: current.id,
          via: input.via,
        });
      });
      return { ok: true } as const;
    }),

  /** US-M03-08 — « Client arrivé » → ARRIVED, ouverture de la réception M04. */
  markArrived: requirePermission("appointment:update")
    .input(appointmentIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const current = await tenantDb.transaction(async (tx) => {
        const row = await loadAppointment(tx, input.id);
        requireSite(ctx, row.siteId);
        withDomain(() => assertTransition(row.status as AppointmentStatusKey, "arrive"));
        await tx.appointment.update({
          where: { id: row.id },
          data: { status: "ARRIVED", arrivedAt: now },
        });
        await cancelAppointmentReminders(tx, row.id, "Client arrivé.");
        await emitDomainEvent(tx as never, ctx.organizationId, "appointment.arrived", {
          appointmentId: row.id,
          customerId: row.customerId,
          vehicleId: row.vehicleId,
        });
        return row;
      });
      // Mode REMINDERS_ONLY (§11) : pas de réception, l'OR est fait dans l'ancien logiciel.
      const receptionUrl =
        org.operatingMode === "REMINDERS_ONLY"
          ? null
          : `${RECEPTION_PATH}?appointmentId=${current.id}`;
      return { appointmentId: current.id, receptionUrl };
    }),

  /** §5 — « Terminer sans OR » (simple contrôle gratuit), motif requis. */
  complete: requirePermission("appointment:update")
    .input(appointmentCompleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const row = await tenantDb.transaction(async (tx) => {
        const current = await loadAppointment(tx, input.id);
        requireSite(ctx, current.siteId);
        withDomain(() => assertTransition(current.status as AppointmentStatusKey, "complete"));
        await tx.appointment.update({
          where: { id: current.id },
          data: { status: "COMPLETED", completedAt: now },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "appointment.completed", {
          appointmentId: current.id,
          withoutRepairOrder: true,
        });
        return current;
      });
      await audit(ctx, "appointment.completed_without_order", row.id, {
        siteId: row.siteId,
        reason: input.reason,
      });
      return { ok: true } as const;
    }),

  /** RG-M03-11 — annulation (garage : motif obligatoire), groupe compris. */
  cancel: requirePermission("appointment:cancel")
    .input(appointmentCancelInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const notifications: Array<AppointmentNotification | null> = [];
      const reasonText =
        input.cancelledBy === "GARAGE" && input.reasonCode
          ? input.reasonCode === "OTHER"
            ? input.reason!
            : CANCEL_REASON_LABELS[input.reasonCode] + (input.reason ? ` — ${input.reason}` : "")
          : (input.reason ?? null);
      const result = await tenantDb.transaction(async (tx) => {
        const current = await loadAppointment(tx, input.id);
        requireSite(ctx, current.siteId);
        withDomain(() => assertTransition(current.status as AppointmentStatusKey, "cancel"));
        await tx.appointment.update({
          where: { id: current.id },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancelledBy: input.cancelledBy,
            cancelReason: reasonText,
          },
        });
        await cancelAppointmentReminders(tx, current.id, "Rendez-vous annulé.");
        await emitDomainEvent(tx as never, ctx.organizationId, "appointment.cancelled", {
          appointmentId: current.id,
          vehicleId: current.vehicleId,
          customerId: current.customerId,
          cancelledBy: input.cancelledBy,
          lateCancellation:
            input.cancelledBy === "CUSTOMER" && isLateCancellation(current.startsAt, now),
        });
        if (input.notifyCustomer && input.cancelledBy === "GARAGE") {
          const link = await issueBookingLink(tx, {
            organizationId: ctx.organizationId,
            customerId: current.customerId,
            vehicleId: current.vehicleId,
            reminderId: current.reminderId,
            createdById: ctx.membership.id,
            now,
          });
          notifications.push(
            await enqueueAppointmentMessage(tx, {
              organizationId: ctx.organizationId,
              appointmentId: current.id,
              kind: "cancelled",
              idempotencySuffix: "1",
              customer: current.customer,
              body: cancelledMessage({
                salutation: clientNamespace(current.customer).salutation,
                garageName: org.name,
                type: current.type as AppointmentTypeKey,
                startsAt: current.startsAt,
                timeZone: org.timezone,
                link,
                garagePhone: org.phone,
              }),
              sentById: ctx.membership.id,
              timeZone: org.timezone,
              now,
            }),
          );
        }
        return current;
      });
      await dispatchNotifications(notifications, now);
      await audit(ctx, "appointment.cancelled", result.id, {
        siteId: result.siteId,
        reason: reasonText,
        after: { cancelledBy: input.cancelledBy },
      });
      return { ok: true } as const;
    }),

  /** RG-M03-14 — annuler tout un groupe (RDV non arrivés). */
  cancelGroup: requirePermission("appointment:cancel", "planning:manage")
    .input(appointmentIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const ids = await tenantDb.transaction(async (tx) => {
        const current = await loadAppointment(tx, input.id);
        requireSite(ctx, current.siteId);
        if (!current.groupId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ce RDV n'appartient à aucun groupe.",
          });
        const group = await tx.appointment.findMany({
          where: { groupId: current.groupId, status: { in: ["BOOKED", "CONFIRMED"] } },
        });
        for (const appt of group) {
          await tx.appointment.update({
            where: { id: appt.id },
            data: {
              status: "CANCELLED",
              cancelledAt: now,
              cancelledBy: "GARAGE",
              cancelReason: "Annulation du groupe",
            },
          });
          await cancelAppointmentReminders(tx, appt.id, "Rendez-vous annulé.");
          await emitDomainEvent(tx as never, ctx.organizationId, "appointment.cancelled", {
            appointmentId: appt.id,
            vehicleId: appt.vehicleId,
            customerId: appt.customerId,
            cancelledBy: "GARAGE",
          });
        }
        return group.map((a) => a.id);
      });
      for (const id of ids) {
        await audit(ctx, "appointment.cancelled", id, {
          reason: "Annulation du groupe",
          after: { cancelledBy: "GARAGE", groupCancel: input.id },
        });
      }
      return { cancelled: ids.length };
    }),

  /** RG-M03-10 — marquer absent (manuel ; le job de 20:00 fait de même). */
  markNoShow: requirePermission("appointment:update")
    .input(appointmentIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      await tenantDb.transaction(async (tx) => {
        const current = await loadAppointment(tx, input.id);
        requireSite(ctx, current.siteId);
        withDomain(() => assertTransition(current.status as AppointmentStatusKey, "no_show"));
        await tx.appointment.update({
          where: { id: current.id },
          data: { status: "NO_SHOW", noShowAt: now },
        });
        await cancelAppointmentReminders(tx, current.id, "Client absent.");
        await emitDomainEvent(tx as never, ctx.organizationId, "appointment.no_show", {
          appointmentId: current.id,
          customerId: current.customerId,
          vehicleId: current.vehicleId,
          reminderId: current.reminderId,
        });
      });
      return { ok: true } as const;
    }),

  /** RG-M03-10 — correction d'un NO_SHOW dans les 48 h (client arrivé mais non pointé). */
  revertNoShow: requirePermission("appointment:update")
    .input(appointmentRevertNoShowInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const row = await tenantDb
        .transaction(async (tx) => {
          const current = await loadAppointment(tx, input.id);
          requireSite(ctx, current.siteId);
          withDomain(() =>
            assertTransition(current.status as AppointmentStatusKey, "revert_no_show"),
          );
          if (!canRevertNoShow(current.noShowAt, now)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "La correction d'une absence n'est possible que dans les 48 h.",
            });
          }
          // §11 : si le pont a été réattribué entre-temps, le RDV passe « À affecter ».
          const bayTaken = current.bayId
            ? await tx.appointment.findFirst({
                where: {
                  id: { not: current.id },
                  bayId: current.bayId,
                  status: { notIn: ["CANCELLED", "NO_SHOW"] },
                  startsAt: { lt: current.endsAt },
                  endsAt: { gt: current.startsAt },
                },
                select: { id: true },
              })
            : null;
          await tx.appointment.update({
            where: { id: current.id },
            data: {
              status: "ARRIVED",
              arrivedAt: now,
              noShowAt: null,
              ...(bayTaken ? { bayId: null } : {}),
            },
          });
          return current;
        })
        .catch(rethrow);
      await audit(ctx, "appointment.no_show_reverted", row.id, {
        siteId: row.siteId,
        reason: input.reason,
      });
      return { ok: true } as const;
    }),

  /** US-M03-09 — message de reprogrammation après absence (validation manuelle : bouton). */
  sendNoShowMessage: requirePermission("appointment:update")
    .input(appointmentIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const notification = await tenantDb.transaction(async (tx) => {
        const current = await loadAppointment(tx, input.id);
        requireSite(ctx, current.siteId);
        if (current.status !== "NO_SHOW") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ce RDV n'est pas marqué absent." });
        }
        const link = await issueBookingLink(tx, {
          organizationId: ctx.organizationId,
          customerId: current.customerId,
          vehicleId: current.vehicleId,
          reminderId: current.reminderId,
          createdById: ctx.membership.id,
          now,
        });
        return enqueueAppointmentMessage(tx, {
          organizationId: ctx.organizationId,
          appointmentId: current.id,
          kind: "no_show",
          idempotencySuffix: "1",
          customer: current.customer,
          body: noShowMessage({
            salutation: clientNamespace(current.customer).salutation,
            garageName: org.name,
            type: current.type as AppointmentTypeKey,
            startsAt: current.startsAt,
            timeZone: org.timezone,
            link,
          }),
          sentById: ctx.membership.id,
          timeZone: org.timezone,
          now,
        });
      });
      if (!notification) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Aucun canal disponible pour ce client : appelez-le.",
        });
      }
      await dispatchNotifications([notification], now);
      return { messageId: notification.messageId };
    }),

  /** §8 `appointment.sendReminderNow` — rappel immédiat (1 / 2 / 3). */
  sendReminderNow: requirePermission("appointment:update")
    .input(appointmentIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const notification = await tenantDb.transaction(async (tx) => {
        const current = await loadAppointment(tx, input.id);
        requireSite(ctx, current.siteId);
        if (!["BOOKED", "CONFIRMED"].includes(current.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ce RDV n'est plus à venir." });
        }
        return enqueueAppointmentMessage(tx, {
          organizationId: ctx.organizationId,
          appointmentId: current.id,
          kind: "reminder",
          idempotencySuffix: now.toISOString().slice(0, 16),
          customer: current.customer,
          body: reminderNowMessage({
            salutation: clientNamespace(current.customer).salutation,
            garageName: org.name,
            type: current.type as AppointmentTypeKey,
            startsAt: current.startsAt,
            timeZone: org.timezone,
            vehicle: current.vehicle,
          }),
          sentById: ctx.membership.id,
          timeZone: org.timezone,
          now,
        });
      });
      if (!notification) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Aucun canal disponible pour ce client : appelez-le.",
        });
      }
      await dispatchNotifications([notification], now);
      return { messageId: notification.messageId };
    }),

  /** US-M03-12 — planification en lot d'une flotte (un `groupId`, une seule confirmation). */
  createBatch: requirePermission("appointment:create", "planning:manage")
    .input(appointmentCreateBatchInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const config = planningConfigOf(org);
      const tz = org.timezone;
      const notifications: Array<AppointmentNotification | null> = [];
      const groupId = randomUUID();
      let result: { ids: string[]; unplaced: string[] } = { ids: [], unplaced: [] };
      try {
        result = await tenantDb.transaction(async (tx) => {
          const site = await resolveSite(tx, ctx, input.siteId);
          const customer = await tx.customer.findFirst({
            where: { id: input.customerId, deletedAt: null },
          });
          if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "Client introuvable." });
          const vehicles = await tx.vehicle.findMany({
            where: { id: { in: input.vehicleIds }, customerId: customer.id },
          });
          if (vehicles.length !== input.vehicleIds.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Un véhicule n'appartient pas à ce client.",
            });
          }
          const { from, to } = dayBounds(input.date, tz);
          const planning = await loadPlanning(tx, { org, site, from, to, now });
          const duration = config.appointments.durations[input.type];
          const step = config.appointments.slotStepMinutes;
          const starts: Date[] = [];
          for (const [open, close] of openIntervalsForDay(input.date, planning.snapshot)) {
            for (let t = Math.ceil(open / step) * step; t + duration <= close; t += step) {
              const startsAt = zonedInstant(input.date, t, tz);
              if (startsAt > now) starts.push(startsAt);
            }
          }
          const compatible = planning.bays.filter(
            (b) => b.isActive && isBayCompatible(input.type, b.type),
          );
          const bays = (
            compatible.length > 0 || REQUIRED_BAY_TYPES[input.type] !== null
              ? compatible
              : planning.bays
          ).map((b) => ({
            id: b.id,
            busy: [
              ...planning.snapshot.appointments.filter(
                (a) => a.bayId === b.id && !["CANCELLED", "NO_SHOW"].includes(a.status),
              ),
              ...planning.snapshot.blocks.filter(
                (k) => k.bayId === b.id || (!k.bayId && !k.membershipId),
              ),
              ...planning.snapshot.orders.filter((o) => o.bayId === b.id),
            ],
          }));
          const placement = batchPlacement({
            vehicleIds: input.vehicleIds,
            candidateStarts: starts,
            durationMinutes: duration,
            bays,
            maxParallel: input.maxParallel,
          });
          const ids: string[] = [];
          for (const p of placement.placed) {
            const appointment = await tx.appointment.create({
              data: {
                organizationId: ctx.organizationId,
                siteId: site.id,
                customerId: customer.id,
                vehicleId: p.vehicleId,
                bayId: p.bayId,
                advisorId: ctx.membership.id,
                startsAt: p.startsAt,
                endsAt: p.endsAt,
                type: input.type,
                source: "STAFF",
                groupId,
                createdById: ctx.membership.id,
              },
            });
            ids.push(appointment.id);
            await emitDomainEvent(tx as never, ctx.organizationId, "appointment.created", {
              appointmentId: appointment.id,
              customerId: customer.id,
              vehicleId: p.vehicleId,
              startsAt: p.startsAt.toISOString(),
              groupId,
            });
          }
          if (input.notifyCustomer && placement.placed.length > 0) {
            notifications.push(
              await enqueueAppointmentMessage(tx, {
                organizationId: ctx.organizationId,
                appointmentId: groupId,
                kind: "batch",
                idempotencySuffix: input.date,
                customer,
                body: batchConfirmationMessage({
                  salutation: clientNamespace(customer).salutation,
                  garageName: org.name,
                  type: input.type,
                  timeZone: tz,
                  items: placement.placed.map((p) => ({
                    plate: vehicles.find((v) => v.id === p.vehicleId)!.plate,
                    startsAt: p.startsAt,
                  })),
                }),
                sentById: ctx.membership.id,
                timeZone: tz,
                now,
              }),
            );
          }
          return { ids, unplaced: placement.unplaced };
        });
      } catch (error) {
        rethrow(error);
      }
      await dispatchNotifications(notifications, now);
      const rows = await asTx(tenantDb).appointment.findMany({
        where: { id: { in: result.ids } },
        include: appointmentInclude,
        orderBy: { startsAt: "asc" },
      });
      return {
        groupId,
        appointments: rows.map((r) =>
          enrich(r, toEnrichCtx(config.appointments.lateAfterMinutes, now, new Map())),
        ),
        unplaced: result.unplaced,
      };
    }),

  /** §7 `/rendez-vous/aujourdhui` — liste de l'accueil et confirmations à obtenir par téléphone. */
  today: requirePermission("appointment:read")
    .input(appointmentTodayInputSchema)
    .query(async ({ ctx, input }) => {
      const tx = asTx(db.forTenant({ organizationId: ctx.organizationId }));
      const now = new Date();
      const org = await loadOrganization(ctx.organizationId);
      const config = planningConfigOf(org);
      const tz = org.timezone;
      const site = await resolveSite(tx, ctx, input.siteId);
      const dateKey = input.date ?? localDateKey(now, tz);
      const { from, to } = dayBounds(dateKey, tz);
      const where: Prisma.AppointmentWhereInput = {
        siteId: site.id,
        startsAt: { gte: from, lt: to },
      };
      if (ctx.membership.role === "MECHANIC") where.mechanicId = ctx.membership.id;
      const rows = await tx.appointment.findMany({
        where,
        include: appointmentInclude,
        orderBy: { startsAt: "asc" },
      });

      // Lendemain : RDV non confirmés à appeler (sans canal, ≥ 2 absences, ou après 18:00 la veille).
      const tomorrow = await tx.appointment.findMany({
        where: {
          siteId: site.id,
          status: "BOOKED",
          startsAt: { gte: to, lt: new Date(to.getTime() + 86_400_000) },
          ...(ctx.membership.role === "MECHANIC" ? { mechanicId: ctx.membership.id } : {}),
        },
        include: appointmentInclude,
        orderBy: { startsAt: "asc" },
      });
      const noShows = await noShowCounts(
        tx,
        [...new Set([...rows, ...tomorrow].map((r) => r.customerId))],
        now,
      );
      const enrichCtx = toEnrichCtx(config.appointments.lateAfterMinutes, now, noShows);
      const items = rows.map((r) => enrich(r, enrichCtx));
      const afterSix = localMinutes(now, tz) >= 18 * 60 && dateKey === localDateKey(now, tz);
      const phoneConfirmations = tomorrow
        .map((r) => enrich(r, enrichCtx))
        .filter((a) => a.flags.noChannel || a.flags.mandatoryConfirmation || afterSix);
      const active = items.filter((a) => a.status !== "CANCELLED");
      return {
        date: dateKey,
        timeZone: tz,
        operatingMode: org.operatingMode,
        counts: {
          total: active.length,
          confirmed: active.filter((a) => a.status === "CONFIRMED").length,
          unanswered: active.filter((a) => a.status === "BOOKED").length,
          arrived: active.filter((a) => a.status === "ARRIVED" || a.status === "COMPLETED").length,
          noShow: active.filter((a) => a.status === "NO_SHOW").length,
        },
        upcoming: items.filter(
          (a) => (a.status === "BOOKED" || a.status === "CONFIRMED") && !a.flags.late,
        ),
        late: items.filter((a) => a.flags.late),
        arrived: items.filter((a) => a.status === "ARRIVED" || a.status === "COMPLETED"),
        noShow: items.filter((a) => a.status === "NO_SHOW"),
        cancelled: items.filter((a) => a.status === "CANCELLED"),
        phoneConfirmations,
      };
    }),
});

function withDomain<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof DomainError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
    }
    throw error;
  }
}
