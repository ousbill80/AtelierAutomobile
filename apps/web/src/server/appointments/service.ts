// M03 — orchestration serveur des rendez-vous : chargement du planning d'un site, contrôles de
// réservation (horaires, conflits, capacité, doublon du jour), messages transactionnels.
// La logique métier elle-même vit dans `@atelieros/core` (planning/*) ; ce module ne fait que
// charger, appeler `core`, puis traduire les refus en `DomainError` lisibles.
import { TRPCError } from "@trpc/server";
import {
  APPOINTMENT_PURPOSE_FR,
  DomainError,
  addDaysToKey,
  checkCapacity,
  clientNamespace,
  detectConflicts,
  formatDayFr,
  formatMinutesFr,
  formatTimeFr,
  halfDayBoundary,
  halfDayLoad,
  halfDayOfMinutes,
  isBayCompatible,
  isWithinOpeningHours,
  localDateKey,
  localMinutes,
  resolvePlanningConfig,
  transactionalSendTime,
  zonedInstant,
  type AppointmentStatusKey,
  type AppointmentTypeKey,
  type BayTypeKey,
  type BlockLike,
  type Channel,
  type Conflict,
  type ExistingAppointment,
  type OccupyingOrder,
  type OpeningHours,
  type PlanningConfig,
  type PlanningSnapshot,
} from "@atelieros/core";
import {
  adminDb,
  db,
  issuePortalToken,
  type Organization,
  type ScopedTenantClient,
} from "@atelieros/db";
import { messagingEnqueue, type EnqueueRequest } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";

export type TenantDb = ReturnType<typeof db.forTenant>;
/** Client utilisable hors et dans `tenantDb.transaction()` (mêmes délégués typés). */
export type Tx = ScopedTenantClient;

export const RECEPTION_PATH = "/ordres/reception";

export function asTx(tenantDb: TenantDb): Tx {
  return tenantDb as unknown as Tx;
}

export async function loadOrganization(organizationId: string): Promise<Organization> {
  return adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
}

export function planningConfigOf(org: Pick<Organization, "settings">): PlanningConfig {
  return resolvePlanningConfig(org.settings);
}

interface SiteCtx {
  allowedSiteIds: string[] | "ALL";
  session: { activeSiteId: string | null };
}

/** Site visé : explicite, sinon site actif de la session, sinon premier site autorisé. */
export async function resolveSite(tx: Tx, ctx: SiteCtx, siteId?: string | null) {
  const wanted = siteId ?? ctx.session.activeSiteId ?? null;
  if (wanted) {
    if (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(wanted)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "FORBIDDEN_SITE" });
    }
    const site = await tx.site.findFirst({ where: { id: wanted } });
    if (!site) throw new TRPCError({ code: "NOT_FOUND", message: "Atelier introuvable." });
    return site;
  }
  const site = await tx.site.findFirst({
    where: {
      isActive: true,
      ...(ctx.allowedSiteIds === "ALL" ? {} : { id: { in: ctx.allowedSiteIds } }),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!site) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Aucun atelier actif. Créez un site dans Paramètres › Sites.",
    });
  }
  return site;
}

export function siteOpeningHours(site: { openingHours: unknown }): OpeningHours {
  const value = site.openingHours;
  return value && typeof value === "object" ? (value as OpeningHours) : {};
}

/** Statuts d'OR qui occupent un pont (RG-M03-02). */
const OCCUPYING_ORDER_STATUSES = ["IN_PROGRESS", "WAITING_PARTS"] as const;

export interface LoadedPlanning {
  snapshot: PlanningSnapshot;
  bays: Array<{
    id: string;
    name: string;
    type: BayTypeKey;
    isActive: boolean;
    sortOrder: number;
    color: string | null;
  }>;
  mechanics: Array<{ id: string; name: string; skills: string[] }>;
  timeZone: string;
}

/**
 * Charge tout ce qu'il faut pour décider d'une réservation sur `[from, to)` : ponts, RDV,
 * blocages, jours fériés, mécaniciens rattachés au site et OR occupant un pont.
 */
export async function loadPlanning(
  tx: Tx,
  input: {
    org: Organization;
    site: { id: string; openingHours: unknown };
    from: Date;
    to: Date;
    now: Date;
  },
): Promise<LoadedPlanning> {
  const { org, site, from, to, now } = input;
  const config = planningConfigOf(org);
  const timeZone = org.timezone;
  const [bays, appointments, blocks, holidays, memberships, orders] = await Promise.all([
    tx.bay.findMany({
      where: { siteId: site.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    tx.appointment.findMany({
      where: { siteId: site.id, startsAt: { lt: to }, endsAt: { gt: from } },
      include: { customer: { select: { displayName: true } } },
    }),
    tx.resourceBlock.findMany({
      where: { siteId: site.id, startsAt: { lt: to }, endsAt: { gt: from } },
    }),
    tx.holiday.findMany({
      where: {
        OR: [{ siteId: null }, { siteId: site.id }],
        date: {
          gte: new Date(from.getTime() - 86_400_000),
          lte: new Date(to.getTime() + 86_400_000),
        },
      },
    }),
    tx.membership.findMany({
      where: { isActive: true, role: "MECHANIC" },
      include: { user: { select: { name: true } } },
    }),
    tx.repairOrder.findMany({
      where: {
        siteId: site.id,
        bayId: { not: null },
        deletedAt: null,
        status: { in: [...OCCUPYING_ORDER_STATUSES] },
      },
      select: {
        id: true,
        bayId: true,
        number: true,
        startedAt: true,
        createdAt: true,
        promisedAt: true,
      },
    }),
  ]);
  const mechanics = memberships
    .filter((m) => m.siteIds.length === 0 || m.siteIds.includes(site.id))
    .map((m) => ({ id: m.id, name: m.user.name, skills: m.skills }));
  const endOfToday = zonedInstant(addDaysToKey(localDateKey(now, timeZone), 1), 0, timeZone);
  const occupying: OccupyingOrder[] = orders.map((o) => {
    const end = o.promisedAt && o.promisedAt > now ? o.promisedAt : endOfToday;
    return {
      id: o.id,
      bayId: o.bayId!,
      startsAt: o.startedAt ?? o.createdAt,
      endsAt: end,
      label: o.number,
    };
  });
  const existing: ExistingAppointment[] = appointments.map((a) => ({
    id: a.id,
    bayId: a.bayId,
    mechanicId: a.mechanicId,
    status: a.status as AppointmentStatusKey,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    customerName: a.customer.displayName,
  }));
  const blockLikes: BlockLike[] = blocks.map((b) => ({
    id: b.id,
    bayId: b.bayId,
    membershipId: b.membershipId,
    reason: b.reason,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
  }));
  return {
    timeZone,
    bays: bays.map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type as BayTypeKey,
      isActive: b.isActive,
      sortOrder: b.sortOrder,
      color: b.color,
    })),
    mechanics,
    snapshot: {
      timeZone,
      siteId: site.id,
      openingHours: siteOpeningHours(site),
      holidays: holidays.map((h) => ({ date: h.date, siteId: h.siteId })),
      lunchBreak: config.planning.lunchBreak,
      productivityRate: config.planning.productivityRate,
      configuredMaxPerHalfDay: config.appointments.maxAppointmentsPerHalfDay,
      bays: bays.map((b) => ({ id: b.id, type: b.type as BayTypeKey, isActive: b.isActive })),
      mechanicIds: mechanics.map((m) => m.id),
      appointments: existing,
      blocks: blockLikes,
      orders: occupying,
    },
  };
}

/** Bornes d'un jour civil local (minuit → minuit) en UTC. */
export function dayBounds(dateKey: string, timeZone: string) {
  return {
    from: zonedInstant(dateKey, 0, timeZone),
    to: zonedInstant(addDaysToKey(dateKey, 1), 0, timeZone),
  };
}

const HALF_DAY_FR = { AM: "matin", PM: "après-midi" } as const;

/** « samedi matin » */
export function halfDayLabel(
  startsAt: Date,
  timeZone: string,
  lunchBreak: PlanningConfig["planning"]["lunchBreak"],
) {
  const weekday = formatDayFr(startsAt, timeZone).split(" ")[0];
  const half = halfDayOfMinutes(localMinutes(startsAt, timeZone), halfDayBoundary(lunchBreak));
  return `${weekday} ${HALF_DAY_FR[half]}`;
}

export interface BookingCheckInput {
  planning: LoadedPlanning;
  config: PlanningConfig;
  startsAt: Date;
  endsAt: Date;
  type: AppointmentTypeKey;
  bayId: string | null;
  mechanicId: string | null;
  vehicleId: string | null;
  excludeId?: string;
  /** L'appelant a demandé le forçage. */
  force: boolean;
  /** L'appelant détient `planning:manage` (surréservation, hors horaires, capacité). */
  canForce: boolean;
  /** Contrôler la charge (création, ou changement d'horaire/durée). */
  checkLoad: boolean;
  /** RDV actifs du même véhicule le même jour (RG-M03-13). */
  vehicleSameDay?: Array<{ id: string; startsAt: Date }>;
}

export interface BookingCheckResult {
  overbooked: boolean;
  outsideHours: boolean;
  warnings: string[];
}

function conflictMessage(conflict: Conflict, planning: LoadedPlanning): string {
  const tz = planning.timeZone;
  const range = `de ${formatTimeFr(conflict.startsAt, tz)} à ${formatTimeFr(conflict.endsAt, tz)}`;
  const bay = (id: string | null | undefined) =>
    planning.bays.find((b) => b.id === id)?.name ?? "Le pont";
  switch (conflict.kind) {
    case "BAY":
      return `${bay(planning.snapshot.appointments.find((a) => a.id === conflict.conflictingId)?.bayId)} occupé ${range}${conflict.label ? ` (${conflict.label})` : ""}.`;
    case "MECHANIC":
      return `Ce mécanicien a déjà un RDV ${range}${conflict.label ? ` (${conflict.label})` : ""}.`;
    case "BAY_BLOCKED":
      return `Pont indisponible ${range} : ${conflict.label}.`;
    case "MECHANIC_ABSENT":
      return `Mécanicien absent ${range} : ${conflict.label}.`;
    case "SITE_CLOSED":
      return `Atelier fermé ${range} : ${conflict.label}.`;
    case "REPAIR_ORDER":
      return `Pont occupé par l'OR ${conflict.label ?? ""} ${range}.`.replace("  ", " ");
  }
}

/**
 * RG-M03-01/02/05/13 — lève une `DomainError` (code du PRD §8) si la réservation est refusée.
 * Codes forçables : SLOT_CONFLICT (pont/mécanicien), OUTSIDE_OPENING_HOURS, CAPACITY_EXCEEDED
 * (planning:manage) et DUPLICATE_SAME_DAY (tout utilisateur pouvant créer un RDV).
 */
export function assertBookable(input: BookingCheckInput): BookingCheckResult {
  const { planning, config } = input;
  const tz = planning.timeZone;
  const warnings: string[] = [];
  const result: BookingCheckResult = { overbooked: false, outsideHours: false, warnings };
  const managerForce = input.force && input.canForce;

  if (input.endsAt <= input.startsAt) {
    throw new DomainError("INVALID_DURATION", "La durée du RDV doit être positive.");
  }

  if (!isWithinOpeningHours(input.startsAt, input.endsAt, { ...planning.snapshot })) {
    if (!managerForce) {
      throw new DomainError(
        "OUTSIDE_OPENING_HOURS",
        "Ce créneau est en dehors des horaires d'ouverture (ou un jour férié).",
        { forcible: input.canForce },
      );
    }
    result.outsideHours = true;
  }

  if (input.bayId) {
    const bay = planning.bays.find((b) => b.id === input.bayId);
    if (!bay || !bay.isActive) {
      throw new DomainError("BAY_NOT_FOUND", "Ce pont n'existe pas ou n'est plus actif.");
    }
    if (!isBayCompatible(input.type, bay.type)) {
      warnings.push(`${bay.name} n'est pas un pont adapté à ce type de RDV.`);
    }
  }

  if (input.mechanicId) {
    const mechanic = planning.mechanics.find((m) => m.id === input.mechanicId);
    if (!mechanic) {
      throw new DomainError(
        "MECHANIC_NOT_FOUND",
        "Ce mécanicien n'est pas rattaché à cet atelier.",
      );
    }
    if (
      input.type === "BODYWORK" &&
      !mechanic.skills.some((s) => s.toLowerCase().includes("carrosserie"))
    ) {
      warnings.push(`${mechanic.name} n'a pas la compétence carrosserie`);
    }
  }

  const conflicts = detectConflicts(
    {
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      bayId: input.bayId,
      mechanicId: input.mechanicId,
      excludeId: input.excludeId,
    },
    planning.snapshot,
  );
  const hard = conflicts.find((c) => c.kind !== "BAY" && c.kind !== "MECHANIC");
  if (hard) {
    throw new DomainError(
      hard.kind === "MECHANIC_ABSENT" ? "MECHANIC_ABSENT" : "SLOT_BLOCKED",
      conflictMessage(hard, planning),
      { conflictingId: hard.conflictingId, forcible: false },
    );
  }
  const soft = conflicts[0];
  if (soft) {
    if (!managerForce) {
      throw new DomainError("SLOT_CONFLICT", conflictMessage(soft, planning), {
        conflictingId: soft.conflictingId,
        forcible: input.canForce,
      });
    }
    result.overbooked = true;
  }

  if (input.checkLoad) {
    const dateKey = localDateKey(input.startsAt, tz);
    const halfDay = halfDayOfMinutes(
      localMinutes(input.startsAt, tz),
      halfDayBoundary(config.planning.lunchBreak),
    );
    const load = halfDayLoad(planning.snapshot, dateKey, halfDay, input.excludeId);
    const check = checkCapacity({
      capacityMinutes: load.capacityMinutes,
      loadMinutes: load.loadMinutes,
      durationMinutes: Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000),
      appointmentsCount: load.appointmentsCount,
      maxAppointments: load.maxAppointments,
    });
    if (!check.ok && !managerForce) {
      const label = halfDayLabel(input.startsAt, tz, config.planning.lunchBreak);
      throw new DomainError(
        "CAPACITY_EXCEEDED",
        check.reason === "CAPACITY_EXCEEDED"
          ? `Atelier complet ${label} (${formatMinutesFr(check.load)} / ${formatMinutesFr(check.capacity)}).`
          : `Atelier complet ${label} (${check.count} RDV, maximum ${check.max}).`,
        { load: load.loadMinutes, capacity: load.capacityMinutes, forcible: input.canForce },
      );
    }
    if (!check.ok) result.overbooked = true;
  }

  const duplicate = input.vehicleSameDay?.find((a) => a.id !== input.excludeId);
  if (duplicate && !input.force) {
    throw new DomainError(
      "DUPLICATE_SAME_DAY",
      `Ce véhicule a déjà un RDV le ${formatDayFr(duplicate.startsAt, tz).split(" ")[1]!.slice(0, 5)} à ${formatTimeFr(duplicate.startsAt, tz)}. Voulez-vous le modifier ?`,
      { conflictingId: duplicate.id, forcible: true },
    );
  }

  return result;
}

/** RDV actifs du même véhicule le même jour local (RG-M03-13). */
export async function vehicleAppointmentsSameDay(
  tx: Tx,
  vehicleId: string | null,
  startsAt: Date,
  timeZone: string,
) {
  if (!vehicleId) return [];
  const { from, to } = dayBounds(localDateKey(startsAt, timeZone), timeZone);
  return tx.appointment.findMany({
    where: {
      vehicleId,
      startsAt: { gte: from, lt: to },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
    select: { id: true, startsAt: true },
  });
}

/** Avertissement « véhicule déjà à l'atelier » (OR ouvert, §11). */
export async function openRepairOrderWarning(
  tx: Tx,
  vehicleId: string | null,
): Promise<string | null> {
  if (!vehicleId) return null;
  const order = await tx.repairOrder.findFirst({
    where: {
      vehicleId,
      deletedAt: null,
      status: { notIn: ["DELIVERED", "INVOICED", "CANCELLED"] },
    },
    select: { number: true, status: true },
  });
  return order
    ? `Ce véhicule est déjà à l'atelier (${order.number}, statut ${order.status}).`
    : null;
}

/** Une violation de la contrainte d'exclusion Postgres (deux réservations concurrentes). */
export function isOverlapViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("appointment_no_overlap") || text.includes("23P01");
}

export function concurrentConflictError(): DomainError {
  return new DomainError("SLOT_CONFLICT", "Ce créneau vient d'être pris. Choisissez-en un autre.", {
    forcible: false,
  });
}

// ─────────────── Lien portail (A2) ───────────────

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Jeton APPOINTMENT (confirmer / déplacer / annuler) ; renvoie le lien public. */
export async function issueAppointmentLink(
  tx: Tx,
  input: {
    organizationId: string;
    appointmentId: string;
    customerId: string;
    startsAt: Date;
    reminderId?: string | null;
    createdById?: string | null;
  },
): Promise<string> {
  const { token, tokenHash } = await issuePortalToken(tx, {
    organizationId: input.organizationId,
    scope: "APPOINTMENT",
    targetId: input.appointmentId,
    customerId: input.customerId,
    expiresAt: new Date(input.startsAt.getTime() + 7 * 86_400_000),
    reminderId: input.reminderId,
    createdById: input.createdById,
  });
  await tx.appointment.update({
    where: { id: input.appointmentId },
    data: { publicToken: tokenHash },
  });
  return `${appUrl()}/p/${token}/rdv`;
}

/** Après un déplacement : le lien du RDV reste valable jusqu'à 7 jours après la nouvelle date. */
export async function extendAppointmentLink(tx: Tx, appointmentId: string, startsAt: Date) {
  await tx.portalToken.updateMany({
    where: { scope: "APPOINTMENT", targetId: appointmentId, status: "ACTIVE" },
    data: { expiresAt: new Date(startsAt.getTime() + 7 * 86_400_000) },
  });
}

/** Jeton BOOKING (choisir un créneau) pour un client/véhicule, ex. reprogrammation après absence. */
export async function issueBookingLink(
  tx: Tx,
  input: {
    organizationId: string;
    customerId: string;
    vehicleId: string | null;
    reminderId?: string | null;
    createdById?: string | null;
    now: Date;
  },
): Promise<string> {
  const { token } = await issuePortalToken(tx, {
    organizationId: input.organizationId,
    scope: "BOOKING",
    targetId: input.vehicleId ?? input.customerId,
    customerId: input.customerId,
    expiresAt: new Date(input.now.getTime() + 30 * 86_400_000),
    reminderId: input.reminderId,
    createdById: input.createdById,
  });
  return `${appUrl()}/p/${token}/rdv`;
}

// ─────────────── Messages transactionnels (RG-M03-08, via M11) ───────────────

export type AppointmentMessageKind =
  "confirm" | "moved" | "cancelled" | "no_show" | "reminder" | "batch";

export interface AppointmentNotification {
  messageId: string;
  sendAt: Date;
}

/**
 * Met en file un message transactionnel (envoyé même si le client est désinscrit des
 * relances). Idempotent par `appt:<id>:<kind>:<suffix>`. Renvoie `null` si le client n'a
 * aucun canal joignable (→ « Confirmations à obtenir par téléphone »).
 */
export async function enqueueAppointmentMessage(
  tx: Tx,
  input: {
    organizationId: string;
    appointmentId: string;
    kind: AppointmentMessageKind;
    idempotencySuffix: string;
    customer: {
      id: string;
      phone: string | null;
      whatsappPhone: string | null;
      email: string | null;
      displayName: string;
    };
    body: string;
    sentById?: string | null;
    timeZone: string;
    now: Date;
    templateKey?: string;
    context?: Record<string, unknown>;
  },
): Promise<AppointmentNotification | null> {
  const req: EnqueueRequest = {
    idempotencyKey: `appt:${input.appointmentId}:${input.kind}:${input.idempotencySuffix}`,
    kind: "transactional",
    customerId: input.customer.id,
    to: {
      phone: input.customer.phone,
      whatsapp: input.customer.whatsappPhone ?? input.customer.phone,
      email: input.customer.email,
      name: input.customer.displayName,
    },
    channels: ["WHATSAPP", "SMS", "EMAIL"] satisfies Channel[],
    ...(input.templateKey
      ? { templateKey: input.templateKey, context: input.context }
      : { bodyOverride: input.body, subjectOverride: "Votre rendez-vous" }),
    sentById: input.sentById ?? null,
  };
  const result = await messagingEnqueue(tx, input.organizationId, req);
  if ("reason" in result) return null;
  return { messageId: result.message.id, sendAt: transactionalSendTime(input.now, input.timeZone) };
}

/** À appeler après le commit de la transaction qui a créé les messages. */
export async function dispatchNotifications(
  notifications: ReadonlyArray<AppointmentNotification | null>,
  now: Date,
): Promise<void> {
  for (const n of notifications) {
    if (!n) continue;
    await enqueueMessageSendJob(n.messageId, Math.max(0, n.sendAt.getTime() - now.getTime()));
  }
}

/** Contexte des modèles M10/M11 (`rdv_confirm`) pour un RDV. */
export function templateContext(input: {
  org: Organization;
  site: { address: string | null; phone: string | null };
  customer: { civility: "M" | "MME" | "MLLE" | null; lastName: string | null; displayName: string };
  vehicle: { make: string; model: string; plate: string } | null;
  startsAt: Date;
  type: AppointmentTypeKey;
}) {
  const tz = input.org.timezone;
  return {
    client: clientNamespace(input.customer),
    garage: {
      nom: input.org.name,
      telephone: input.site.phone ?? input.org.phone ?? "",
      adresse: input.site.address ?? input.org.address ?? "",
    },
    rdv: {
      date: formatDayFr(input.startsAt, tz),
      heure: formatTimeFr(input.startsAt, tz),
      motif: APPOINTMENT_PURPOSE_FR[input.type],
    },
    vehicule: {
      marque: input.vehicle?.make ?? "",
      modele: input.vehicle?.model ?? "",
      plaque: input.vehicle?.plate ?? "",
    },
  };
}

/** Le modèle `rdv_confirm` est utilisé si l'organisation l'a sur tous les canaux mobiles actifs. */
export async function hasConfirmTemplate(tx: Tx): Promise<boolean> {
  const templates = await tx.messageTemplate.findMany({
    where: { key: "rdv_confirm", isActive: true, channel: { in: ["WHATSAPP", "SMS", "EMAIL"] } },
    select: { channel: true },
  });
  const channels = new Set(templates.map((t) => t.channel));
  return channels.has("WHATSAPP") && channels.has("SMS") && channels.has("EMAIL");
}

/** Notifications internes (chef d'atelier, conseillers) — une fois par objet et par jour. */
export async function notifyStaff(
  tx: Tx,
  input: {
    organizationId: string;
    siteId: string;
    roles?: Array<"OWNER" | "MANAGER" | "ADVISOR">;
    type: string;
    title: string;
    body?: string;
    link?: string;
    dedupeKey: string;
  },
): Promise<void> {
  const members = await tx.membership.findMany({
    where: { isActive: true, role: { in: input.roles ?? ["MANAGER", "ADVISOR"] } },
    select: { id: true, siteIds: true },
  });
  for (const member of members) {
    if (member.siteIds.length > 0 && !member.siteIds.includes(input.siteId)) continue;
    const existing = await tx.notification.findFirst({
      where: { membershipId: member.id, dedupeKey: input.dedupeKey },
    });
    if (existing) continue;
    await tx.notification.create({
      data: {
        organizationId: input.organizationId,
        membershipId: member.id,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        dedupeKey: input.dedupeKey,
        severity: "info",
      },
    });
  }
}
