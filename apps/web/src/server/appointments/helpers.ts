// M03 — contexte site/horaires/jours fériés et construction des occupations (RDV, blocages,
// OR en cours) partagés par les routeurs `appointment`, `planning` et `resourceBlock`.
import type { HolidayLike, OccupancyLike, OpeningHours } from "@atelieros/core";
import { adminDb, db, type Prisma, type ScopedTenantClient } from "@atelieros/db";
import { DEFAULT_PLANNING_SETTINGS, planningSettingsSchema } from "@atelieros/validators";
import { emitDomainEvent } from "../events/emit";

/** §6 — `Organization.settings.appointments`/`.planning`, avec les défauts du PRD en repli. */
export async function loadPlanningSettings(organizationId: string) {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { settings: true },
  });
  const raw = (org.settings as { appointments?: unknown; planning?: unknown } | null) ?? {};
  const parsed = planningSettingsSchema.safeParse({
    appointments: { ...DEFAULT_PLANNING_SETTINGS.appointments, ...(raw.appointments as object) },
    planning: { ...DEFAULT_PLANNING_SETTINGS.planning, ...(raw.planning as object) },
  });
  return parsed.success ? parsed.data : DEFAULT_PLANNING_SETTINGS;
}

// Deux "mondes" de client Prisma coexistent dans ce codebase (cf. `packages/db/src/tenant.ts`) :
// le client de premier niveau renvoyé par `db.forTenant(ctx)` (type inféré, porte `.transaction()`)
// et le client borné à une transaction (`ScopedTenantClient`, reçu par le callback de
// `.transaction()`). Les deux ne sont PAS interchangeables pour TypeScript (extensions Prisma
// distinctes) : nos fonctions qui lisent hors transaction prennent le premier ; celles qui
// écrivent dans la transaction de l'appelant prennent `ScopedTenantClient` — jamais l'inverse
// sans caster (`as never`, même idiome que `emitDomainEvent`).
type TenantDb = ReturnType<typeof db.forTenant>;

export interface SiteContext {
  siteId: string;
  timeZone: string;
  openingHours: OpeningHours;
  holidays: HolidayLike[];
}

export async function loadSiteContext(
  tenantDb: TenantDb,
  organizationId: string,
  siteId: string,
): Promise<SiteContext> {
  const [org, site, holidays] = await Promise.all([
    // `Organization` n'est pas un modèle « tenant » (pas de colonne organizationId sur
    // elle-même) : lecture directe par id via `adminDb`, jamais `db.forTenant()`.
    adminDb.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    }),
    tenantDb.site.findFirstOrThrow({ where: { id: siteId }, select: { openingHours: true } }),
    tenantDb.holiday.findMany({
      where: { OR: [{ siteId: null }, { siteId }] },
      select: { date: true, siteId: true },
    }),
  ]);
  return {
    siteId,
    timeZone: org.timezone,
    openingHours: (site.openingHours ?? {}) as OpeningHours,
    holidays: holidays.map((h) => ({ date: h.date, siteId: h.siteId })),
  };
}

const BLOCKING_APPOINTMENT_STATUSES: readonly string[] = [
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "COMPLETED",
];
const BLOCKING_REPAIR_ORDER_STATUSES = ["IN_PROGRESS", "WAITING_PARTS"] as const;

/**
 * Occupations d'un site sur une fenêtre `[from, to]` : RDV (hors annulés/absents), blocages
 * (`ResourceBlock`) et OR en cours occupant un pont jusqu'à `promisedAt` (RG-M03-02).
 */
export async function loadOccupancies(
  tenantDb: TenantDb,
  siteId: string,
  from: Date,
  to: Date,
  excludeAppointmentId?: string,
): Promise<OccupancyLike[]> {
  const [appointments, blocks, repairOrders] = await Promise.all([
    tenantDb.appointment.findMany({
      where: {
        siteId,
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: {
        id: true,
        bayId: true,
        mechanicId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        overbooked: true,
      },
    }),
    tenantDb.resourceBlock.findMany({
      where: { siteId, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { id: true, bayId: true, membershipId: true, startsAt: true, endsAt: true },
    }),
    tenantDb.repairOrder.findMany({
      where: {
        siteId,
        bayId: { not: null },
        status: { in: [...BLOCKING_REPAIR_ORDER_STATUSES] },
      },
      select: { id: true, bayId: true, promisedAt: true, startedAt: true, createdAt: true },
    }),
  ]);

  const occupancies: OccupancyLike[] = appointments.map((a) => ({
    id: a.id,
    bayId: a.bayId,
    mechanicId: a.mechanicId,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    blocking: BLOCKING_APPOINTMENT_STATUSES.includes(a.status),
    overbooked: a.overbooked,
  }));

  for (const block of blocks) {
    occupancies.push({
      id: `block:${block.id}`,
      bayId: block.bayId,
      mechanicId: block.membershipId,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      blocking: true,
    });
  }

  // RG-M03-02 : un OR en cours bloque son pont jusqu'à `promisedAt` (fin de journée si absent).
  for (const order of repairOrders) {
    if (!order.bayId) continue;
    const start = order.startedAt ?? order.createdAt;
    const end = order.promisedAt ?? new Date(`${start.toISOString().slice(0, 10)}T23:59:59.999Z`);
    if (start >= to || end <= from) continue;
    occupancies.push({
      id: `ro:${order.id}`,
      bayId: order.bayId,
      mechanicId: null,
      startsAt: start,
      endsAt: end,
      blocking: true,
    });
  }

  return occupancies;
}

export interface PresentMechanic {
  id: string;
  hoursAvailable: number;
}

/**
 * RG-M03-06 : mécaniciens disponibles le jour de `date` (Membership active, rôle MECHANIC —
 * ou MANAGER avec compétence atelier, filtrée côté appelant si besoin —, rattachée au site,
 * sans `ResourceBlock` couvrant la demi-journée). Heures = celles du site ce jour-là.
 */
export async function loadPresentMechanics(
  tenantDb: TenantDb,
  siteId: string,
  dayStart: Date,
  dayEnd: Date,
  hoursPerPresentDay: number,
): Promise<PresentMechanic[]> {
  const memberships = await tenantDb.membership.findMany({
    where: {
      isActive: true,
      role: "MECHANIC",
      OR: [{ siteIds: { isEmpty: true } }, { siteIds: { has: siteId } }],
    },
    select: { id: true },
  });
  if (memberships.length === 0) return [];

  const blocks = await tenantDb.resourceBlock.findMany({
    where: {
      siteId,
      startsAt: { lt: dayEnd },
      endsAt: { gt: dayStart },
      membershipId: { in: memberships.map((m) => m.id) },
    },
    select: { membershipId: true },
  });
  const blockedIds = new Set(blocks.map((b) => b.membershipId).filter((id): id is string => !!id));

  return memberships
    .filter((m) => !blockedIds.has(m.id))
    .map((m) => ({ id: m.id, hoursAvailable: hoursPerPresentDay }));
}

export async function emitAppointmentEvent(
  tx: ScopedTenantClient,
  organizationId: string,
  type:
    | "appointment.created"
    | "appointment.cancelled"
    | "appointment.updated"
    | "appointment.confirmed"
    | "appointment.arrived"
    | "appointment.no_show"
    | "appointment.completed",
  payload: Record<string, unknown>,
): Promise<void> {
  await emitDomainEvent(tx as never, organizationId, type, payload);
}

export type { Prisma, TenantDb };
export { db };
