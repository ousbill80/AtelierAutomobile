// M03 §8 « Portail public » — `portal.appointment.*`, authentifiées par jeton à portée limitée
// (PortalToken, A2). Jamais de session : le jeton fournit l'organisation. Aucun nom d'autre
// client n'est jamais renvoyé (US-M03-06). Le module M14 reprendra ce routeur (devis, factures…).
//
// Écarts documentés : portail général sans jeton (nom + téléphone + OTP) non livré ici (M14) ;
// limitation de débit en mémoire du processus (10 réservations/heure/IP), suffisante pour une
// instance unique, à déplacer dans Redis avec M14.
import { TRPCError } from "@trpc/server";
import {
  DomainError,
  addDaysToKey,
  assertTransition,
  availableSlots,
  clientNamespace,
  confirmationMessage,
  defaultDuration,
  formatDayFr,
  formatTimeFr,
  isBayCompatible,
  isDomainError,
  localDateKey,
  REQUIRED_BAY_TYPES,
  rescheduledMessage,
  type AppointmentStatusKey,
  type AppointmentTypeKey,
} from "@atelieros/core";
import { db, resolvePortalToken, type PortalToken } from "@atelieros/db";
import {
  portalBookInputSchema,
  portalRescheduleInputSchema,
  portalSlotsInputSchema,
  portalTokenInputSchema,
} from "@atelieros/validators";
import { emitDomainEvent } from "../events/emit";
import { publicProcedure, router } from "../trpc";
import {
  assertBookable,
  dayBounds,
  dispatchNotifications,
  enqueueAppointmentMessage,
  isOverlapViolation,
  issueAppointmentLink,
  loadOrganization,
  loadPlanning,
  planningConfigOf,
  vehicleAppointmentsSameDay,
  type AppointmentNotification,
  type Tx,
} from "../appointments/service";

const BOOKINGS_PER_HOUR_PER_IP = 10;
const MAX_ACTIVE_PORTAL_APPOINTMENTS = 3;
const bookingsByIp = new Map<string, number[]>();

function rateLimit(ip: string, now: Date) {
  const since = now.getTime() - 3_600_000;
  const recent = (bookingsByIp.get(ip) ?? []).filter((t) => t > since);
  if (recent.length >= BOOKINGS_PER_HOUR_PER_IP) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Trop de réservations depuis cet appareil. Réessayez dans une heure.",
    });
  }
  recent.push(now.getTime());
  bookingsByIp.set(ip, recent);
}

/** Réinitialise le limiteur (tests). */
export function resetPortalRateLimit() {
  bookingsByIp.clear();
}

async function requireToken(token: string, now: Date): Promise<PortalToken> {
  const resolved = await resolvePortalToken(token, ["APPOINTMENT", "BOOKING"], now);
  if (resolved.status === "ACTIVE") return resolved.row;
  throw new TRPCError({
    code: resolved.status === "NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN",
    message:
      resolved.status === "NOT_FOUND"
        ? "Lien introuvable."
        : "Ce lien a expiré. Appelez le garage pour prendre rendez-vous.",
    cause: new DomainError(`TOKEN_${resolved.status}`, "Lien de portail non valide."),
  });
}

function rethrow(error: unknown): never {
  if (isOverlapViolation(error)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Ce créneau vient d'être réservé. Choisissez-en un autre.",
    });
  }
  if (isDomainError(error)) {
    // Le portail ne révèle jamais la cause précise (nom d'un autre client, capacité exacte).
    const message =
      error.code === "DUPLICATE_SAME_DAY"
        ? "Vous avez déjà un rendez-vous ce jour-là."
        : error.code === "appointment.invalid_transition"
          ? error.message
          : "Ce créneau vient d'être réservé. Choisissez-en un autre.";
    throw new TRPCError({ code: "CONFLICT", message, cause: error });
  }
  throw error;
}

async function siteForToken(tx: Tx, token: PortalToken) {
  if (token.scope === "APPOINTMENT") {
    const appt = await tx.appointment.findFirst({ where: { id: token.targetId } });
    if (!appt) throw new TRPCError({ code: "NOT_FOUND", message: "Rendez-vous introuvable." });
    return tx.site.findFirstOrThrow({ where: { id: appt.siteId } });
  }
  const site = await tx.site.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!site) throw new TRPCError({ code: "NOT_FOUND", message: "Garage indisponible." });
  return site;
}

async function bookingVehicle(tx: Tx, token: PortalToken) {
  if (token.scope !== "BOOKING" || token.targetId === token.customerId) return null;
  return tx.vehicle.findFirst({
    where: { id: token.targetId, customerId: token.customerId },
    select: { id: true, plate: true, make: true, model: true },
  });
}

/** Créneaux portail (RG-M03-07) : délai minimum, horizon, 6 par demi-journée, sans nom. */
async function portalSlots(
  tx: Tx,
  token: PortalToken,
  type: AppointmentTypeKey,
  now: Date,
  excludeId?: string,
) {
  const org = await loadOrganization(token.organizationId);
  const config = planningConfigOf(org);
  const site = await siteForToken(tx, token);
  const fromDate = localDateKey(now, org.timezone);
  const days = config.appointments.portalHorizonDays;
  const { from } = dayBounds(fromDate, org.timezone);
  const { to } = dayBounds(addDaysToKey(fromDate, days - 1), org.timezone);
  const planning = await loadPlanning(tx, { org, site, from, to, now });
  if (excludeId) {
    planning.snapshot.appointments = planning.snapshot.appointments.filter(
      (a) => a.id !== excludeId,
    );
  }
  const duration = defaultDuration(type, [], config.appointments.durations);
  const requireBay =
    config.appointments.autoAssignBay &&
    REQUIRED_BAY_TYPES[type] !== null &&
    planning.bays.some((b) => b.isActive && isBayCompatible(type, b.type));
  const groups = availableSlots({
    snapshot: planning.snapshot,
    now,
    type,
    durationMinutes: duration,
    fromDate,
    days,
    stepMinutes: Math.max(30, config.appointments.slotStepMinutes),
    minLeadMinutes: config.appointments.portalMinLeadHours * 60,
    requireBay,
    maxPerHalfDay: 6,
  });
  return { org, config, site, planning, duration, groups };
}

export const portalAppointmentRouter = router({
  /** Page `/p/[token]/rdv` : garage, véhicule pré-identifié, RDV existant éventuel. */
  get: publicProcedure.input(portalTokenInputSchema).query(async ({ input }) => {
    const now = new Date();
    const token = await requireToken(input.token, now);
    const tx = db.forTenant({ organizationId: token.organizationId }) as unknown as Tx;
    const org = await loadOrganization(token.organizationId);
    const config = planningConfigOf(org);
    const site = await siteForToken(tx, token);
    const garage = {
      name: org.name,
      logoUrl: org.logoUrl,
      address: site.address ?? org.address,
      phone: site.phone ?? org.phone,
    };
    if (token.scope === "APPOINTMENT") {
      const appt = await tx.appointment.findFirstOrThrow({
        where: { id: token.targetId },
        include: { vehicle: { select: { plate: true, make: true, model: true } } },
      });
      const status = appt.status as AppointmentStatusKey;
      return {
        kind: "appointment" as const,
        garage,
        timeZone: org.timezone,
        appointment: {
          startsAt: appt.startsAt,
          type: appt.type,
          status: appt.status,
          vehicle: appt.vehicle,
          dateLabel: `${formatDayFr(appt.startsAt, org.timezone)} à ${formatTimeFr(appt.startsAt, org.timezone)}`,
        },
        canConfirm: status === "BOOKED",
        canCancel: status === "BOOKED" || status === "CONFIRMED",
        canReschedule: status === "BOOKED" || status === "CONFIRMED",
        portalTypes: config.appointments.portalTypes,
      };
    }
    return {
      kind: "booking" as const,
      garage,
      timeZone: org.timezone,
      vehicle: await bookingVehicle(tx, token),
      portalTypes: config.appointments.portalEnabled ? config.appointments.portalTypes : [],
      defaultType: (token.reminderId ? "INSPECTION_PREP" : "SERVICE") as AppointmentTypeKey,
    };
  }),

  slots: publicProcedure.input(portalSlotsInputSchema).query(async ({ input }) => {
    const now = new Date();
    const token = await requireToken(input.token, now);
    const tx = db.forTenant({ organizationId: token.organizationId }) as unknown as Tx;
    let type = input.type;
    let excludeId: string | undefined;
    if (token.scope === "APPOINTMENT") {
      const appt = await tx.appointment.findFirstOrThrow({ where: { id: token.targetId } });
      type = appt.type as AppointmentTypeKey;
      excludeId = appt.id;
    }
    const { config, groups } = await portalSlots(tx, token, type ?? "SERVICE", now, excludeId);
    if (token.scope === "BOOKING" && !config.appointments.portalTypes.includes(type ?? "SERVICE")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Ce type de RDV ne se réserve pas en ligne.",
      });
    }
    // Ne renvoie que les heures : jamais de pont ni de nom (US-M03-06).
    return groups.map((g) => ({
      date: g.date,
      halfDay: g.halfDay,
      slots: g.slots.map((s) => s.startsAt),
    }));
  }),

  /** US-M03-06 — réservation depuis un lien (BOOKING). Revérifie la disponibilité en transaction. */
  book: publicProcedure.input(portalBookInputSchema).mutation(async ({ ctx, input }) => {
    const now = new Date();
    rateLimit(ctx.ip, now);
    const token = await requireToken(input.token, now);
    if (token.scope !== "BOOKING") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Ce lien sert à gérer un RDV existant.",
      });
    }
    const tenantDb = db.forTenant({ organizationId: token.organizationId });
    const notifications: Array<AppointmentNotification | null> = [];
    let status: "BOOKED" | "CONFIRMED" = "CONFIRMED";
    try {
      await tenantDb.transaction(async (tx) => {
        const { org, config, site, planning, duration, groups } = await portalSlots(
          tx,
          token,
          input.type,
          now,
        );
        if (
          !config.appointments.portalEnabled ||
          !config.appointments.portalTypes.includes(input.type)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ce type de RDV ne se réserve pas en ligne.",
          });
        }
        const slot = groups
          .flatMap((g) => g.slots)
          .find((s) => s.startsAt.getTime() === input.startsAt.getTime());
        if (!slot) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Ce créneau vient d'être réservé. Choisissez-en un autre.",
          });
        }
        const active = await tx.appointment.count({
          where: {
            customerId: token.customerId,
            source: { in: ["PORTAL", "REMINDER"] },
            status: { in: ["BOOKED", "CONFIRMED"] },
            startsAt: { gt: now },
          },
        });
        if (active >= MAX_ACTIVE_PORTAL_APPOINTMENTS) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Vous avez déjà ${MAX_ACTIVE_PORTAL_APPOINTMENTS} RDV. Appelez-nous au ${site.phone ?? org.phone ?? "garage"}.`,
          });
        }
        const vehicle = await bookingVehicle(tx, token);
        const endsAt = new Date(input.startsAt.getTime() + duration * 60_000);
        assertBookable({
          planning,
          config,
          startsAt: input.startsAt,
          endsAt,
          type: input.type,
          bayId: slot.bayId ?? null,
          mechanicId: null,
          vehicleId: vehicle?.id ?? null,
          force: false,
          canForce: false,
          checkLoad: true,
          vehicleSameDay: await vehicleAppointmentsSameDay(
            tx,
            vehicle?.id ?? null,
            input.startsAt,
            org.timezone,
          ),
        });
        status = config.appointments.portalRequiresApproval ? "BOOKED" : "CONFIRMED";
        const customer = await tx.customer.findFirstOrThrow({ where: { id: token.customerId } });
        const appointment = await tx.appointment.create({
          data: {
            organizationId: token.organizationId,
            siteId: site.id,
            customerId: customer.id,
            vehicleId: vehicle?.id ?? null,
            bayId: slot.bayId ?? null,
            startsAt: input.startsAt,
            endsAt,
            type: input.type,
            status,
            source: token.reminderId ? "REMINDER" : "PORTAL",
            reminderId: token.reminderId,
            complaint: input.comment || null,
            ...(status === "CONFIRMED" ? { confirmedAt: now, confirmedVia: "portal" } : {}),
          },
        });
        if (token.reminderId) {
          await tx.reminder.updateMany({
            where: { id: token.reminderId },
            data: { outcome: "APPOINTMENT_BOOKED", outcomeAt: now },
          });
        }
        const link = await issueAppointmentLink(tx, {
          organizationId: token.organizationId,
          appointmentId: appointment.id,
          customerId: customer.id,
          startsAt: input.startsAt,
          reminderId: token.reminderId,
        });
        await emitDomainEvent(tx as never, token.organizationId, "appointment.created", {
          appointmentId: appointment.id,
          customerId: customer.id,
          vehicleId: appointment.vehicleId,
          startsAt: input.startsAt.toISOString(),
          reminderId: token.reminderId,
          source: appointment.source,
        });
        notifications.push(
          await enqueueAppointmentMessage(tx, {
            organizationId: token.organizationId,
            appointmentId: appointment.id,
            kind: "confirm",
            idempotencySuffix: input.startsAt.toISOString(),
            customer,
            body: confirmationMessage({
              salutation: clientNamespace(customer).salutation,
              garageName: org.name,
              type: input.type,
              startsAt: input.startsAt,
              timeZone: org.timezone,
              vehicle,
              link,
            }),
            timeZone: org.timezone,
            now,
          }),
        );
      });
    } catch (error) {
      rethrow(error);
    }
    await dispatchNotifications(notifications, now);
    return { status };
  }),

  confirm: publicProcedure.input(portalTokenInputSchema).mutation(async ({ input }) => {
    const now = new Date();
    const token = await requireToken(input.token, now);
    if (token.scope !== "APPOINTMENT")
      throw new TRPCError({ code: "BAD_REQUEST", message: "Lien invalide." });
    const tenantDb = db.forTenant({ organizationId: token.organizationId });
    try {
      await tenantDb.transaction(async (tx) => {
        const appt = await tx.appointment.findFirstOrThrow({ where: { id: token.targetId } });
        assertTransition(appt.status as AppointmentStatusKey, "confirm");
        await tx.appointment.update({
          where: { id: appt.id },
          data: { status: "CONFIRMED", confirmedAt: now, confirmedVia: "portal" },
        });
        await emitDomainEvent(tx as never, token.organizationId, "appointment.confirmed", {
          appointmentId: appt.id,
          via: "portal",
        });
      });
    } catch (error) {
      rethrow(error);
    }
    return { ok: true } as const;
  }),

  cancel: publicProcedure.input(portalTokenInputSchema).mutation(async ({ input }) => {
    const now = new Date();
    const token = await requireToken(input.token, now);
    if (token.scope !== "APPOINTMENT")
      throw new TRPCError({ code: "BAD_REQUEST", message: "Lien invalide." });
    const tenantDb = db.forTenant({ organizationId: token.organizationId });
    try {
      await tenantDb.transaction(async (tx) => {
        const appt = await tx.appointment.findFirstOrThrow({ where: { id: token.targetId } });
        assertTransition(appt.status as AppointmentStatusKey, "cancel");
        await tx.appointment.update({
          where: { id: appt.id },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancelledBy: "CUSTOMER",
            cancelReason: "Annulé par le client (portail)",
          },
        });
        await tx.reminder.updateMany({
          where: {
            appointmentId: appt.id,
            type: "APPOINTMENT",
            status: { in: ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] },
          },
          data: { status: "CANCELLED", skippedReason: "Rendez-vous annulé." },
        });
        await emitDomainEvent(tx as never, token.organizationId, "appointment.cancelled", {
          appointmentId: appt.id,
          vehicleId: appt.vehicleId,
          customerId: appt.customerId,
          cancelledBy: "CUSTOMER",
        });
      });
    } catch (error) {
      rethrow(error);
    }
    return { ok: true } as const;
  }),

  reschedule: publicProcedure
    .input(portalRescheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      rateLimit(ctx.ip, now);
      const token = await requireToken(input.token, now);
      if (token.scope !== "APPOINTMENT")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Lien invalide." });
      const tenantDb = db.forTenant({ organizationId: token.organizationId });
      const notifications: Array<AppointmentNotification | null> = [];
      try {
        await tenantDb.transaction(async (tx) => {
          const appt = await tx.appointment.findFirstOrThrow({
            where: { id: token.targetId },
            include: {
              customer: true,
              vehicle: { select: { plate: true, make: true, model: true } },
            },
          });
          assertTransition(appt.status as AppointmentStatusKey, "reschedule");
          const type = appt.type as AppointmentTypeKey;
          const { org, config, planning, groups } = await portalSlots(
            tx,
            token,
            type,
            now,
            appt.id,
          );
          const slot = groups
            .flatMap((g) => g.slots)
            .find((s) => s.startsAt.getTime() === input.startsAt.getTime());
          if (!slot) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Ce créneau vient d'être réservé. Choisissez-en un autre.",
            });
          }
          const duration = Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000);
          const endsAt = new Date(input.startsAt.getTime() + duration * 60_000);
          // Le pont d'origine est conservé s'il est libre, sinon le RDV passe « À affecter ».
          let bayId = appt.bayId;
          try {
            assertBookable({
              planning,
              config,
              startsAt: input.startsAt,
              endsAt,
              type,
              bayId,
              mechanicId: null,
              vehicleId: null,
              excludeId: appt.id,
              force: false,
              canForce: false,
              checkLoad: true,
            });
          } catch {
            bayId = slot.bayId ?? null;
            assertBookable({
              planning,
              config,
              startsAt: input.startsAt,
              endsAt,
              type,
              bayId,
              mechanicId: null,
              vehicleId: null,
              excludeId: appt.id,
              force: false,
              canForce: false,
              checkLoad: true,
            });
          }
          await tx.appointment.update({
            where: { id: appt.id },
            data: { startsAt: input.startsAt, endsAt, bayId },
          });
          await tx.reminder.updateMany({
            where: {
              appointmentId: appt.id,
              type: "APPOINTMENT",
              status: { in: ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] },
            },
            data: { status: "CANCELLED", skippedReason: "Rendez-vous déplacé." },
          });
          await emitDomainEvent(tx as never, token.organizationId, "appointment.updated", {
            appointmentId: appt.id,
            vehicleId: appt.vehicleId,
            customerId: appt.customerId,
            rescheduled: true,
            previousStartsAt: appt.startsAt.toISOString(),
            startsAt: input.startsAt.toISOString(),
            via: "portal",
          });
          notifications.push(
            await enqueueAppointmentMessage(tx, {
              organizationId: token.organizationId,
              appointmentId: appt.id,
              kind: "moved",
              idempotencySuffix: input.startsAt.toISOString(),
              customer: appt.customer,
              body: rescheduledMessage({
                salutation: clientNamespace(appt.customer).salutation,
                garageName: org.name,
                type,
                startsAt: input.startsAt,
                timeZone: org.timezone,
                vehicle: appt.vehicle,
              }),
              timeZone: org.timezone,
              now,
            }),
          );
        });
      } catch (error) {
        rethrow(error);
      }
      await dispatchNotifications(notifications, now);
      return { ok: true } as const;
    }),
});

export const portalRouter = router({
  appointment: portalAppointmentRouter,
});
