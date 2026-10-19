import {
  attributeReminder,
  batchPlacement,
  canRevertNoShow,
  customerGreeting,
  defaultDuration,
  DomainError,
  halfDayWindows,
  isBayCompatible,
  nextStatus,
  renderAppointmentCancelled,
  renderAppointmentConfirmation,
  renderAppointmentMoved,
  renderAppointmentNoShow,
  renderAppointmentReminder,
  renderGroupConfirmation,
  startOfCivilDay,
  nextCivilDay,
  systemClock,
  type AppointmentAction,
  type AppointmentSource,
  type AppointmentType,
  type Clock,
} from "@atelieros/core";
import { db, writeAuditLog, type Prisma } from "@atelieros/db";
import {
  assertSlotAvailable,
  loadPlanningContext,
  loadRangeData,
  type PlanningContext,
} from "./context";
import { emitDomainEvent } from "./events";
import { sendCustomerMessage, type MessageRecipient } from "./messaging";
import { notifyRoles } from "./notifications";
import { createPortalLink } from "./portal-links";

/** Qui agit : membre connecté, ou système (jobs) avec `membershipId = null`. */
export interface Actor {
  organizationId: string;
  membershipId: string | null;
  userId: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** `planning:manage` : surréservation, hors horaires, capacité, blocages. */
  canForce: boolean;
}

export const APPOINTMENT_INCLUDE = {
  customer: {
    select: {
      id: true,
      displayName: true,
      civility: true,
      lastName: true,
      phone: true,
      phone2: true,
      whatsappPhone: true,
      hasWhatsapp: true,
      email: true,
      preferredChannel: true,
      type: true,
    },
  },
  vehicle: {
    select: {
      id: true,
      plate: true,
      make: true,
      model: true,
      inspectionExpiryDate: true,
      nextServiceDueDate: true,
      nextServiceDueMileage: true,
      currentMileage: true,
    },
  },
  bay: { select: { id: true, name: true, type: true } },
  mechanic: { select: { id: true, user: { select: { name: true } } } },
  advisor: { select: { id: true, user: { select: { name: true } } } },
  reminder: { select: { id: true, type: true, stepKey: true, sentAt: true } },
} satisfies Prisma.AppointmentInclude;

export type AppointmentRecord = Prisma.AppointmentGetPayload<{
  include: typeof APPOINTMENT_INCLUDE;
}>;

export function vehicleLabel(
  vehicle: { make: string; model: string; plate: string } | null,
): string | null {
  return vehicle ? `${vehicle.make} ${vehicle.model} (${vehicle.plate})` : null;
}

function messageContext(appointment: AppointmentRecord, planning: PlanningContext) {
  return {
    customerGreeting: customerGreeting(appointment.customer),
    garageName: planning.organization.name,
    startsAt: appointment.startsAt,
    timeZone: planning.organization.timeZone,
    type: appointment.type,
    vehicleLabel: vehicleLabel(appointment.vehicle),
  };
}

function recipient(customer: AppointmentRecord["customer"]): MessageRecipient {
  return {
    id: customer.id,
    phone: customer.phone,
    phone2: customer.phone2,
    whatsappPhone: customer.whatsappPhone,
    hasWhatsapp: customer.hasWhatsapp,
    email: customer.email,
    preferredChannel: customer.preferredChannel,
  };
}

async function audit(
  actor: Actor,
  action: string,
  appointment: { id: string; siteId: string },
  before: unknown,
  after: unknown,
  reason?: string | null,
) {
  await writeAuditLog({
    organizationId: actor.organizationId,
    userId: actor.userId,
    membershipId: actor.membershipId,
    siteId: appointment.siteId,
    action,
    entity: "Appointment",
    entityId: appointment.id,
    before,
    after,
    reason: reason ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
}

function isExclusionViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("appointment_no_overlap");
}

async function dayRange(planning: PlanningContext, at: Date): Promise<{ from: Date; to: Date }> {
  const from = startOfCivilDay(at, planning.organization.timeZone);
  return { from, to: nextCivilDay(from, planning.organization.timeZone) };
}

export async function getAppointment(
  organizationId: string,
  id: string,
): Promise<AppointmentRecord> {
  const tenantDb = db.forTenant({ organizationId });
  const appointment = await tenantDb.appointment.findFirst({
    where: { id },
    include: APPOINTMENT_INCLUDE,
  });
  if (!appointment) {
    throw new DomainError("appointment.not_found", "Rendez-vous introuvable.", { id });
  }
  return appointment;
}

// ─────────────────────────────── création ───────────────────────────────

export interface CreateAppointmentInput {
  siteId: string;
  customerId: string;
  vehicleId?: string | null;
  type: AppointmentType;
  startsAt: Date;
  durationMinutes?: number;
  bayId?: string | null;
  mechanicId?: string | null;
  advisorId?: string | null;
  complaint?: string | null;
  laborOperationIds?: string[];
  source: AppointmentSource;
  reminderId?: string | null;
  notes?: string | null;
  notifyCustomer: boolean;
  force: boolean;
  /** Portail sans validation du garage : créé directement CONFIRMED (US-M03-06). */
  initialStatus?: "BOOKED" | "CONFIRMED";
  confirmedVia?: string | null;
  groupId?: string | null;
}

export interface CreateAppointmentResult {
  appointment: AppointmentRecord;
  warnings: string[];
  messageId: string | null;
}

export async function createAppointment(
  actor: Actor,
  input: CreateAppointmentInput,
  clock: Clock = systemClock,
): Promise<CreateAppointmentResult> {
  const tenantDb = db.forTenant({ organizationId: actor.organizationId });
  const planning = await loadPlanningContext(actor.organizationId, input.siteId);
  const warnings: string[] = [];

  const customer = await tenantDb.customer.findFirst({
    where: { id: input.customerId, deletedAt: null },
    select: { id: true, displayName: true },
  });
  if (!customer) {
    throw new DomainError("appointment.customer_not_found", "Client introuvable.", {
      customerId: input.customerId,
    });
  }
  if (input.vehicleId) {
    const vehicle = await tenantDb.vehicle.findFirst({
      where: { id: input.vehicleId, customerId: input.customerId, deletedAt: null },
      select: { id: true },
    });
    if (!vehicle) {
      throw new DomainError(
        "appointment.vehicle_not_found",
        "Véhicule introuvable pour ce client.",
        { vehicleId: input.vehicleId },
      );
    }
  }

  const laborOperations =
    input.laborOperationIds && input.laborOperationIds.length > 0
      ? await tenantDb.laborOperation.findMany({
          where: { id: { in: input.laborOperationIds } },
          select: { standardHours: true },
        })
      : [];
  const durationMinutes =
    input.durationMinutes ??
    defaultDuration({
      type: input.type,
      durations: planning.appointmentSettings.durations,
      laborOperations,
    });
  const endsAt = new Date(input.startsAt.getTime() + durationMinutes * 60_000);

  const bayId = input.bayId ?? null;
  if (bayId) {
    const bay = planning.bays.find((b) => b.id === bayId);
    if (!bay) {
      throw new DomainError(
        "appointment.bay_not_found",
        "Pont introuvable ou inactif sur ce site.",
        { bayId },
      );
    }
    if (!isBayCompatible(input.type, bay.type) && !(input.force && actor.canForce)) {
      throw new DomainError(
        "BAY_INCOMPATIBLE",
        `${bay.name} n'est pas adapté à ce type de rendez-vous.`,
        { bayId, bayType: bay.type },
      );
    }
  }
  const mechanicId = input.mechanicId ?? null;
  if (mechanicId) {
    const mechanic = planning.mechanics.find((m) => m.membershipId === mechanicId);
    if (!mechanic) {
      throw new DomainError(
        "appointment.mechanic_not_found",
        "Mécanicien introuvable sur ce site.",
        { mechanicId },
      );
    }
    if (input.type === "BODYWORK" && !mechanic.skills.includes("carrosserie")) {
      warnings.push(`${mechanic.name} n'a pas la compétence carrosserie.`);
    }
  }

  const range = await dayRange(planning, input.startsAt);
  const data = await loadRangeData(actor.organizationId, input.siteId, range.from, range.to);
  const assertion = assertSlotAvailable({
    planning,
    data,
    startsAt: input.startsAt,
    endsAt,
    type: input.type,
    bayId,
    mechanicId,
    vehicleId: input.vehicleId ?? null,
    force: input.force,
    canForce: actor.canForce,
  });

  // RG-M03-12 — attribution à une relance VT/révision envoyée dans les 14 jours.
  const now = clock.now();
  const sentReminders = await tenantDb.reminder.findMany({
    where: {
      customerId: input.customerId,
      status: "SENT",
      sentAt: { gte: new Date(now.getTime() - 14 * 86_400_000) },
    },
    select: { id: true, customerId: true, vehicleId: true, type: true, sentAt: true },
  });
  const reminderId = attributeReminder({
    customerId: input.customerId,
    vehicleId: input.vehicleId ?? null,
    createdAt: now,
    reminderId: input.reminderId ?? null,
    sentReminders,
  });

  const status = input.initialStatus ?? "BOOKED";
  let appointment: AppointmentRecord;
  try {
    appointment = await tenantDb.appointment.create({
      data: {
        organizationId: actor.organizationId,
        siteId: input.siteId,
        customerId: input.customerId,
        vehicleId: input.vehicleId ?? null,
        bayId,
        mechanicId,
        advisorId: input.advisorId ?? actor.membershipId,
        createdById: actor.membershipId,
        startsAt: input.startsAt,
        endsAt,
        type: input.type,
        status,
        source: input.source,
        reminderId,
        complaint: input.complaint ?? null,
        laborOperationIds: input.laborOperationIds ?? [],
        notes: input.notes ?? null,
        overbooked: assertion.overbooked,
        outsideHours: assertion.outsideHours,
        groupId: input.groupId ?? null,
        confirmedAt: status === "CONFIRMED" ? now : null,
        confirmedVia: status === "CONFIRMED" ? (input.confirmedVia ?? "portal") : null,
      },
      include: APPOINTMENT_INCLUDE,
    });
  } catch (error) {
    if (isExclusionViolation(error)) {
      // Deux réceptionnaires ont réservé le même créneau en même temps (M03 §11).
      throw new DomainError(
        "SLOT_CONFLICT",
        "Ce créneau vient d'être pris par un autre utilisateur.",
        { conflictingId: null, concurrent: true },
      );
    }
    throw error;
  }

  await audit(
    actor,
    assertion.overbooked ? "appointment.created_overbooked" : "appointment.created",
    appointment,
    null,
    appointment,
  );
  await emitDomainEvent(actor.organizationId, "appointment.created", {
    appointmentId: appointment.id,
    customerId: appointment.customerId,
    vehicleId: appointment.vehicleId,
    reminderId: appointment.reminderId,
    startsAt: appointment.startsAt.toISOString(),
    type: appointment.type,
    source: appointment.source,
  });
  if (reminderId) {
    await tenantDb.reminder.updateMany({
      where: { id: reminderId, outcome: null },
      data: { outcome: "APPOINTMENT_BOOKED", outcomeAt: now, appointmentId: appointment.id },
    });
  }

  let messageId: string | null = null;
  if (input.notifyCustomer && !input.groupId) {
    const sent = await sendCustomerMessage({
      organizationId: actor.organizationId,
      recipient: recipient(appointment.customer),
      body: renderAppointmentConfirmation(messageContext(appointment, planning)),
      templateKey: "appointment_confirmation",
      idempotencyKey: `appointment:${appointment.id}:confirmation`,
      sentById: actor.membershipId,
    });
    messageId = sent?.messageId ?? null;
    if (!sent) {
      warnings.push("Client sans WhatsApp ni mobile : confirmation à obtenir par téléphone.");
    }
  }

  return { appointment, warnings, messageId };
}

// ─────────────────────────────── modification ───────────────────────────────

export interface UpdateAppointmentInput {
  id: string;
  startsAt?: Date;
  durationMinutes?: number;
  bayId?: string | null;
  mechanicId?: string | null;
  advisorId?: string | null;
  type?: AppointmentType;
  vehicleId?: string | null;
  complaint?: string | null;
  laborOperationIds?: string[];
  notes?: string | null;
  notifyCustomer: boolean;
  force: boolean;
}

export async function updateAppointment(
  actor: Actor,
  input: UpdateAppointmentInput,
  clock: Clock = systemClock,
): Promise<{ appointment: AppointmentRecord; rescheduled: boolean; messageId: string | null }> {
  const tenantDb = db.forTenant({ organizationId: actor.organizationId });
  const before = await getAppointment(actor.organizationId, input.id);
  const planning = await loadPlanningContext(actor.organizationId, before.siteId);

  const schedulingChange =
    input.startsAt !== undefined ||
    input.durationMinutes !== undefined ||
    input.bayId !== undefined ||
    input.mechanicId !== undefined ||
    input.type !== undefined;

  if (schedulingChange) {
    nextStatus(before.status, "reschedule");
  } else if (before.status === "COMPLETED" || before.status === "CANCELLED") {
    // Statuts terminaux : seules les notes restent éditables (M03 §5).
    if (
      input.complaint !== undefined ||
      input.laborOperationIds !== undefined ||
      input.vehicleId !== undefined ||
      input.advisorId !== undefined
    ) {
      throw new DomainError(
        "appointment.terminal",
        "Ce rendez-vous est terminé ou annulé : seules les notes sont modifiables.",
      );
    }
  }

  const type = input.type ?? before.type;
  const startsAt = input.startsAt ?? before.startsAt;
  const previousDuration = (before.endsAt.getTime() - before.startsAt.getTime()) / 60_000;
  const durationMinutes = input.durationMinutes ?? previousDuration;
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const bayId = input.bayId !== undefined ? input.bayId : before.bayId;
  const mechanicId = input.mechanicId !== undefined ? input.mechanicId : before.mechanicId;
  const vehicleId = input.vehicleId !== undefined ? input.vehicleId : before.vehicleId;

  if (vehicleId && vehicleId !== before.vehicleId) {
    const vehicle = await tenantDb.vehicle.findFirst({
      where: { id: vehicleId, customerId: before.customerId, deletedAt: null },
      select: { id: true },
    });
    if (!vehicle) {
      throw new DomainError(
        "appointment.vehicle_not_found",
        "Véhicule introuvable pour ce client.",
        { vehicleId },
      );
    }
  }

  let assertion = { overbooked: before.overbooked, outsideHours: before.outsideHours };
  if (schedulingChange) {
    if (bayId) {
      const bay = planning.bays.find((b) => b.id === bayId);
      if (!bay) {
        throw new DomainError(
          "appointment.bay_not_found",
          "Pont introuvable ou inactif sur ce site.",
          { bayId },
        );
      }
      if (!isBayCompatible(type, bay.type) && !(input.force && actor.canForce)) {
        throw new DomainError(
          "BAY_INCOMPATIBLE",
          `${bay.name} n'est pas adapté à ce type de rendez-vous.`,
          { bayId, bayType: bay.type },
        );
      }
    }
    if (mechanicId && !planning.mechanics.some((m) => m.membershipId === mechanicId)) {
      throw new DomainError(
        "appointment.mechanic_not_found",
        "Mécanicien introuvable sur ce site.",
        { mechanicId },
      );
    }
    const range = await dayRange(planning, startsAt);
    const data = await loadRangeData(actor.organizationId, before.siteId, range.from, range.to);
    const timeChanged =
      startsAt.getTime() !== before.startsAt.getTime() ||
      endsAt.getTime() !== before.endsAt.getTime();
    assertion = assertSlotAvailable({
      planning,
      data,
      startsAt,
      endsAt,
      type,
      bayId,
      mechanicId,
      vehicleId,
      excludeAppointmentId: before.id,
      force: input.force,
      canForce: actor.canForce,
      skipCapacity: !timeChanged,
    });
  }

  let appointment: AppointmentRecord;
  try {
    appointment = await tenantDb.appointment.update({
      where: { id: before.id },
      data: {
        startsAt,
        endsAt,
        bayId,
        mechanicId,
        type,
        vehicleId,
        advisorId: input.advisorId !== undefined ? input.advisorId : before.advisorId,
        complaint: input.complaint !== undefined ? input.complaint : before.complaint,
        laborOperationIds: input.laborOperationIds ?? before.laborOperationIds,
        notes: input.notes !== undefined ? input.notes : before.notes,
        overbooked: assertion.overbooked,
        outsideHours: assertion.outsideHours,
      },
      include: APPOINTMENT_INCLUDE,
    });
  } catch (error) {
    if (isExclusionViolation(error)) {
      throw new DomainError(
        "SLOT_CONFLICT",
        "Ce créneau vient d'être pris par un autre utilisateur.",
        { conflictingId: null, concurrent: true },
      );
    }
    throw error;
  }

  const rescheduled =
    schedulingChange && appointment.startsAt.getTime() !== before.startsAt.getTime();
  await audit(actor, "appointment.updated", appointment, before, appointment);
  await emitDomainEvent(actor.organizationId, "appointment.updated", {
    appointmentId: appointment.id,
    rescheduled,
    previousStartsAt: before.startsAt.toISOString(),
    startsAt: appointment.startsAt.toISOString(),
    bayId: appointment.bayId,
  });

  let messageId: string | null = null;
  if (rescheduled && input.notifyCustomer) {
    const sent = await sendCustomerMessage({
      organizationId: actor.organizationId,
      recipient: recipient(appointment.customer),
      body: renderAppointmentMoved(messageContext(appointment, planning)),
      templateKey: "appointment_moved",
      idempotencyKey: `appointment:${appointment.id}:moved:${appointment.startsAt.toISOString()}`,
      sentById: actor.membershipId,
    });
    messageId = sent?.messageId ?? null;
  }
  void clock;
  return { appointment, rescheduled, messageId };
}

// ─────────────────────────────── transitions ───────────────────────────────

async function transition(
  actor: Actor,
  id: string,
  action: AppointmentAction,
  data: Prisma.AppointmentUpdateInput,
  auditAction: string,
  reason?: string | null,
): Promise<{ before: AppointmentRecord; appointment: AppointmentRecord }> {
  const tenantDb = db.forTenant({ organizationId: actor.organizationId });
  const before = await getAppointment(actor.organizationId, id);
  const status = nextStatus(before.status, action);
  const appointment = await tenantDb.appointment.update({
    where: { id },
    data: { ...data, status },
    include: APPOINTMENT_INCLUDE,
  });
  await audit(actor, auditAction, appointment, before, appointment, reason);
  return { before, appointment };
}

export async function confirmAppointment(
  actor: Actor,
  input: { id: string; via: string },
  clock: Clock = systemClock,
): Promise<AppointmentRecord> {
  const { appointment } = await transition(
    actor,
    input.id,
    "confirm",
    { confirmedAt: clock.now(), confirmedVia: input.via },
    "appointment.confirmed",
  );
  await emitDomainEvent(actor.organizationId, "appointment.confirmed", {
    appointmentId: appointment.id,
    via: input.via,
  });
  return appointment;
}

export async function markArrived(
  actor: Actor,
  input: { id: string },
  clock: Clock = systemClock,
): Promise<{ appointment: AppointmentRecord; receptionUrl: string | null }> {
  const { appointment } = await transition(
    actor,
    input.id,
    "arrive",
    { arrivedAt: clock.now() },
    "appointment.arrived",
  );
  await emitDomainEvent(actor.organizationId, "appointment.arrived", {
    appointmentId: appointment.id,
    customerId: appointment.customerId,
    vehicleId: appointment.vehicleId,
  });
  const planning = await loadPlanningContext(actor.organizationId, appointment.siteId);
  // M04 (réception) n'est pas encore construit : l'URL cible est celle prévue par l'architecture ;
  // en mode REMINDERS_ONLY, l'OR est fait dans l'ancien logiciel (M03 §11) → pas de réception.
  const receptionUrl =
    planning.organization.operatingMode === "REMINDERS_ONLY"
      ? null
      : `/ordres/nouveau?appointmentId=${appointment.id}`;
  return { appointment, receptionUrl };
}

export async function revertNoShow(
  actor: Actor,
  input: { id: string; reason: string },
  clock: Clock = systemClock,
): Promise<AppointmentRecord> {
  const current = await getAppointment(actor.organizationId, input.id);
  if (!canRevertNoShow({ noShowAt: current.noShowAt, now: clock.now() })) {
    throw new DomainError(
      "appointment.no_show_revert_expired",
      "Une absence ne peut être corrigée que dans les 48 heures.",
    );
  }
  const { appointment } = await transition(
    actor,
    input.id,
    "revert_no_show",
    { arrivedAt: clock.now(), noShowAt: null },
    "appointment.no_show_reverted",
    input.reason,
  );
  await emitDomainEvent(actor.organizationId, "appointment.arrived", {
    appointmentId: appointment.id,
    reverted: true,
  });
  return appointment;
}

export async function completeAppointment(
  actor: Actor,
  input: { id: string; reason: string },
): Promise<AppointmentRecord> {
  const { appointment } = await transition(
    actor,
    input.id,
    "complete",
    {},
    "appointment.completed",
    input.reason,
  );
  await emitDomainEvent(actor.organizationId, "appointment.completed", {
    appointmentId: appointment.id,
    withoutOrder: true,
  });
  return appointment;
}

export interface CancelAppointmentInput {
  id: string;
  cancelledBy: "CUSTOMER" | "GARAGE";
  reason?: string | null;
  notifyCustomer: boolean;
}

export async function cancelAppointment(
  actor: Actor,
  input: CancelAppointmentInput,
  clock: Clock = systemClock,
): Promise<{
  appointment: AppointmentRecord;
  messageId: string | null;
  lateCancellation: boolean;
}> {
  if (input.cancelledBy === "GARAGE" && !input.reason) {
    throw new DomainError(
      "appointment.cancel_reason_required",
      "Indiquez le motif de l'annulation.",
    );
  }
  const now = clock.now();
  const { before, appointment } = await transition(
    actor,
    input.id,
    "cancel",
    { cancelledAt: now, cancelledBy: input.cancelledBy, cancelReason: input.reason ?? null },
    "appointment.cancelled",
    input.reason,
  );
  // RG-M03-11 — annulation client moins de 2 h avant : « annulation tardive » (statistique).
  const lateCancellation =
    input.cancelledBy === "CUSTOMER" && before.startsAt.getTime() - now.getTime() < 2 * 3_600_000;
  await emitDomainEvent(actor.organizationId, "appointment.cancelled", {
    appointmentId: appointment.id,
    cancelledBy: input.cancelledBy,
    reason: input.reason ?? null,
    lateCancellation,
    reminderId: appointment.reminderId,
  });

  let messageId: string | null = null;
  const planning = await loadPlanningContext(actor.organizationId, appointment.siteId);
  if (input.cancelledBy === "GARAGE" && input.notifyCustomer) {
    const link = await createPortalLink({
      organizationId: actor.organizationId,
      scope: "BOOKING",
      targetId: appointment.vehicleId ?? appointment.customerId,
      customerId: appointment.customerId,
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      createdById: actor.membershipId,
    });
    const sent = await sendCustomerMessage({
      organizationId: actor.organizationId,
      recipient: recipient(appointment.customer),
      body: renderAppointmentCancelled({
        ...messageContext(appointment, planning),
        rebookUrl: link.url,
      }),
      templateKey: "appointment_cancelled",
      idempotencyKey: `appointment:${appointment.id}:cancelled`,
      sentById: actor.membershipId,
    });
    messageId = sent?.messageId ?? null;
  }
  if (input.cancelledBy === "CUSTOMER") {
    await notifyRoles({
      organizationId: actor.organizationId,
      roles: ["ADVISOR", "MANAGER"],
      siteId: appointment.siteId,
      type: "appointment.cancelled_by_customer",
      title: `RDV annulé par ${appointment.customer.displayName}`,
      body: `${vehicleLabel(appointment.vehicle) ?? "Véhicule non précisé"} — ${appointment.startsAt.toISOString()}`,
      link: `/rendez-vous?appointment=${appointment.id}`,
    });
  }
  return { appointment, messageId, lateCancellation };
}

export async function markNoShow(
  actor: Actor,
  input: { id: string; automatic?: boolean },
  clock: Clock = systemClock,
): Promise<AppointmentRecord> {
  const now = clock.now();
  const { appointment } = await transition(
    actor,
    input.id,
    "no_show",
    { noShowAt: now },
    input.automatic ? "appointment.no_show_auto" : "appointment.no_show",
  );
  await emitDomainEvent(actor.organizationId, "appointment.no_show", {
    appointmentId: appointment.id,
    customerId: appointment.customerId,
    vehicleId: appointment.vehicleId,
    reminderId: appointment.reminderId,
  });
  // US-M03-09 — message de reprogrammation proposé (validation manuelle par défaut) : notification.
  await notifyRoles({
    organizationId: actor.organizationId,
    roles: ["ADVISOR", "MANAGER"],
    siteId: appointment.siteId,
    type: "appointment.no_show",
    title: `Absent : ${appointment.customer.displayName}`,
    body: "Proposer une reprogrammation depuis la fiche du rendez-vous.",
    link: `/rendez-vous?appointment=${appointment.id}`,
  });
  return appointment;
}

/** US-M03-09 — envoi (validé par l'humain) du message de reprogrammation après absence. */
export async function sendNoShowMessage(
  actor: Actor,
  input: { id: string },
  clock: Clock = systemClock,
): Promise<{ messageId: string | null }> {
  const appointment = await getAppointment(actor.organizationId, input.id);
  if (appointment.status !== "NO_SHOW") {
    throw new DomainError("appointment.not_no_show", "Ce rendez-vous n'est pas marqué absent.");
  }
  const planning = await loadPlanningContext(actor.organizationId, appointment.siteId);
  const link = await createPortalLink({
    organizationId: actor.organizationId,
    scope: "BOOKING",
    targetId: appointment.vehicleId ?? appointment.customerId,
    customerId: appointment.customerId,
    expiresAt: new Date(clock.now().getTime() + 30 * 86_400_000),
    createdById: actor.membershipId,
  });
  const sent = await sendCustomerMessage({
    organizationId: actor.organizationId,
    recipient: recipient(appointment.customer),
    body: renderAppointmentNoShow({
      ...messageContext(appointment, planning),
      rebookUrl: link.url,
    }),
    templateKey: "appointment_no_show",
    idempotencyKey: `appointment:${appointment.id}:no_show`,
    sentById: actor.membershipId,
  });
  return { messageId: sent?.messageId ?? null };
}

/** « Envoyer un rappel maintenant » — rappel J-1 immédiat, avec lien de confirmation portail. */
export async function sendReminderNow(
  actor: Actor,
  input: { id: string },
  clock: Clock = systemClock,
): Promise<{ messageId: string | null }> {
  const appointment = await getAppointment(actor.organizationId, input.id);
  if (appointment.status !== "BOOKED" && appointment.status !== "CONFIRMED") {
    throw new DomainError(
      "appointment.not_pending",
      "Seul un rendez-vous réservé ou confirmé peut être rappelé.",
    );
  }
  const planning = await loadPlanningContext(actor.organizationId, appointment.siteId);
  const link = await ensureAppointmentLink(actor, appointment, clock);
  const body = `${renderAppointmentReminder(messageContext(appointment, planning))} ${link.url}`;
  const sent = await sendCustomerMessage({
    organizationId: actor.organizationId,
    recipient: recipient(appointment.customer),
    body,
    templateKey: "appointment_j1",
    idempotencyKey: `appointment:${appointment.id}:reminder:${clock.now().toISOString().slice(0, 13)}`,
    sentById: actor.membershipId,
  });
  return { messageId: sent?.messageId ?? null };
}

/** Lien portail de portée APPOINTMENT (confirmer / déplacer / annuler), expirant à startsAt + 1 j (RG-M14-03). */
export async function ensureAppointmentLink(
  actor: Actor,
  appointment: AppointmentRecord,
  clock: Clock = systemClock,
): Promise<{ url: string; token: string }> {
  const tenantDb = db.forTenant({ organizationId: actor.organizationId });
  const link = await createPortalLink({
    organizationId: actor.organizationId,
    scope: "APPOINTMENT",
    targetId: appointment.id,
    customerId: appointment.customerId,
    expiresAt: new Date(
      Math.max(appointment.startsAt.getTime(), clock.now().getTime()) + 86_400_000,
    ),
    createdById: actor.membershipId,
  });
  await tenantDb.appointment.update({
    where: { id: appointment.id },
    data: { publicToken: link.tokenHash },
  });
  return { url: link.url, token: link.token };
}

// ─────────────────────────────── RDV groupés (flotte) ───────────────────────────────

export interface CreateBatchInput {
  siteId: string;
  customerId: string;
  date: Date;
  vehicleIds: string[];
  type: AppointmentType;
  maxParallel: number;
  notifyCustomer: boolean;
}

export async function createAppointmentBatch(
  actor: Actor,
  input: CreateBatchInput,
  clock: Clock = systemClock,
): Promise<{
  groupId: string;
  appointments: AppointmentRecord[];
  unplaced: string[];
  messageId: string | null;
}> {
  const tenantDb = db.forTenant({ organizationId: actor.organizationId });
  const planning = await loadPlanningContext(actor.organizationId, input.siteId);
  const tz = planning.organization.timeZone;
  const vehicles = await tenantDb.vehicle.findMany({
    where: { id: { in: input.vehicleIds }, customerId: input.customerId, deletedAt: null },
    select: { id: true, plate: true },
  });
  if (vehicles.length !== input.vehicleIds.length) {
    throw new DomainError(
      "appointment.vehicle_not_found",
      "Un des véhicules n'appartient pas à ce client.",
    );
  }
  const windows = halfDayWindows(planning.site.openingHours, input.date, tz, {
    lunchBreak: planning.planningSettings.lunchBreak,
    holidays: planning.holidays,
    siteId: planning.site.id,
  });
  if (windows.length === 0) {
    throw new DomainError("OUTSIDE_OPENING_HOURS", "L'atelier est fermé ce jour-là.");
  }
  const range = await dayRange(planning, input.date);
  const data = await loadRangeData(actor.organizationId, input.siteId, range.from, range.to);
  const now = clock.now();
  const placement = batchPlacement({
    vehicleIds: input.vehicleIds,
    type: input.type,
    durationMinutes: planning.appointmentSettings.durations[input.type],
    stepMinutes: planning.appointmentSettings.slotStepMinutes,
    windows,
    earliest: new Date(now.getTime() + 60 * 60_000),
    bays: planning.bays,
    appointments: data.appointments,
    blocks: data.blocks,
    occupyingOrders: data.occupyingOrders,
    maxParallel: input.maxParallel,
  });

  const groupId = `grp_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const appointments: AppointmentRecord[] = [];
  for (const placed of placement.placed) {
    const { appointment } = await createAppointment(
      actor,
      {
        siteId: input.siteId,
        customerId: input.customerId,
        vehicleId: placed.vehicleId,
        type: input.type,
        startsAt: placed.startsAt,
        durationMinutes: (placed.endsAt.getTime() - placed.startsAt.getTime()) / 60_000,
        bayId: placed.bayId,
        source: "STAFF",
        notifyCustomer: false,
        force: true,
        groupId,
      },
      clock,
    );
    appointments.push(appointment);
  }

  let messageId: string | null = null;
  if (input.notifyCustomer && appointments.length > 0) {
    const first = appointments[0]!;
    const sent = await sendCustomerMessage({
      organizationId: actor.organizationId,
      recipient: recipient(first.customer),
      body: renderGroupConfirmation({
        contactGreeting: customerGreeting(first.customer),
        garageName: planning.organization.name,
        timeZone: tz,
        items: appointments.map((a) => ({ plate: a.vehicle?.plate ?? "—", startsAt: a.startsAt })),
      }),
      templateKey: "appointment_group_confirmation",
      idempotencyKey: `appointment-group:${groupId}:confirmation`,
      sentById: actor.membershipId,
    });
    messageId = sent?.messageId ?? null;
  }
  return { groupId, appointments, unplaced: placement.unplaced, messageId };
}

/** RG-M03-14 — annuler le groupe annule tous les RDV non arrivés. */
export async function cancelAppointmentGroup(
  actor: Actor,
  input: { groupId: string; reason: string; notifyCustomer: boolean },
  clock: Clock = systemClock,
): Promise<number> {
  const tenantDb = db.forTenant({ organizationId: actor.organizationId });
  const members = await tenantDb.appointment.findMany({
    where: { groupId: input.groupId, status: { in: ["BOOKED", "CONFIRMED"] } },
    select: { id: true },
  });
  for (const member of members) {
    await cancelAppointment(
      actor,
      {
        id: member.id,
        cancelledBy: "GARAGE",
        reason: input.reason,
        notifyCustomer: input.notifyCustomer,
      },
      clock,
    );
  }
  return members.length;
}
