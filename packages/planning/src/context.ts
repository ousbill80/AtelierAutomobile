import {
  canAcceptAppointment,
  computeCapacity,
  detectConflicts,
  DomainError,
  formatAppointmentDay,
  formatAppointmentTime,
  formatHoursMinutes,
  halfDayOf,
  halfDayWindows,
  isWithinOpeningHours,
  resolveAppointmentSettings,
  resolvePlanningSettings,
  type AppointmentLike,
  type AppointmentSettings,
  type AppointmentType,
  type BayLike,
  type BlockLike,
  type Conflict,
  type HolidayLike,
  type OccupyingOrderLike,
  type OpeningHours,
  type PlanningSettings,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";

/** Statuts d'OR qui occupent physiquement un pont (RG-M03-02). */
export const OCCUPYING_ORDER_STATUSES = ["IN_PROGRESS", "WAITING_PARTS"] as const;

export interface PlanningMechanic {
  membershipId: string;
  name: string;
  skills: string[];
  role: string;
}

export interface PlanningContext {
  organization: {
    id: string;
    name: string;
    timeZone: string;
    operatingMode: string;
    settings: unknown;
  };
  site: {
    id: string;
    name: string;
    code: string;
    openingHours: OpeningHours;
    whatsappNumber: string | null;
    phone: string | null;
    address: string | null;
  };
  bays: Array<BayLike & { name: string; sortOrder: number; color: string | null }>;
  holidays: HolidayLike[];
  mechanics: PlanningMechanic[];
  appointmentSettings: AppointmentSettings;
  planningSettings: PlanningSettings;
}

/** Charge tout ce dont `core/planning` a besoin pour un site : horaires, ponts, fériés, mécaniciens, réglages. */
export async function loadPlanningContext(
  organizationId: string,
  siteId: string,
): Promise<PlanningContext> {
  const tenantDb = db.forTenant({ organizationId });
  const [organization, site, bays, holidays, memberships] = await Promise.all([
    adminDb.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true, timezone: true, operatingMode: true, settings: true },
    }),
    tenantDb.site.findFirst({ where: { id: siteId, isActive: true } }),
    tenantDb.bay.findMany({
      where: { siteId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    tenantDb.holiday.findMany({ where: { OR: [{ siteId: null }, { siteId }] } }),
    tenantDb.membership.findMany({
      where: { isActive: true, role: { in: ["MECHANIC", "MANAGER"] } },
      include: { user: { select: { name: true } } },
    }),
  ]);
  if (!site) {
    throw new DomainError("planning.site_not_found", "Site introuvable ou désactivé.", { siteId });
  }
  // RG-M03-06 : MECHANIC rattaché au site, ou MANAGER avec une compétence atelier.
  const mechanics = memberships
    .filter((m) => m.siteIds.length === 0 || m.siteIds.includes(siteId))
    .filter((m) => m.role === "MECHANIC" || m.skills.length > 0)
    .map((m) => ({ membershipId: m.id, name: m.user.name, skills: m.skills, role: m.role }));

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      timeZone: organization.timezone,
      operatingMode: organization.operatingMode,
      settings: organization.settings,
    },
    site: {
      id: site.id,
      name: site.name,
      code: site.code,
      openingHours: (site.openingHours ?? {}) as OpeningHours,
      whatsappNumber: site.whatsappNumber,
      phone: site.phone,
      address: site.address,
    },
    bays: bays.map((b) => ({
      id: b.id,
      type: b.type,
      isActive: b.isActive,
      name: b.name,
      sortOrder: b.sortOrder,
      color: b.color,
    })),
    holidays: holidays.map((h) => ({ date: h.date, siteId: h.siteId })),
    mechanics,
    appointmentSettings: resolveAppointmentSettings(organization.settings),
    planningSettings: resolvePlanningSettings(organization.settings),
  };
}

export interface RangeData {
  appointments: Array<AppointmentLike & { customerName: string }>;
  blocks: BlockLike[];
  occupyingOrders: OccupyingOrderLike[];
}

/** RDV, blocages et OR occupants d'un site sur une plage (bornes larges : tout ce qui chevauche). */
export async function loadRangeData(
  organizationId: string,
  siteId: string,
  from: Date,
  to: Date,
): Promise<RangeData> {
  const tenantDb = db.forTenant({ organizationId });
  const [appointments, blocks, orders] = await Promise.all([
    tenantDb.appointment.findMany({
      where: { siteId, startsAt: { lt: to }, endsAt: { gt: from } },
      select: {
        id: true,
        bayId: true,
        mechanicId: true,
        vehicleId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        overbooked: true,
        customer: { select: { displayName: true } },
      },
    }),
    tenantDb.resourceBlock.findMany({
      where: { siteId, startsAt: { lt: to }, endsAt: { gt: from } },
    }),
    tenantDb.repairOrder.findMany({
      where: {
        siteId,
        bayId: { not: null },
        status: { in: [...OCCUPYING_ORDER_STATUSES] },
        deletedAt: null,
      },
      select: { id: true, number: true, bayId: true, promisedAt: true },
    }),
  ]);
  return {
    appointments: appointments.map((a) => ({
      id: a.id,
      bayId: a.bayId,
      mechanicId: a.mechanicId,
      vehicleId: a.vehicleId,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      status: a.status,
      overbooked: a.overbooked,
      customerName: a.customer.displayName,
    })),
    blocks: blocks.map((b) => ({
      id: b.id,
      bayId: b.bayId,
      membershipId: b.membershipId,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      reason: b.reason,
    })),
    occupyingOrders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      bayId: o.bayId,
      promisedAt: o.promisedAt,
    })),
  };
}

/** Erreur métier de créneau : code structuré (M03 §8) exposé au client par le formateur tRPC. */
export function slotError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError(code, message, details);
}

export interface AssertSlotInput {
  planning: PlanningContext;
  data: RangeData;
  startsAt: Date;
  endsAt: Date;
  type: AppointmentType;
  bayId: string | null;
  mechanicId: string | null;
  vehicleId: string | null;
  excludeAppointmentId?: string | null;
  /** Forçage demandé par l'utilisateur. */
  force: boolean;
  /** Vrai si l'utilisateur a `planning:manage` (surréservation, hors horaires, capacité). */
  canForce: boolean;
  /** Ignorer le contrôle de capacité (ex. déplacement sans changement d'horaire). */
  skipCapacity?: boolean;
}

export interface SlotAssertion {
  outsideHours: boolean;
  overbooked: boolean;
}

function describeConflict(planning: PlanningContext, conflict: Conflict): string {
  const tz = planning.organization.timeZone;
  const bayName = (id: string | null) => planning.bays.find((b) => b.id === id)?.name ?? "Pont";
  const mechanicName = (id: string | null) =>
    planning.mechanics.find((m) => m.membershipId === id)?.name ?? "Mécanicien";
  switch (conflict.kind) {
    case "BAY_APPOINTMENT": {
      const a = conflict.appointment;
      return `${bayName(a.bayId)} occupé de ${formatAppointmentTime(a.startsAt, tz)} à ${formatAppointmentTime(a.endsAt, tz)}${a.customerName ? ` (${a.customerName})` : ""}.`;
    }
    case "MECHANIC_APPOINTMENT": {
      const a = conflict.appointment;
      return `${mechanicName(a.mechanicId)} a déjà un RDV de ${formatAppointmentTime(a.startsAt, tz)} à ${formatAppointmentTime(a.endsAt, tz)}.`;
    }
    case "BAY_BLOCK":
      return `${bayName(conflict.block.bayId)} indisponible : ${conflict.block.reason}.`;
    case "MECHANIC_BLOCK":
      return `${mechanicName(conflict.block.membershipId)} absent : ${conflict.block.reason}.`;
    case "SITE_BLOCK":
      return `Atelier fermé : ${conflict.block.reason}.`;
    case "BAY_ORDER":
      return `${bayName(conflict.order.bayId)} occupé par l'OR ${conflict.order.number}.`;
  }
}

/**
 * Contrôles serveur d'un créneau (RG-M03-01, 02, 05, 13). Lève une `TRPCError` CONFLICT portant
 * une `DomainError` (code + détails) : OUTSIDE_OPENING_HOURS, SLOT_CONFLICT { conflictingId },
 * CAPACITY_EXCEEDED { load, capacity }, DUPLICATE_SAME_DAY { existingId }.
 */
export function assertSlotAvailable(input: AssertSlotInput): SlotAssertion {
  const { planning, data } = input;
  const tz = planning.organization.timeZone;
  const forced = input.force && input.canForce;
  const result: SlotAssertion = { outsideHours: false, overbooked: false };

  const hours = isWithinOpeningHours({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    openingHours: planning.site.openingHours,
    timeZone: tz,
    holidays: planning.holidays,
    siteId: planning.site.id,
    lunchBreak: planning.planningSettings.lunchBreak,
  });
  if (!hours.ok) {
    if (!forced) {
      const label =
        hours.reason === "HOLIDAY"
          ? "jour férié"
          : hours.reason === "CLOSED_DAY"
            ? "atelier fermé ce jour"
            : "hors des horaires d'ouverture";
      throw slotError(
        "OUTSIDE_OPENING_HOURS",
        `Créneau impossible le ${formatAppointmentDay(input.startsAt, tz)} : ${label}.`,
        { reason: hours.reason },
      );
    }
    result.outsideHours = true;
  }

  const windows = halfDayWindows(planning.site.openingHours, input.startsAt, tz, {
    lunchBreak: planning.planningSettings.lunchBreak,
    holidays: planning.holidays,
    siteId: planning.site.id,
  });
  const dayEnd = windows.length > 0 ? windows[windows.length - 1]!.end : undefined;

  const conflicts = detectConflicts({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    bayId: input.bayId,
    mechanicId: input.mechanicId,
    excludeAppointmentId: input.excludeAppointmentId,
    appointments: data.appointments,
    blocks: data.blocks,
    occupyingOrders: data.occupyingOrders,
    dayEnd,
  });
  if (conflicts.length > 0) {
    const onlyBayAppointments = conflicts.every((c) => c.kind === "BAY_APPOINTMENT");
    if (!(forced && onlyBayAppointments)) {
      const first = conflicts[0]!;
      const conflictingId =
        first.kind === "BAY_APPOINTMENT" || first.kind === "MECHANIC_APPOINTMENT"
          ? first.appointment.id
          : first.kind === "BAY_ORDER"
            ? first.order.id
            : first.block.id;
      throw slotError("SLOT_CONFLICT", describeConflict(planning, first), {
        conflictingId,
        kind: first.kind,
        forcible: onlyBayAppointments,
      });
    }
    result.overbooked = true;
  }

  if (!input.skipCapacity && windows.length > 0 && !result.outsideHours) {
    const window = halfDayOf(windows, input.startsAt);
    if (window) {
      const capacity = computeCapacity({
        window,
        mechanicIds: planning.mechanics.map((m) => m.membershipId),
        blocks: data.blocks,
        productivityRate: planning.planningSettings.productivityRate,
        appointments: data.appointments.filter((a) => a.id !== input.excludeAppointmentId),
        occupyingOrders: data.occupyingOrders,
        maxAppointmentsPerHalfDay: planning.appointmentSettings.maxAppointmentsPerHalfDay,
        activeBayCount: planning.bays.length,
      });
      const durationMinutes = (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000;
      const verdict = canAcceptAppointment(capacity, durationMinutes);
      if (!verdict.ok && !forced) {
        const period = window.halfDay === "AM" ? "matin" : "après-midi";
        const day = formatAppointmentDay(input.startsAt, tz).split(" ")[0];
        const message =
          verdict.reason === "MAX_APPOINTMENTS"
            ? `Atelier complet ${day} ${period} : ${capacity.appointmentsCount} RDV déjà prévus (maximum ${capacity.maxAppointments}).`
            : `Atelier complet ${day} ${period} (${formatHoursMinutes(capacity.loadMinutes + durationMinutes)} / ${formatHoursMinutes(capacity.capacityMinutes)}).`;
        throw slotError("CAPACITY_EXCEEDED", message, {
          load: capacity.loadMinutes,
          capacity: capacity.capacityMinutes,
          appointmentsCount: capacity.appointmentsCount,
          maxAppointments: capacity.maxAppointments,
          reason: verdict.reason,
        });
      }
    }
  }

  // RG-M03-13 — un seul RDV actif par véhicule et par jour (forçable sans permission spéciale).
  if (input.vehicleId && !input.force) {
    const dayStart = windows[0]?.start ?? input.startsAt;
    const sameDay = data.appointments.find(
      (a) =>
        a.id !== input.excludeAppointmentId &&
        a.vehicleId === input.vehicleId &&
        (a.status === "BOOKED" || a.status === "CONFIRMED" || a.status === "ARRIVED") &&
        formatAppointmentDay(a.startsAt, tz) === formatAppointmentDay(dayStart, tz),
    );
    if (sameDay) {
      throw slotError(
        "DUPLICATE_SAME_DAY",
        `Ce véhicule a déjà un RDV le ${formatAppointmentDay(sameDay.startsAt, tz).replace(/^\S+ /, "")} à ${formatAppointmentTime(sameDay.startsAt, tz)}. Voulez-vous le modifier ?`,
        { existingId: sameDay.id, startsAt: sameDay.startsAt.toISOString() },
      );
    }
  }

  return result;
}
