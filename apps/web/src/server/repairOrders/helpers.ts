// M04 — orchestration des ordres de réparation : contexte d'organisation, numérotation,
// transitions (statut + historique + événements), totaux, kilométrage, lien de suivi.
// Toute décision métier vient de `@atelieros/core` (repairOrders) ; ici on lit/écrit en base.
import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  businessDate,
  canTransition,
  computeAvgKmPerDay,
  computeNextServiceDue,
  customerExposure,
  creditCheck,
  DEFAULT_NUMBERING_CONFIG,
  isDomainError,
  laborRatesFrom,
  OPEN_INVOICE_STATUSES,
  renderNumberingPattern,
  repairOrderSettingsFrom,
  repairOrderTotals,
  systemClock,
  warrantySettingsFrom,
  type AgingInvoice,
  type Clock,
  type NumberingConfig,
  type RepairOrderStatus,
  type RepairOrderTransition,
  type TransitionContext,
  type TransitionLine,
} from "@atelieros/core";
import {
  adminDb,
  collectionSettingsFrom,
  tenantSequenceStore,
  type Prisma,
  type RepairOrder,
  type ScopedTenantClient,
} from "@atelieros/db";
import { emitDomainEvent } from "../events/emit";

type Tx = ScopedTenantClient;

/** Horloge injectable pour les tests (CLAUDE.md : jamais `new Date()` dans la logique). */
let clock: Clock = systemClock;
export function setRepairOrdersClock(next: Clock): void {
  clock = next;
}
export function roNow(): Date {
  return clock.now();
}

export interface OrgRoContext {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  rccm: string | null;
  ncc: string | null;
  logoUrl: string | null;
  timeZone: string;
  operatingMode: string;
  vatEnabled: boolean;
  vatRate: number;
  rawSettings: unknown;
  settings: ReturnType<typeof repairOrderSettingsFrom>;
  laborRates: ReturnType<typeof laborRatesFrom>;
  warranty: ReturnType<typeof warrantySettingsFrom>;
  numbering: NumberingConfig;
  blockAfterDays: number;
}

export async function loadOrgRoContext(organizationId: string): Promise<OrgRoContext> {
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const raw = org.settings;
  const numberingRaw =
    raw && typeof raw === "object" && "numbering" in raw
      ? ((raw as { numbering?: Record<string, Partial<NumberingConfig>> }).numbering?.OR ?? {})
      : {};
  return {
    id: org.id,
    name: org.name,
    phone: org.phone,
    address: org.address,
    rccm: org.rccm,
    ncc: org.ncc,
    logoUrl: org.logoUrl,
    timeZone: org.timezone,
    operatingMode: org.operatingMode,
    vatEnabled: org.vatEnabled,
    vatRate: org.vatRate,
    rawSettings: raw,
    settings: repairOrderSettingsFrom(raw),
    laborRates: laborRatesFrom(raw),
    warranty: warrantySettingsFrom(raw),
    numbering: { ...DEFAULT_NUMBERING_CONFIG.OR, ...numberingRaw },
    blockAfterDays: collectionSettingsFrom(raw).blockAfterDays,
  };
}

/** M04 §11 : en mode REMINDERS_ONLY, les OR sont indisponibles (`MODULE_DISABLED`). */
export function assertRoModule(org: Pick<OrgRoContext, "operatingMode">): void {
  if (org.operatingMode === "REMINDERS_ONLY") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "MODULE_DISABLED : les ordres de réparation sont disponibles en gestion complète.",
    });
  }
}

export function notFound(message = "Ordre de réparation introuvable."): never {
  throw new TRPCError({ code: "NOT_FOUND", message });
}

export function badRequest(message: string, cause?: unknown): never {
  throw new TRPCError({ code: "BAD_REQUEST", message, cause });
}

/** Traduit une `DomainError` du core en erreur tRPC lisible (message français). */
export function rethrowDomain(error: unknown): never {
  if (isDomainError(error)) badRequest(error.message, error);
  throw error;
}

/** RG-M04-01 : `OR-{SITE}-{AAAA}-{NNNNN}`, séquence par site et par année. */
export async function nextRepairOrderNumber(
  tx: Tx,
  org: OrgRoContext,
  siteId: string,
  now: Date,
): Promise<string> {
  const site = await tx.site.findFirst({ where: { id: siteId }, select: { code: true } });
  if (!site) badRequest("Site introuvable.");
  const year = Number(businessDate(now, org.timeZone).toISOString().slice(0, 4));
  const value = await tenantSequenceStore(tx).getAndIncrement({
    organizationId: org.id,
    siteId: org.numbering.perSite ? siteId : null,
    docType: "OR",
    year: org.numbering.resetYearly ? year : 0,
  });
  return renderNumberingPattern(org.numbering, { siteCode: site.code, year, value });
}

/** Totaux recalculés en transaction à chaque modification de ligne (RG-M04-05). */
export async function recomputeTotals(tx: Tx, repairOrderId: string, vatEnabled: boolean) {
  const lines = await tx.repairOrderLine.findMany({ where: { repairOrderId } });
  const totals = repairOrderTotals(lines, vatEnabled);
  await tx.repairOrder.update({
    where: { id: repairOrderId },
    data: { totalEstimate: totals.totalEstimate },
  });
  return totals;
}

/** Données nécessaires aux gardes de la machine à états, lues en base. */
export async function transitionFacts(
  tx: Tx,
  order: Pick<RepairOrder, "id" | "siteId">,
): Promise<
  Pick<
    TransitionContext,
    | "openTimeEntries"
    | "openTimeEntryName"
    | "issuedPartsNotReturned"
    | "unavailablePartLines"
    | "hasIssuedInvoice"
  >
> {
  const [openEntries, movements, invoices, partLines] = await Promise.all([
    tx.timeEntry.findMany({
      where: { repairOrderId: order.id, endedAt: null },
      select: { membership: { select: { user: { select: { name: true } } } } },
      take: 1,
    }),
    tx.stockMovement.aggregate({
      where: { repairOrderId: order.id, type: { in: ["ISSUE_TO_RO", "RETURN_FROM_RO"] } },
      _sum: { quantity: true },
    }),
    tx.invoice.count({
      where: { repairOrderId: order.id, status: { notIn: ["DRAFT", "VOID"] } },
    }),
    tx.repairOrderLine.findMany({
      where: {
        repairOrderId: order.id,
        type: "PART",
        status: { in: ["PENDING", "IN_PROGRESS"] },
        approval: { in: ["APPROVED", "NOT_REQUIRED"] },
        isCustomerSupplied: false,
      },
      select: { productId: true, quantity: true },
    }),
  ]);
  const openCount = await tx.timeEntry.count({
    where: { repairOrderId: order.id, endedAt: null },
  });
  // Sorties = mouvements négatifs (ISSUE_TO_RO), retours positifs : solde < 0 → pièces dehors.
  const issued = -(movements._sum.quantity ?? 0);
  const unavailable = await countUnavailableParts(tx, order.siteId, partLines);
  return {
    openTimeEntries: openCount,
    openTimeEntryName: openEntries[0]?.membership.user.name ?? null,
    issuedPartsNotReturned: Math.max(0, issued),
    unavailablePartLines: unavailable,
    hasIssuedInvoice: invoices > 0,
  };
}

/**
 * M07 (interface) : pièce disponible si `onHand − reserved ≥ quantité` au site de l'OR. Une
 * pièce hors catalogue (sans `productId`) est considérée « à commander ».
 */
export async function countUnavailableParts(
  tx: Tx,
  siteId: string,
  lines: { productId: string | null; quantity: number }[],
): Promise<number> {
  const productIds = lines.map((l) => l.productId).filter((p): p is string => !!p);
  const levels = productIds.length
    ? await tx.stockLevel.findMany({ where: { siteId, productId: { in: productIds } } })
    : [];
  const available = new Map(levels.map((l) => [l.productId, l.onHand - l.reserved]));
  return lines.filter((l) => !l.productId || (available.get(l.productId) ?? 0) < l.quantity).length;
}

export interface ApplyTransitionInput {
  order: RepairOrder;
  to: RepairOrderStatus;
  transition: RepairOrderTransition;
  reason?: string | null;
  membershipId: string | null;
  now: Date;
  data?: Prisma.RepairOrderUpdateInput;
}

/**
 * Écrit le nouveau statut, l'historique (`RepairOrderStatusHistory`) et l'événement
 * `repair_order.status_changed` (+ ready/delivered/cancelled) dans la transaction.
 */
export async function applyTransition(tx: Tx, input: ApplyTransitionInput): Promise<RepairOrder> {
  const { order, to, now } = input;
  const data: Prisma.RepairOrderUpdateInput = { status: to, ...input.data };
  if (to === "DIAGNOSING" || to === "IN_PROGRESS") data.startedAt = order.startedAt ?? now;
  if (to === "WAITING_PARTS") data.waitingPartsSince = now;
  if (order.status === "WAITING_PARTS" && to !== "WAITING_PARTS") data.waitingPartsSince = null;
  if (to === "QUALITY_CHECK" || (to === "READY" && input.transition === "complete_work")) {
    data.completedAt = now;
  }
  if (to === "READY" && input.transition !== "reopen") data.readyAt = now;
  if (to === "CANCELLED") {
    data.cancelledAt = now;
    data.cancelReason = input.reason ?? null;
  }
  if (to === "INVOICED") data.invoicedAt = now;

  const updated = await tx.repairOrder.update({ where: { id: order.id }, data });
  await tx.repairOrderStatusHistory.create({
    data: {
      organizationId: order.organizationId,
      repairOrderId: order.id,
      fromStatus: order.status,
      toStatus: to,
      transition: input.transition,
      reason: input.reason ?? null,
      membershipId: input.membershipId,
    },
  });
  const payload = {
    repairOrderId: order.id,
    number: order.number,
    customerId: order.customerId,
    vehicleId: order.vehicleId,
    from: order.status,
    to,
    newStatus: to,
    at: now.toISOString(),
    byMembershipId: input.membershipId,
  };
  await emitDomainEvent(tx as never, order.organizationId, "repair_order.status_changed", payload);
  if (to === "READY")
    await emitDomainEvent(tx as never, order.organizationId, "repair_order.ready", payload);
  if (to === "DELIVERED") {
    await emitDomainEvent(tx as never, order.organizationId, "repair_order.delivered", payload);
  }
  if (to === "CANCELLED") {
    await emitDomainEvent(tx as never, order.organizationId, "repair_order.cancelled", {
      ...payload,
      reason: input.reason ?? null,
    });
  }
  return updated;
}

/** Vérifie la transition avec la machine à états, lève `TRANSITION_NOT_ALLOWED` sinon. */
export function assertTransition(
  order: RepairOrder,
  lines: TransitionLine[],
  transition: RepairOrderTransition,
  ctx: TransitionContext,
): RepairOrderStatus {
  const result = canTransition(order, lines, transition, ctx);
  if (!result.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result.message,
      cause: { code: "TRANSITION_NOT_ALLOWED", reason: result.code },
    });
  }
  return result.to;
}

/** Notifications internes (cloche) : une ligne par destinataire. */
export async function notify(
  tx: Tx,
  organizationId: string,
  membershipIds: (string | null | undefined)[],
  notification: { type: string; title: string; body?: string; link?: string; dedupeKey?: string },
): Promise<void> {
  const unique = [...new Set(membershipIds.filter((m): m is string => !!m))];
  for (const membershipId of unique) {
    if (notification.dedupeKey) {
      const existing = await tx.notification.findFirst({
        where: { membershipId, dedupeKey: notification.dedupeKey },
      });
      if (existing) continue;
    }
    await tx.notification.create({
      data: { organizationId, membershipId, ...notification },
    });
  }
}

/** Membres actifs ayant l'un des rôles donnés (chef d'atelier, gérant…). */
export async function membersWithRoles(tx: Tx, roles: string[]): Promise<string[]> {
  const members = await tx.membership.findMany({
    where: { isActive: true, role: { in: roles as never } },
    select: { id: true },
  });
  return members.map((m) => m.id);
}

// ───────────── Kilométrage (M02 RG-M02-09) ─────────────

export async function recordRepairOrderMileage(
  tx: Tx,
  input: {
    organizationId: string;
    vehicleId: string;
    repairOrderId: string;
    mileage: number;
    readAt: Date;
    membershipId: string;
    confirm?: boolean;
    /** Restitution : ne pas refuser un km identique au relevé de réception. */
  },
): Promise<void> {
  const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId } });
  if (!vehicle) notFound("Véhicule introuvable.");
  if (vehicle.currentMileage != null && input.mileage < vehicle.currentMileage) {
    badRequest(
      `Kilométrage inférieur au dernier relevé (${vehicle.currentMileage} km). Vérifiez la saisie.`,
    );
  }
  if (vehicle.currentMileage != null && vehicle.currentMileageAt && !input.confirm) {
    const days = Math.max(
      1,
      (input.readAt.getTime() - vehicle.currentMileageAt.getTime()) / 86_400_000,
    );
    if ((input.mileage - vehicle.currentMileage) / days > 1000) {
      badRequest(
        `${Math.round(input.mileage - vehicle.currentMileage)} km en ${Math.round(days)} j : saisie correcte ? Confirmez le kilométrage.`,
      );
    }
  }
  await tx.mileageReading.create({
    data: {
      organizationId: input.organizationId,
      vehicleId: vehicle.id,
      mileage: input.mileage,
      readAt: input.readAt,
      source: "RECEPTION",
      repairOrderId: input.repairOrderId,
      createdById: input.membershipId,
    },
  });
  const readings = await tx.mileageReading.findMany({ where: { vehicleId: vehicle.id } });
  const { avgKmPerDay } = computeAvgKmPerDay(readings, vehicle.usage, input.readAt);
  const serviceDue = computeNextServiceDue({
    lastServiceDate: vehicle.lastServiceDate,
    lastServiceMileage: vehicle.lastServiceMileage,
    serviceIntervalKm: vehicle.serviceIntervalKm,
    serviceIntervalMonths: vehicle.serviceIntervalMonths,
    currentMileage: input.mileage,
    currentMileageAt: input.readAt,
    avgKmPerDay,
    today: input.readAt,
  });
  await tx.vehicle.update({
    where: { id: vehicle.id },
    data: {
      currentMileage: input.mileage,
      currentMileageAt: input.readAt,
      avgKmPerDay,
      estimatedMileage: input.mileage + vehicle.odometerOffset,
      nextServiceDueDate: serviceDue.nextServiceDueDate,
      nextServiceDueMileage: serviceDue.nextServiceDueMileage,
      nextServiceTrigger: serviceDue.trigger,
    },
  });
  await emitDomainEvent(tx as never, input.organizationId, "vehicle.mileage_recorded", {
    vehicleId: vehicle.id,
    repairOrderId: input.repairOrderId,
    mileage: input.mileage,
  });
}

// ───────────── Lien de suivi (A2 : PortalToken) ─────────────

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Crée un jeton portail `REPAIR_ORDER` (90 jours) ; `RepairOrder.publicToken` = hash. */
export async function createTrackingToken(
  tx: Tx,
  input: {
    organizationId: string;
    repairOrderId: string;
    customerId: string;
    createdById: string | null;
    now: Date;
  },
): Promise<{ token: string; trackingUrl: string; receptionUrl: string }> {
  const token = randomBytes(24).toString("base64url");
  const tokenHash = hashToken(token);
  await tx.portalToken.create({
    data: {
      organizationId: input.organizationId,
      tokenHash,
      scope: "REPAIR_ORDER",
      targetId: input.repairOrderId,
      customerId: input.customerId,
      createdById: input.createdById,
      expiresAt: new Date(input.now.getTime() + 90 * 86_400_000),
    },
  });
  await tx.repairOrder.update({
    where: { id: input.repairOrderId },
    data: { publicToken: tokenHash },
  });
  return {
    token,
    trackingUrl: `${appUrl()}/p/${token}/suivi`,
    receptionUrl: `${appUrl()}/p/${token}/reception`,
  };
}

/** Résout un jeton public (portail) → OR, hors contexte locataire (lecture par hash). */
export async function resolvePortalToken(token: string, now: Date) {
  const record = await adminDb.portalToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (
    !record ||
    record.scope !== "REPAIR_ORDER" ||
    record.status !== "ACTIVE" ||
    record.expiresAt.getTime() < now.getTime()
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lien expiré ou invalide." });
  }
  await adminDb.portalToken.update({
    where: { id: record.id },
    data: {
      openCount: { increment: 1 },
      lastOpenedAt: now,
      firstOpenedAt: record.firstOpenedAt ?? now,
    },
  });
  return record;
}

// ───────────── Contrôle du crédit (RG-M09-10) ─────────────

const ACTIVE_CASE_STATUSES = ["OPEN", "PROMISED", "PAUSED", "DISPUTED", "ESCALATED"] as const;

export async function customerCredit(
  tx: Tx,
  org: OrgRoContext,
  customerId: string,
  additionalAmount: number,
  now: Date,
) {
  const customer = await tx.customer.findFirst({ where: { id: customerId } });
  if (!customer) notFound("Client introuvable.");
  const [invoices, kase] = await Promise.all([
    tx.invoice.findMany({
      where: { customerId, billTo: "CUSTOMER", status: { in: [...OPEN_INVOICE_STATUSES] } },
      select: {
        id: true,
        customerId: true,
        type: true,
        status: true,
        billTo: true,
        balance: true,
        dueDate: true,
      },
    }),
    tx.collectionCase.findFirst({
      where: { customerId, status: { in: [...ACTIVE_CASE_STATUSES] } },
    }),
  ]);
  const exposure = customerExposure(invoices as AgingInvoice[], businessDate(now, org.timeZone));
  const check = creditCheck({
    totalDue: exposure.totalDue,
    overdueDue: exposure.overdueDue,
    maxDaysOverdue: exposure.maxDaysOverdue,
    creditLimit: customer.creditLimit,
    creditHold: customer.creditHold,
    caseEscalated: kase?.status === "ESCALATED" || Boolean(kase?.escalatedAt),
    additionalAmount,
    blockAfterDays: org.blockAfterDays,
  });
  return { customer, exposure, check };
}
