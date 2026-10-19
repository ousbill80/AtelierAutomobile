import {
  availableSlots,
  DomainError,
  nextCivilDay,
  startOfCivilDay,
  systemClock,
  type AppointmentType,
  type Clock,
  type HalfDaySlots,
} from "@atelieros/core";
import { db, type PortalToken } from "@atelieros/db";
import {
  cancelAppointment,
  confirmAppointment,
  createAppointment,
  getAppointment,
  updateAppointment,
  vehicleLabel,
  type Actor,
  type AppointmentRecord,
} from "./appointments";
import { loadPlanningContext, loadRangeData, type PlanningContext } from "./context";
import { resolvePortalToken } from "./portal-links";

/** Limitation de débit en mémoire (M03 §8 : 10 réservations/heure/IP, 3/jour/téléphone). */
const buckets = new Map<string, number[]>();
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: Date = new Date(),
): boolean {
  const timestamps = (buckets.get(key) ?? []).filter((t) => now.getTime() - t < windowMs);
  if (timestamps.length >= limit) {
    buckets.set(key, timestamps);
    return false;
  }
  timestamps.push(now.getTime());
  buckets.set(key, timestamps);
  return true;
}
export function resetRateLimits(): void {
  buckets.clear();
}

export const PORTAL_MAX_FUTURE_APPOINTMENTS = 3;

export interface PortalBookingContext {
  token: PortalToken;
  planning: PlanningContext;
  customer: { id: string; displayName: string; phone: string | null };
  vehicle: {
    id: string;
    make: string;
    model: string;
    plate: string;
    inspectionExpiryDate: Date | null;
    nextServiceDueDate: Date | null;
  } | null;
  siteId: string;
  appointment: AppointmentRecord | null;
}

function tokenError(reason: "NOT_FOUND" | "EXPIRED" | "REVOKED"): DomainError {
  const messages = {
    NOT_FOUND: "Ce lien n'est pas valide.",
    EXPIRED: "Ce lien a expiré.",
    REVOKED: "Ce lien n'est plus actif.",
  } as const;
  return new DomainError(`portal.token_${reason.toLowerCase()}`, messages[reason], { reason });
}

/** Résout le jeton et charge le contexte (client, véhicule, site, RDV ciblé) selon sa portée. */
export async function loadPortalBookingContext(
  tokenClear: string,
  clock: Clock = systemClock,
): Promise<PortalBookingContext> {
  const resolved = await resolvePortalToken(tokenClear, clock.now());
  if (!resolved.ok) throw tokenError(resolved.reason);
  const token = resolved.token;
  if (token.scope !== "BOOKING" && token.scope !== "APPOINTMENT") {
    throw tokenError("NOT_FOUND");
  }
  const tenantDb = db.forTenant({ organizationId: token.organizationId });
  const customer = await tenantDb.customer.findFirst({
    where: { id: token.customerId, deletedAt: null },
    select: { id: true, displayName: true, phone: true },
  });
  if (!customer) throw tokenError("REVOKED");

  let appointment: AppointmentRecord | null = null;
  let vehicleId: string | null = null;
  let siteId: string | null = null;
  if (token.scope === "APPOINTMENT") {
    appointment = await getAppointment(token.organizationId, token.targetId);
    vehicleId = appointment.vehicleId;
    siteId = appointment.siteId;
  } else {
    vehicleId = token.targetId !== customer.id ? token.targetId : null;
  }
  const vehicle = vehicleId
    ? await tenantDb.vehicle.findFirst({
        where: { id: vehicleId, customerId: customer.id, deletedAt: null },
        select: {
          id: true,
          make: true,
          model: true,
          plate: true,
          inspectionExpiryDate: true,
          nextServiceDueDate: true,
        },
      })
    : null;
  if (!siteId) {
    // Site par défaut de la réservation : dernier RDV du client, sinon premier site actif.
    const last = await tenantDb.appointment.findFirst({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      select: { siteId: true },
    });
    siteId =
      last?.siteId ??
      (
        await tenantDb.site.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        })
      )?.id ??
      null;
  }
  if (!siteId) throw new DomainError("portal.no_site", "Le garage n'a pas de site actif.");
  const planning = await loadPlanningContext(token.organizationId, siteId);
  if (!planning.appointmentSettings.portalEnabled) {
    throw new DomainError(
      "portal.disabled",
      "Le garage n'a pas activé la prise de rendez-vous en ligne.",
    );
  }
  return { token, planning, customer, vehicle, siteId, appointment };
}

/** RG-M03-07 / RG-M14-19 — créneaux exposés au portail (max 6 par demi-journée, 14 jours, délai 2 h). */
export async function portalSlots(
  context: PortalBookingContext,
  type: AppointmentType | undefined,
  clock: Clock = systemClock,
): Promise<{ type: AppointmentType; durationMinutes: number; days: HalfDaySlots[] }> {
  const { planning } = context;
  const settings = planning.appointmentSettings;
  const resolvedType = type ?? context.appointment?.type ?? settings.portalTypes[0] ?? "SERVICE";
  if (!settings.portalTypes.includes(resolvedType)) {
    throw new DomainError(
      "portal.type_not_allowed",
      "Ce type de rendez-vous n'est pas proposé en ligne.",
    );
  }
  const now = clock.now();
  const tz = planning.organization.timeZone;
  const from = startOfCivilDay(now, tz);
  let to = from;
  for (let i = 0; i < settings.portalHorizonDays; i++) to = nextCivilDay(to, tz);
  const data = await loadRangeData(planning.organization.id, context.siteId, from, to);
  const durationMinutes = settings.durations[resolvedType];
  const days = availableSlots({
    from,
    now,
    days: settings.portalHorizonDays,
    timeZone: tz,
    openingHours: planning.site.openingHours,
    holidays: planning.holidays,
    siteId: context.siteId,
    lunchBreak: planning.planningSettings.lunchBreak,
    type: resolvedType,
    durationMinutes,
    stepMinutes: 30,
    minLeadMinutes: settings.portalMinLeadHours * 60,
    bays: planning.bays,
    appointments: data.appointments.filter((a) => a.id !== context.appointment?.id),
    blocks: data.blocks,
    occupyingOrders: data.occupyingOrders,
    requireBay: settings.autoAssignBay,
    mechanicIds: planning.mechanics.map((m) => m.membershipId),
    productivityRate: planning.planningSettings.productivityRate,
    maxAppointmentsPerHalfDay: settings.maxAppointmentsPerHalfDay,
    maxPerHalfDay: 6,
  });
  return { type: resolvedType, durationMinutes, days };
}

function portalActor(organizationId: string): Actor {
  return { organizationId, membershipId: null, userId: null, canForce: false };
}

export interface PortalBookInput {
  type?: AppointmentType;
  startsAt: Date;
  comment?: string;
  ip: string;
}

/** US-M03-06 — réservation depuis le lien : revérifie la disponibilité en transaction (contrainte d'exclusion). */
export async function portalBook(
  context: PortalBookingContext,
  input: PortalBookInput,
  clock: Clock = systemClock,
) {
  const { planning, token } = context;
  const settings = planning.appointmentSettings;
  const type = input.type ?? settings.portalTypes[0] ?? "SERVICE";
  if (!settings.portalTypes.includes(type)) {
    throw new DomainError(
      "portal.type_not_allowed",
      "Ce type de rendez-vous n'est pas proposé en ligne.",
    );
  }
  const now = clock.now();
  if (!checkRateLimit(`ip:${input.ip}`, 10, 3_600_000, now)) {
    throw new DomainError(
      "portal.rate_limited",
      "Trop de réservations depuis cette connexion. Réessayez plus tard.",
    );
  }
  const phoneKey = context.customer.phone ?? context.customer.id;
  if (!checkRateLimit(`phone:${phoneKey}`, 3, 86_400_000, now)) {
    throw new DomainError(
      "portal.rate_limited",
      "Trop de réservations aujourd'hui pour ce numéro. Appelez le garage.",
    );
  }
  const tenantDb = db.forTenant({ organizationId: token.organizationId });
  const futureCount = await tenantDb.appointment.count({
    where: {
      customerId: context.customer.id,
      source: "PORTAL",
      status: { in: ["BOOKED", "CONFIRMED"] },
      startsAt: { gt: now },
    },
  });
  if (futureCount >= PORTAL_MAX_FUTURE_APPOINTMENTS) {
    const phone = planning.site.phone ?? planning.site.whatsappNumber ?? "";
    throw new DomainError(
      "portal.too_many_future",
      `Vous avez déjà ${futureCount} RDV. Appelez-nous${phone ? ` au ${phone}` : ""}.`,
    );
  }
  if (input.startsAt.getTime() < now.getTime() + settings.portalMinLeadHours * 3_600_000) {
    throw new DomainError("portal.too_soon", "Ce créneau est trop proche. Choisissez-en un autre.");
  }
  // Le créneau demandé doit encore faire partie des créneaux proposés (revalidation, RG-M03-07) ;
  // pont auto-affecté si l'organisation le demande (RG-M03-03), sinon « À affecter ».
  const { days } = await portalSlots(context, type, clock);
  const match = days
    .flatMap((d) => d.slots)
    .find((s) => s.startsAt.getTime() === input.startsAt.getTime());
  if (!match) {
    throw new DomainError(
      "portal.slot_taken",
      "Ce créneau vient d'être réservé. Choisissez-en un autre.",
    );
  }
  const bayId = settings.autoAssignBay ? match.bayId : null;
  try {
    const result = await createAppointment(
      portalActor(token.organizationId),
      {
        siteId: context.siteId,
        customerId: context.customer.id,
        vehicleId: context.vehicle?.id ?? null,
        type,
        startsAt: input.startsAt,
        bayId,
        source: token.reminderId ? "REMINDER" : "PORTAL",
        reminderId: token.reminderId,
        complaint: input.comment ?? null,
        notifyCustomer: true,
        force: false,
        initialStatus: settings.portalRequiresApproval ? "BOOKED" : "CONFIRMED",
        confirmedVia: "portal",
      },
      clock,
    );
    return result;
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === "SLOT_CONFLICT" || error.code === "CAPACITY_EXCEEDED")
    ) {
      throw new DomainError(
        "portal.slot_taken",
        "Ce créneau vient d'être réservé. Choisissez-en un autre.",
        { code: error.code },
      );
    }
    throw error;
  }
}

export async function portalConfirm(context: PortalBookingContext, clock: Clock = systemClock) {
  if (!context.appointment) throw tokenError("NOT_FOUND");
  if (context.appointment.status === "CONFIRMED") return context.appointment;
  return confirmAppointment(
    portalActor(context.token.organizationId),
    { id: context.appointment.id, via: "portal" },
    clock,
  );
}

export async function portalCancel(context: PortalBookingContext, clock: Clock = systemClock) {
  if (!context.appointment) throw tokenError("NOT_FOUND");
  const result = await cancelAppointment(
    portalActor(context.token.organizationId),
    { id: context.appointment.id, cancelledBy: "CUSTOMER", notifyCustomer: false },
    clock,
  );
  return result.appointment;
}

export async function portalReschedule(
  context: PortalBookingContext,
  input: { startsAt: Date; ip: string },
  clock: Clock = systemClock,
) {
  if (!context.appointment) throw tokenError("NOT_FOUND");
  const now = clock.now();
  if (!checkRateLimit(`ip:${input.ip}`, 10, 3_600_000, now)) {
    throw new DomainError(
      "portal.rate_limited",
      "Trop de demandes depuis cette connexion. Réessayez plus tard.",
    );
  }
  try {
    const result = await updateAppointment(
      portalActor(context.token.organizationId),
      {
        id: context.appointment.id,
        startsAt: input.startsAt,
        bayId: null,
        notifyCustomer: true,
        force: false,
      },
      clock,
    );
    return result.appointment;
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === "SLOT_CONFLICT" || error.code === "CAPACITY_EXCEEDED")
    ) {
      throw new DomainError(
        "portal.slot_taken",
        "Ce créneau vient d'être réservé. Choisissez-en un autre.",
        { code: error.code },
      );
    }
    throw error;
  }
}

/** DTO public : jamais le nom d'un autre client, téléphone masqué (RG-M14-06). */
export function portalView(context: PortalBookingContext) {
  const { planning } = context;
  return {
    scope: context.token.scope,
    garage: {
      name: planning.organization.name,
      siteName: planning.site.name,
      address: planning.site.address,
      phone: planning.site.phone,
      whatsapp: planning.site.whatsappNumber,
      timeZone: planning.organization.timeZone,
    },
    customer: { displayName: context.customer.displayName },
    vehicle: context.vehicle
      ? {
          label: vehicleLabel(context.vehicle),
          inspectionExpiryDate: context.vehicle.inspectionExpiryDate,
          nextServiceDueDate: context.vehicle.nextServiceDueDate,
        }
      : null,
    portalTypes: planning.appointmentSettings.portalTypes,
    requiresApproval: planning.appointmentSettings.portalRequiresApproval,
    appointment: context.appointment
      ? {
          id: context.appointment.id,
          startsAt: context.appointment.startsAt,
          endsAt: context.appointment.endsAt,
          type: context.appointment.type,
          status: context.appointment.status,
        }
      : null,
  };
}
