// M04 §8 — routeur `repairOrder` : liste, tableau, fiche, réception, transitions, QC,
// restitution, garantie et retours, lien de suivi, paramètres. La logique de décision
// (machine à états, montants, garanties, restitution) est dans `@atelieros/core`.
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  ACTIVE_REPAIR_ORDER_STATUSES,
  availableTransitions,
  BOARD_STATUSES,
  businessDate,
  canDeliver,
  checkInIssues,
  complaintCategories,
  customerExposure,
  decideLineApproval,
  evaluateQc,
  formatDate,
  formatFCFA,
  isLate,
  isProbableComeback,
  isUnderWarranty,
  isWorkableLine,
  lineAmounts,
  OPEN_INVOICE_STATUSES,
  repairOrderTotals,
  storageFee,
  suggestPromisedAt,
  warrantyFor,
  type AgingInvoice,
  type RepairOrderStatus,
  type SignatureMode,
  type TransitionContext,
} from "@atelieros/core";
import { adminDb, db, type Prisma, type RepairOrder, type ScopedTenantClient } from "@atelieros/db";
import {
  boardInputSchema,
  checkInInputSchema,
  createDraftInputSchema,
  deliverInputSchema,
  listRepairOrdersInputSchema,
  markComebackInputSchema,
  qcInputSchema,
  receptionLookupInputSchema,
  repairOrderIdInputSchema,
  repairOrderSettingsInputSchema,
  sendTrackingLinkInputSchema,
  storageFeeInputSchema,
  transitionInputSchema,
  updateRepairOrderInputSchema,
  uploadAttachmentInputSchema,
  warrantyDecisionInputSchema,
  type CheckInData,
  type LineInput,
} from "@atelieros/validators";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { searchCustomers, searchVehicles } from "../customers/trigram";
import { emitDomainEvent } from "../events/emit";
import { messagingEnqueue } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";
import {
  applyTransition,
  assertRoModule,
  assertTransition,
  badRequest,
  createTrackingToken,
  customerCredit,
  loadOrgRoContext,
  membersWithRoles,
  nextRepairOrderNumber,
  notFound,
  notify,
  recomputeTotals,
  recordRepairOrderMileage,
  roNow,
  transitionFacts,
  type OrgRoContext,
} from "../repairOrders/helpers";
import {
  completeAppointmentForRepairOrder,
  linkRepairOrderToAppointment,
} from "../appointments/service";
import { buildLineData } from "../repairOrders/lines";
import { getAttachmentStorage } from "../storage";
import { orgProcedure, requirePermission, requireSite, router } from "../trpc";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "../context";

type Tx = ScopedTenantClient;
type OrgCtx = Ctx & {
  user: CtxUser;
  session: CtxSession;
  membership: CtxMembership;
  organizationId: string;
};

const SERVICE_PATTERN = /vidange|r[ée]vision|entretien/i;

function siteFilter(ctx: OrgCtx): Prisma.RepairOrderWhereInput {
  return ctx.allowedSiteIds === "ALL" ? {} : { siteId: { in: ctx.allowedSiteIds } };
}

async function loadOrder(tx: Tx, ctx: OrgCtx, id: string): Promise<RepairOrder> {
  const order = await tx.repairOrder.findFirst({ where: { id, deletedAt: null } });
  if (!order) notFound();
  requireSite(ctx, order.siteId);
  return order;
}

function transitionCtx(ctx: OrgCtx, org: OrgRoContext): TransitionContext {
  return { permissions: ctx.permissions, qcRequired: org.settings.qcRequired };
}

/** Enfile un message transactionnel (M11) ; le job BullMQ est ajouté après commit. */
async function sendTransactional(
  tx: Tx,
  organizationId: string,
  input: {
    idempotencyKey: string;
    customer: {
      id: string;
      phone: string | null;
      whatsappPhone: string | null;
      email: string | null;
      displayName: string;
    };
    body: string;
    sentById: string | null;
    channels?: ("WHATSAPP" | "SMS" | "EMAIL")[];
  },
): Promise<string | null> {
  const result = await messagingEnqueue(tx, organizationId, {
    idempotencyKey: input.idempotencyKey,
    kind: "transactional",
    customerId: input.customer.id,
    to: {
      phone: input.customer.phone,
      whatsapp: input.customer.whatsappPhone ?? input.customer.phone,
      email: input.customer.email,
      name: input.customer.displayName,
    },
    channels: input.channels ?? ["WHATSAPP", "SMS"],
    bodyOverride: input.body,
    subjectOverride: "Suivi de votre véhicule",
    sentById: input.sentById,
  });
  if ("message" in result && result.created) return result.message.id;
  return null;
}

async function flushMessages(ids: (string | null)[]): Promise<void> {
  for (const id of ids) {
    if (!id) continue;
    try {
      await enqueueMessageSendJob(id);
    } catch {
      // Redis indisponible : le message reste QUEUED, repris par le worker (M11).
    }
  }
}

async function storeSignature(
  tx: Tx,
  organizationId: string,
  entityId: string,
  dataUrl: string,
  membershipId: string | null,
): Promise<string> {
  const [meta, base64] = dataUrl.split(",", 2);
  const mimeType = meta!.slice(5, meta!.indexOf(";"));
  const body = Buffer.from(base64 ?? "", "base64");
  const ext = mimeType.split("/")[1];
  const key = `${organizationId}/repair-orders/${entityId}/signature-${randomUUID()}.${ext}`;
  await getAttachmentStorage().upload({ key, body, contentType: mimeType, maxBytes: 1_000_000 });
  const attachment = await tx.attachment.create({
    data: {
      organizationId,
      entity: "repair_order",
      entityId,
      kind: "signature",
      url: key,
      mimeType,
      size: body.byteLength,
      createdById: membershipId,
    },
  });
  return `/api/attachments/${attachment.id}`;
}

function isOverdueOrder(order: { status: string; promisedAt: Date | null }, now: Date): boolean {
  return isLate({ status: order.status as RepairOrderStatus, promisedAt: order.promisedAt }, now);
}

const LIST_INCLUDE = {
  customer: { select: { id: true, displayName: true, phone: true } },
  vehicle: { select: { id: true, plate: true, make: true, model: true } },
  advisor: { select: { id: true, user: { select: { name: true } } } },
  lines: {
    where: { status: { not: "CANCELLED" } },
    select: {
      type: true,
      status: true,
      approval: true,
      isCustomerSupplied: true,
      productId: true,
      assignedTo: { select: { id: true, user: { select: { name: true } } } },
    },
  },
} satisfies Prisma.RepairOrderInclude;

type ListRow = Prisma.RepairOrderGetPayload<{ include: typeof LIST_INCLUDE }>;

function toCard(order: ListRow, now: Date) {
  const mechanics = new Map<string, string>();
  for (const l of order.lines) {
    if (l.assignedTo) mechanics.set(l.assignedTo.id, l.assignedTo.user.name);
  }
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    priority: order.priority,
    createdAt: order.createdAt,
    promisedAt: order.promisedAt,
    totalEstimate: order.totalEstimate,
    isComeback: order.isComeback,
    customer: order.customer,
    vehicle: order.vehicle,
    advisorName: order.advisor?.user.name ?? null,
    mechanics: [...mechanics.values()],
    late: isOverdueOrder(order, now),
    pendingApproval: order.lines.some((l) => l.approval === "PENDING"),
    waitingParts: order.status === "WAITING_PARTS",
    signaturePending: Boolean(
      (order.checkIn as { remoteSignaturePending?: boolean } | null)?.remoteSignaturePending,
    ),
  };
}

function listWhere(
  ctx: OrgCtx,
  input: z.infer<typeof listRepairOrdersInputSchema> | z.infer<typeof boardInputSchema>,
  now: Date,
): Prisma.RepairOrderWhereInput {
  const where: Prisma.RepairOrderWhereInput = { deletedAt: null, ...siteFilter(ctx) };
  if (input.siteId) where.siteId = input.siteId;
  if (input.priority) where.priority = input.priority;
  const mechanicId =
    input.mechanicId ??
    (input.mine && ctx.membership.role === "MECHANIC" ? ctx.membership.id : undefined);
  const and: Prisma.RepairOrderWhereInput[] = [];
  if (mechanicId) and.push({ lines: { some: { assignedToId: mechanicId } } });
  if (input.mine && ctx.membership.role !== "MECHANIC") {
    and.push({
      OR: [
        { advisorId: ctx.membership.id },
        { lines: { some: { assignedToId: ctx.membership.id } } },
      ],
    });
  }
  // M04 §10 : le mécanicien ne voit que ses OR.
  if (ctx.membership.role === "MECHANIC") {
    and.push({ lines: { some: { assignedToId: ctx.membership.id } } });
  }
  if (input.late) {
    and.push({
      promisedAt: { lt: now },
      status: {
        in: [
          "CHECKED_IN",
          "DIAGNOSING",
          "AWAITING_APPROVAL",
          "APPROVED",
          "IN_PROGRESS",
          "WAITING_PARTS",
          "QUALITY_CHECK",
        ],
      },
    });
  }
  if ("comeback" in input && input.comeback) where.isComeback = true;
  if ("advisorId" in input && input.advisorId) where.advisorId = input.advisorId;
  if ("statuses" in input && input.statuses?.length) where.status = { in: input.statuses };
  if ("q" in input && input.q) {
    const q = input.q;
    const compact = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
    and.push({
      OR: [
        { number: { contains: q, mode: "insensitive" } },
        { customer: { displayName: { contains: q, mode: "insensitive" } } },
        ...(compact ? [{ vehicle: { plateCompact: { contains: compact } } }] : []),
      ],
    });
  }
  if (and.length) where.AND = and;
  return where;
}

/** Données de restitution (RG-M04-14) : solde client, encours, motif de blocage. */
async function deliveryFacts(tx: Tx, org: OrgRoContext, order: RepairOrder, now: Date) {
  const [invoices, customer, lines] = await Promise.all([
    tx.invoice.findMany({
      where: { repairOrderId: order.id, status: { notIn: ["DRAFT", "VOID"] } },
      select: { id: true, number: true, status: true, balance: true, total: true },
    }),
    tx.customer.findFirstOrThrow({ where: { id: order.customerId } }),
    tx.repairOrderLine.findMany({ where: { repairOrderId: order.id } }),
  ]);
  const totals = repairOrderTotals(lines, org.vatEnabled);
  const invoiceIssued = invoices.length > 0;
  const customerBalance = invoiceIssued
    ? invoices.reduce((s, i) => s + i.balance, 0)
    : totals.totalEstimate;
  const open = await tx.invoice.findMany({
    where: {
      customerId: order.customerId,
      billTo: "CUSTOMER",
      status: { in: [...OPEN_INVOICE_STATUSES] },
      NOT: { repairOrderId: order.id },
    },
    select: {
      id: true,
      customerId: true,
      type: true,
      status: true,
      billTo: true,
      balance: true,
      dueDate: true,
    },
  });
  const outstanding = customerExposure(
    open as AgingInvoice[],
    businessDate(now, org.timeZone),
  ).totalDue;
  return { invoices, invoiceIssued, customer, customerBalance, outstanding, totals };
}

function parseCheckIn(
  order: Pick<RepairOrder, "checkIn">,
): Partial<CheckInData> & Record<string, unknown> {
  const raw = order.checkIn;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Partial<CheckInData> & Record<string, unknown>)
    : {};
}

export const repairOrderRouter = router({
  list: requirePermission("repair_order:read")
    .input(listRepairOrdersInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const where = listWhere(ctx, input, now);
      const rows = await tenantDb.repairOrder.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const items = rows.slice(0, input.limit).map((r) => toCard(r, now));
      const counterBase = listWhere(ctx, { ...input, statuses: undefined, late: undefined }, now);
      const [active, awaiting, waitingParts, ready, late] = await Promise.all([
        tenantDb.repairOrder.count({
          where: {
            ...counterBase,
            status: { in: [...BOARD_STATUSES].filter((s) => s !== "READY") },
          },
        }),
        tenantDb.repairOrder.count({ where: { ...counterBase, status: "AWAITING_APPROVAL" } }),
        tenantDb.repairOrder.count({ where: { ...counterBase, status: "WAITING_PARTS" } }),
        tenantDb.repairOrder.count({ where: { ...counterBase, status: "READY" } }),
        tenantDb.repairOrder.count({
          where: listWhere(ctx, { ...input, statuses: undefined, late: true }, now),
        }),
      ]);
      return {
        items,
        nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.id : null,
        counters: { active, awaitingApproval: awaiting, waitingParts, ready, late },
        timeZone: org.timeZone,
      };
    }),

  board: requirePermission("repair_order:read")
    .input(boardInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const rows = await tenantDb.repairOrder.findMany({
        where: { ...listWhere(ctx, input, now), status: { in: [...BOARD_STATUSES] } },
        include: LIST_INCLUDE,
        orderBy: [{ promisedAt: "asc" }, { createdAt: "asc" }],
        take: 300,
      });
      const cards = rows.map((r) => toCard(r, now));
      return {
        columns: BOARD_STATUSES.map((status) => ({
          status,
          cards: cards.filter((c) => c.status === status),
        })),
        timeZone: org.timeZone,
      };
    }),

  get: requirePermission("repair_order:read")
    .input(repairOrderIdInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const base = await loadOrder(tx, ctx, input.id);
        const order = await tx.repairOrder.findFirstOrThrow({
          where: { id: base.id },
          include: {
            customer: true,
            vehicle: true,
            site: { select: { id: true, name: true, code: true } },
            advisor: { select: { id: true, user: { select: { name: true } } } },
            qcBy: { select: { id: true, user: { select: { name: true } } } },
            comebackOf: { select: { id: true, number: true, deliveredAt: true } },
            lines: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              include: {
                assignedTo: { select: { id: true, user: { select: { name: true } } } },
                laborOperation: { select: { id: true, code: true, standardHours: true } },
                product: { select: { id: true, sku: true, minSalePrice: true } },
              },
            },
            inspections: {
              orderBy: { createdAt: "desc" },
              include: {
                items: { orderBy: { sortOrder: "asc" } },
                template: { select: { name: true } },
              },
            },
            statusHistory: { orderBy: { createdAt: "asc" } },
            quotes: {
              where: { deletedAt: null },
              orderBy: [{ number: "desc" }, { version: "desc" }],
              select: {
                id: true,
                number: true,
                version: true,
                status: true,
                total: true,
                sentAt: true,
              },
            },
            invoices: {
              select: { id: true, number: true, status: true, total: true, balance: true },
            },
            timeEntries: {
              select: {
                id: true,
                startedAt: true,
                endedAt: true,
                pauseMinutes: true,
                repairOrderLineId: true,
                membership: { select: { user: { select: { name: true } } } },
              },
            },
          },
        });
        const [attachments, facts, messages, audit, members, movements] = await Promise.all([
          tx.attachment.findMany({
            where: { entity: "repair_order", entityId: order.id },
            orderBy: { createdAt: "asc" },
            select: { id: true, kind: true, mimeType: true, caption: true, createdAt: true },
          }),
          transitionFacts(tx, order),
          tx.message.findMany({
            where: { customerId: order.customerId, createdAt: { gte: order.createdAt } },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { id: true, channel: true, status: true, body: true, createdAt: true },
          }),
          tx.auditLog.findMany({
            where: { entity: "RepairOrder", entityId: order.id },
            orderBy: { createdAt: "desc" },
            take: 30,
            select: { id: true, action: true, reason: true, createdAt: true, membershipId: true },
          }),
          tx.membership.findMany({
            where: { isActive: true },
            select: { id: true, role: true, user: { select: { name: true } } },
          }),
          tx.stockMovement.findMany({
            where: { repairOrderId: order.id },
            select: { id: true, productId: true, type: true, quantity: true, createdAt: true },
          }),
        ]);
        const names = new Map(members.map((m) => [m.id, m.user.name]));
        const totals = repairOrderTotals(order.lines, org.vatEnabled);
        const tctx = { ...transitionCtx(ctx, org), ...facts };
        const delivery =
          order.status === "READY" || order.status === "QUALITY_CHECK"
            ? await deliveryFacts(tx, org, order, now)
            : null;
        const deliveryCheck = delivery
          ? canDeliver({
              customerBalance: delivery.customerBalance,
              invoiceIssued: delivery.invoiceIssued,
              paymentTermsDays: delivery.customer.paymentTermsDays,
              creditLimit: delivery.customer.creditLimit,
              outstanding: delivery.outstanding,
              cashOnly: order.cashOnly,
              creditHold: delivery.customer.creditHold,
              canForceUnpaid: false,
            })
          : null;
        // US-M04-14 : lignes de l'OR d'origine encore sous garantie.
        const comebackLines = order.comebackOfId
          ? (
              await tx.repairOrderLine.findMany({
                where: { repairOrderId: order.comebackOfId, status: { not: "CANCELLED" } },
              })
            ).filter((l) =>
              isUnderWarranty(l, businessDate(now, org.timeZone), order.mileageIn ?? null),
            )
          : [];
        const canSeeCost =
          ctx.permissions.has("product:view_cost") && ctx.permissions.has("report:read");
        const hideForMechanic =
          ctx.membership.role === "MECHANIC" && !ctx.permissions.has("repair_order:update");
        return {
          ...order,
          internalNotes: hideForMechanic ? null : order.internalNotes,
          lines: order.lines.map((l) => ({
            ...l,
            costPrice: canSeeCost ? l.costPrice : null,
            amounts: lineAmounts(l, org.vatEnabled),
          })),
          checkIn: parseCheckIn(order),
          totals,
          vatEnabled: org.vatEnabled,
          timeZone: org.timeZone,
          late: isOverdueOrder(order, now),
          attachments,
          transitions: availableTransitions(order, order.lines, tctx),
          facts,
          delivery: delivery
            ? {
                customerBalance: delivery.customerBalance,
                invoiceIssued: delivery.invoiceIssued,
                paymentTermsDays: delivery.customer.paymentTermsDays,
                check: deliveryCheck,
              }
            : null,
          comebackLines,
          messages,
          audit: audit.map((a) => ({
            ...a,
            by: a.membershipId ? (names.get(a.membershipId) ?? null) : null,
          })),
          history: order.statusHistory.map((h) => ({
            ...h,
            by: h.membershipId ? (names.get(h.membershipId) ?? null) : null,
          })),
          stockMovements: movements,
          members: members.map((m) => ({ id: m.id, role: m.role, name: m.user.name })),
          settings: {
            qcRequired: org.settings.qcRequired,
            qcChecklist: org.settings.qcChecklist,
            storageFeeEnabled: org.settings.storageFeeEnabled,
          },
        };
      });
    }),

  /** US-M04-01 étape 1 : recherche plaque / téléphone / nom avec alertes. */
  receptionLookup: requirePermission("repair_order:create")
    .input(receptionLookupInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgRoContext(ctx.organizationId);
      const now = roNow();
      const today = businessDate(now, org.timeZone);
      const [vehicleHits, customerHits] = await Promise.all([
        searchVehicles(ctx.organizationId, input.q, 8),
        searchCustomers(ctx.organizationId, input.q, 8),
      ]);
      const vehicleIds = new Set(vehicleHits.map((v) => v.id));
      const customerIds = [
        ...new Set([...customerHits.map((c) => c.id), ...vehicleHits.map((v) => v.customerId)]),
      ];
      const vehicles = await tenantDb.vehicle.findMany({
        where: {
          deletedAt: null,
          OR: [
            { id: { in: [...vehicleIds] } },
            { customerId: { in: customerHits.map((c) => c.id) } },
          ],
        },
        include: { customer: true },
        take: 20,
      });
      const [openOrders, invoices, noShows, delivered] = await Promise.all([
        tenantDb.repairOrder.findMany({
          where: {
            vehicleId: { in: vehicles.map((v) => v.id) },
            status: { in: [...ACTIVE_REPAIR_ORDER_STATUSES] },
            deletedAt: null,
          },
          select: { id: true, number: true, vehicleId: true, status: true },
        }),
        tenantDb.invoice.findMany({
          where: {
            customerId: { in: customerIds },
            billTo: "CUSTOMER",
            status: { in: [...OPEN_INVOICE_STATUSES] },
          },
          select: { customerId: true, balance: true },
        }),
        tenantDb.appointment.groupBy({
          by: ["customerId"],
          where: { customerId: { in: customerIds }, status: "NO_SHOW" },
          _count: { _all: true },
        }),
        tenantDb.repairOrder.findMany({
          where: {
            vehicleId: { in: vehicles.map((v) => v.id) },
            status: { in: ["DELIVERED", "INVOICED"] },
          },
          orderBy: { deliveredAt: "desc" },
          select: {
            id: true,
            number: true,
            vehicleId: true,
            deliveredAt: true,
            complaint: true,
            mileageIn: true,
          },
        }),
      ]);
      const deliveredIds = delivered.map((d) => d.id);
      const warrantyLines = deliveredIds.length
        ? await tenantDb.repairOrderLine.findMany({
            where: { repairOrderId: { in: deliveredIds }, warrantyUntilDate: { gte: today } },
            select: { repairOrderId: true },
          })
        : [];
      const underWarranty = new Set(warrantyLines.map((l) => l.repairOrderId));
      return vehicles.map((v) => {
        const balance = invoices
          .filter((i) => i.customerId === v.customerId)
          .reduce((s, i) => s + i.balance, 0);
        const lastDelivered = delivered.find((d) => d.vehicleId === v.id) ?? null;
        const inspectionDays = v.inspectionExpiryDate
          ? Math.round((v.inspectionExpiryDate.getTime() - today.getTime()) / 86_400_000)
          : null;
        return {
          vehicle: {
            id: v.id,
            plate: v.plate,
            make: v.make,
            model: v.model,
            year: v.year,
            currentMileage: v.currentMileage,
          },
          customer: {
            id: v.customer.id,
            displayName: v.customer.displayName,
            phone: v.customer.phone,
            type: v.customer.type,
          },
          alerts: {
            inspectionInDays: inspectionDays,
            serviceDue: Boolean(
              (v.nextServiceDueDate && v.nextServiceDueDate.getTime() <= today.getTime()) ||
              (v.nextServiceDueMileage != null &&
                v.currentMileage != null &&
                v.currentMileage >= v.nextServiceDueMileage),
            ),
            balanceDue: balance,
            noShows: noShows.find((n) => n.customerId === v.customerId)?._count._all ?? 0,
            openOrder: openOrders.find((o) => o.vehicleId === v.id) ?? null,
            previousUnderWarranty:
              lastDelivered && underWarranty.has(lastDelivered.id) ? lastDelivered : null,
            probableComeback:
              lastDelivered?.deliveredAt &&
              isProbableComeback({
                previousDeliveredAt: lastDelivered.deliveredAt,
                previousMileage: lastDelivered.mileageIn,
                previousCategories: complaintCategories(lastDelivered.complaint),
                now,
                mileage: null,
                categories: complaintCategories(lastDelivered.complaint),
              })
                ? lastDelivered
                : null,
          },
        };
      });
    }),

  /** Recherche catalogue MO / pièces pour l'ajout de lignes et les recommandations. */
  catalog: requirePermission("repair_order:read")
    .input(z.object({ q: z.string().trim().max(60).default(""), kind: z.enum(["LABOR", "PART"]) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgRoContext(ctx.organizationId);
      if (input.kind === "LABOR") {
        const ops = await tenantDb.laborOperation.findMany({
          where: {
            isActive: true,
            ...(input.q
              ? {
                  OR: [
                    { name: { contains: input.q, mode: "insensitive" } },
                    { code: { contains: input.q, mode: "insensitive" } },
                  ],
                }
              : {}),
          },
          orderBy: { name: "asc" },
          take: 20,
        });
        return ops.map((op) => ({
          id: op.id,
          kind: "LABOR" as const,
          code: op.code,
          name: op.name,
          hours: op.standardHours,
          unitPrice: op.fixedPrice ?? org.laborRates[op.rateType],
          vatRate: org.vatRate,
          fixed: op.fixedPrice != null,
        }));
      }
      const products = await tenantDb.product.findMany({
        where: {
          isActive: true,
          ...(input.q
            ? {
                OR: [
                  { name: { contains: input.q, mode: "insensitive" } },
                  { sku: { contains: input.q, mode: "insensitive" } },
                  { oemReference: { contains: input.q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { name: "asc" },
        take: 20,
      });
      return products.map((p) => ({
        id: p.id,
        kind: "PART" as const,
        code: p.sku,
        name: p.name,
        hours: null,
        unitPrice: p.salePrice,
        vatRate: p.vatRate,
        fixed: false,
      }));
    }),

  comebackCandidates: requirePermission("repair_order:read")
    .input(z.object({ vehicleId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.repairOrder.findMany({
        where: { vehicleId: input.vehicleId, status: { in: ["DELIVERED", "INVOICED"] } },
        orderBy: { deliveredAt: "desc" },
        take: 10,
        select: { id: true, number: true, deliveredAt: true, complaint: true },
      });
    }),

  createDraft: requirePermission("repair_order:create")
    .input(createDraftInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const siteId = await resolveSiteId(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        await assertCustomerVehicle(tx, input.customerId, input.vehicleId);
        await assertSingleActive(tx, ctx, input.vehicleId, undefined, input.forceSecondActive);
        const number = await nextRepairOrderNumber(tx, org, siteId, now);
        const order = await tx.repairOrder.create({
          data: {
            organizationId: ctx.organizationId,
            siteId,
            number,
            customerId: input.customerId,
            vehicleId: input.vehicleId,
            appointmentId: input.appointmentId,
            complaint: input.complaint,
            advisorId: ctx.membership.id,
            createdById: ctx.membership.id,
            status: "DRAFT",
          },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "repair_order.created", {
          repairOrderId: order.id,
          customerId: order.customerId,
          vehicleId: order.vehicleId,
          appointmentId: order.appointmentId,
          status: "DRAFT",
        });
        return order;
      });
    }),

  /** US-M04-01 — réception complète, idempotente par `clientRequestId`. */
  checkIn: requirePermission("repair_order:create")
    .input(checkInInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const replay = await tenantDb.repairOrder.findFirst({
        where: { clientRequestId: input.clientRequestId },
        select: { id: true, number: true, status: true },
      });
      if (replay) return { ...replay, replayed: true, trackingUrl: null };

      const now = roNow();
      const siteId = await resolveSiteId(ctx, input.siteId);
      const checkIn = input.checkIn;
      const signatureMode: SignatureMode | null = !input.signature
        ? null
        : "dataUrl" in input.signature
          ? "SIGNED"
          : "remote" in input.signature
            ? "REMOTE"
            : "REFUSED";
      const photoCount = await tenantDb.attachment.count({
        where: {
          id: { in: checkIn.photoAttachmentIds },
          entityId: { in: [input.clientRequestId, ...(input.id ? [input.id] : [])] },
        },
      });
      const issues = checkInIssues({
        mileageIn: input.mileageIn,
        odometerUnreadable: Boolean(checkIn.odometerUnreadable),
        odometerReason: checkIn.odometerReason,
        fuelLevel: input.fuelLevel,
        photoCount,
        minPhotos: org.settings.minCheckInPhotos,
        noDamage: checkIn.noDamage,
        damageCount: checkIn.damages.length,
        complaint: input.complaint,
        signature: signatureMode,
      });
      if (issues.length > 0) badRequest(issues.map((i) => i.message).join(" "));

      // Signature stockée avant la transaction (stockage objet hors base).
      let signatureUrl: string | null = null;
      const pendingSignature =
        input.signature && "dataUrl" in input.signature ? input.signature : null;

      const result = await tenantDb.transaction(async (tx) => {
        const { customer, vehicle } = await assertCustomerVehicle(
          tx,
          input.customerId,
          input.vehicleId,
        );
        await assertSingleActive(tx, ctx, input.vehicleId, input.id, input.forceSecondActive);

        // RG-M09-10 : contrôle du crédit à l'ouverture de l'OR.
        const initialEstimate = (input.initialLines ?? []).reduce(
          (sum, l) =>
            sum +
            lineAmounts(
              {
                type: l.type,
                quantity: l.quantity,
                unitPrice: l.unitPrice ?? 0,
                discountRate: l.discountRate ?? 0,
                vatRate: l.vatRate ?? org.vatRate,
                status: "PENDING",
                approval: "APPROVED",
                payer: l.payer ?? "CUSTOMER",
                isCustomerSupplied: l.isCustomerSupplied,
              },
              org.vatEnabled,
            ).total,
          0,
        );
        const credit = await customerCredit(tx, org, customer.id, initialEstimate, now);
        let cashOnly = false;
        if (credit.check.level === "BLOCK") {
          const reason = input.creditOverrideReason?.trim();
          if (reason && ctx.permissions.has("receivable:credit_override")) {
            await tx.creditOverride.create({
              data: {
                organizationId: ctx.organizationId,
                customerId: customer.id,
                requestedById: ctx.membership.id,
                decidedById: ctx.membership.id,
                status: "GRANTED",
                reason,
                decidedAt: now,
              },
            });
          } else if (input.cashOnly) {
            cashOnly = true;
          } else {
            badRequest(
              `${credit.check.message ?? "Crédit bloqué."} Choisissez « Paiement comptant à la livraison » ou une dérogation.`,
            );
          }
        }

        let comebackOfId: string | null = null;
        if (input.comebackOfId) {
          const original = await tx.repairOrder.findFirst({
            where: {
              id: input.comebackOfId,
              vehicleId: vehicle.id,
              status: { in: ["DELIVERED", "INVOICED"] },
            },
          });
          if (!original) badRequest("OR d'origine introuvable pour ce véhicule.");
          comebackOfId = original.id;
        }

        const checkInJson: Record<string, unknown> = {
          ...checkIn,
          remoteSignaturePending: signatureMode === "REMOTE",
          signatureRefused: signatureMode === "REFUSED",
          ...(signatureMode === "REFUSED"
            ? { signatureRefusedBy: ctx.user.name, signatureRefusedAt: now.toISOString() }
            : {}),
          signerName: pendingSignature?.signerName,
        };

        const data = {
          siteId,
          customerId: customer.id,
          vehicleId: vehicle.id,
          appointmentId: input.appointmentId ?? null,
          advisorId: input.advisorId ?? ctx.membership.id,
          status: "CHECKED_IN" as const,
          priority: input.priority ?? "NORMAL",
          mileageIn: checkIn.odometerUnreadable ? null : (input.mileageIn ?? null),
          fuelLevel: input.fuelLevel,
          complaint: input.complaint,
          checkIn: checkInJson as unknown as Prisma.InputJsonValue,
          promisedAt:
            input.promisedAt ??
            suggestPromisedAt(
              now,
              org.timeZone,
              (input.initialLines ?? [])
                .filter((l) => l.type === "LABOR")
                .reduce((s, l) => s + l.quantity, 0),
            ),
          cashOnly,
          clientRequestId: input.clientRequestId,
          isComeback: Boolean(comebackOfId),
          comebackOfId,
          ...(pendingSignature ? { signedAt: now } : {}),
        };

        let order: RepairOrder;
        if (input.id) {
          const draft = await loadOrder(tx, ctx, input.id);
          assertTransition(draft, [], "check_in", transitionCtx(ctx, org));
          order = await tx.repairOrder.update({ where: { id: draft.id }, data });
        } else {
          const number = await nextRepairOrderNumber(tx, org, siteId, now);
          order = await tx.repairOrder.create({
            data: {
              ...data,
              organizationId: ctx.organizationId,
              number,
              createdById: ctx.membership.id,
            },
          });
          await emitDomainEvent(tx as never, ctx.organizationId, "repair_order.created", {
            repairOrderId: order.id,
            customerId: order.customerId,
            vehicleId: order.vehicleId,
            appointmentId: order.appointmentId,
            status: "CHECKED_IN",
          });
        }
        await tx.repairOrderStatusHistory.create({
          data: {
            organizationId: ctx.organizationId,
            repairOrderId: order.id,
            fromStatus: "DRAFT",
            toStatus: "CHECKED_IN",
            transition: "check_in",
            membershipId: ctx.membership.id,
          },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "repair_order.status_changed", {
          repairOrderId: order.id,
          customerId: order.customerId,
          vehicleId: order.vehicleId,
          from: "DRAFT",
          to: "CHECKED_IN",
          newStatus: "CHECKED_IN",
          at: now.toISOString(),
          byMembershipId: ctx.membership.id,
        });

        // Photos de la réception : rattachées à l'OR créé.
        await tx.attachment.updateMany({
          where: { entity: "repair_order_draft", entityId: input.clientRequestId },
          data: { entity: "repair_order", entityId: order.id },
        });

        // Lignes de la réception : approuvées si le client a signé (RG-M04-08).
        const approval = signatureMode === "SIGNED" ? "APPROVED" : "PENDING";
        let sort = await tx.repairOrderLine.count({ where: { repairOrderId: order.id } });
        for (const line of input.initialLines ?? []) {
          const lineData = await buildLineData(tx, ctx, org, order, customer, line as LineInput);
          await tx.repairOrderLine.create({
            data: {
              ...lineData,
              sortOrder: sort++,
              approval:
                lineData.payer === "WARRANTY" || lineData.payer === "INTERNAL"
                  ? "NOT_REQUIRED"
                  : approval,
              approvalSource: "CHECK_IN",
            },
          });
        }
        if (signatureMode === "SIGNED") {
          await tx.repairOrderLine.updateMany({
            where: { repairOrderId: order.id, approval: "PENDING" },
            data: { approval: "APPROVED", approvalSource: "CHECK_IN" },
          });
        }
        await recomputeTotals(tx, order.id, org.vatEnabled);

        if (data.mileageIn != null) {
          await recordRepairOrderMileage(tx, {
            organizationId: ctx.organizationId,
            vehicleId: vehicle.id,
            repairOrderId: order.id,
            mileage: data.mileageIn,
            readAt: now,
            membershipId: ctx.membership.id,
            confirm: input.confirmMileage,
          });
        }

        if (input.appointmentId) {
          // M03 : lien RDV → OR, ARRIVED seulement si le RDV était encore attendu.
          await linkRepairOrderToAppointment(tx as never, {
            organizationId: ctx.organizationId,
            appointmentId: input.appointmentId,
            repairOrderId: order.id,
            now,
          });
        }

        const link = await createTrackingToken(tx, {
          organizationId: ctx.organizationId,
          repairOrderId: order.id,
          customerId: customer.id,
          createdById: ctx.membership.id,
          now,
        });
        const vehicleLabel = `${vehicle.make} ${vehicle.model} (${vehicle.plate})`;
        const messageIds: (string | null)[] = [];
        messageIds.push(
          await sendTransactional(tx, ctx.organizationId, {
            idempotencyKey: `ro:${order.id}:checked_in`,
            customer,
            sentById: ctx.membership.id,
            body:
              signatureMode === "REMOTE"
                ? `Bonjour ${customer.displayName}, nous avons bien reçu votre ${vehicleLabel} — ${order.number}. Merci de signer le bon de réception : ${link.receptionUrl} . Suivi de la réparation : ${link.trackingUrl}`
                : `Bonjour ${customer.displayName}, nous avons bien reçu votre ${vehicleLabel} — ${order.number}. Suivez l'avancement de la réparation ici : ${link.trackingUrl}`,
          }),
        );
        return { order, messageIds, trackingUrl: link.trackingUrl };
      });

      if (pendingSignature) {
        signatureUrl = await tenantDb.transaction((tx) =>
          storeSignature(
            tx,
            ctx.organizationId,
            result.order.id,
            pendingSignature.dataUrl,
            ctx.membership.id,
          ),
        );
        await tenantDb.repairOrder.update({
          where: { id: result.order.id },
          data: { customerSignatureUrl: signatureUrl },
        });
      }
      await flushMessages(result.messageIds);
      return {
        id: result.order.id,
        number: result.order.number,
        status: result.order.status,
        replayed: false,
        trackingUrl: result.trackingUrl,
      };
    }),

  /** Photo compressée côté client (RG-M04-04) ; contrôle MIME et taille côté serveur. */
  uploadAttachment: orgProcedure
    .input(uploadAttachmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const allowed =
        ctx.permissions.has("repair_order:create") ||
        ctx.permissions.has("repair_order:update") ||
        ctx.permissions.has("inspection:perform") ||
        ctx.permissions.has("repair_order:deliver");
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Permission manquante : repair_order:update",
        });
      }
      if (!input.repairOrderId && !input.draftKey)
        badRequest("OR ou brouillon de réception requis.");
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      if (input.repairOrderId) {
        await tenantDb.transaction((tx) => loadOrder(tx, ctx, input.repairOrderId!));
      }
      const body = Buffer.from(input.dataBase64, "base64");
      const entityId = input.repairOrderId ?? input.draftKey!;
      const ext = input.mimeType.split("/")[1];
      const key = `${ctx.organizationId}/repair-orders/${entityId}/${input.kind}-${randomUUID()}.${ext}`;
      try {
        await getAttachmentStorage().upload({
          key,
          body,
          contentType: input.mimeType,
          maxBytes: 5_000_000,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          typeof (error as { code: unknown }).code === "string" &&
          (error as { code: string }).code.startsWith("storage.")
        ) {
          badRequest(error.message);
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Envoi de la photo impossible. Réessayez.",
        });
      }
      const attachment = await tenantDb.attachment.create({
        data: {
          organizationId: ctx.organizationId,
          entity: input.repairOrderId ? "repair_order" : "repair_order_draft",
          entityId,
          kind: input.kind,
          url: key,
          mimeType: input.mimeType,
          size: body.byteLength,
          caption: input.caption,
          createdById: ctx.membership.id,
        },
      });
      return { attachmentId: attachment.id, url: `/api/attachments/${attachment.id}` };
    }),

  update: requirePermission("repair_order:update")
    .input(updateRepairOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const out = await tenantDb.transaction(async (tx) => {
        const order = await loadOrder(tx, ctx, input.id);
        if (input.bayId !== undefined && !ctx.permissions.has("repair_order:assign")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Permission manquante : repair_order:assign",
          });
        }
        const updated = await tx.repairOrder.update({
          where: { id: order.id },
          data: {
            promisedAt: input.promisedAt,
            priority: input.priority,
            advisorId: input.advisorId,
            complaint: input.complaint,
            diagnosis: input.diagnosis,
            internalNotes: input.internalNotes,
            bayId: input.bayId,
          },
        });
        // RG-M04-10 : informer le client d'un nouveau délai.
        let messageId: string | null = null;
        if (
          input.notifyCustomer &&
          input.promisedAt &&
          order.promisedAt?.getTime() !== input.promisedAt.getTime()
        ) {
          const customer = await tx.customer.findFirstOrThrow({ where: { id: order.customerId } });
          const when = `${formatDate(input.promisedAt, org.timeZone)} à ${input.promisedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: org.timeZone })}`;
          messageId = await sendTransactional(tx, ctx.organizationId, {
            idempotencyKey: `ro:${order.id}:promise:${input.promisedAt.toISOString()}`,
            customer,
            sentById: ctx.membership.id,
            body: `Bonjour ${customer.displayName}, nouveau délai pour votre véhicule (${order.number}) : ${when}${input.delayReason ? ` — ${input.delayReason}` : ""}.`,
          });
        }
        void now;
        return { updated, messageId };
      });
      await flushMessages([out.messageId]);
      return out.updated;
    }),

  transition: requirePermission("repair_order:read")
    .input(transitionInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.transition === "qc_pass" || input.transition === "qc_reject") {
        badRequest("Utilisez l'écran de contrôle qualité.");
      }
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const order = await loadOrder(tx, ctx, input.id);
        const lines = await tx.repairOrderLine.findMany({ where: { repairOrderId: order.id } });
        const facts = await transitionFacts(tx, order);
        const to = assertTransition(order, lines, input.transition, {
          ...transitionCtx(ctx, org),
          ...facts,
          reason: input.reason,
        });
        const updated = await applyTransition(tx, {
          order,
          to,
          transition: input.transition,
          reason: input.reason,
          membershipId: ctx.membership.id,
          now,
        });
        if (input.transition === "cancel" || input.transition === "reopen") {
          await writeAuditLog({
            organizationId: ctx.organizationId,
            userId: ctx.user.id,
            membershipId: ctx.membership.id,
            siteId: order.siteId,
            action: `repair_order.${input.transition}`,
            entity: "RepairOrder",
            entityId: order.id,
            before: { status: order.status },
            after: { status: to },
            reason: input.reason,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        }
        if (to === "QUALITY_CHECK") {
          await notify(tx, ctx.organizationId, await membersWithRoles(tx, ["MANAGER"]), {
            type: "repair_order.qc_needed",
            title: `Contrôle qualité à faire — ${order.number}`,
            link: `/ordres/${order.id}/controle-qualite`,
          });
        }
        if (to === "WAITING_PARTS") {
          await notify(tx, ctx.organizationId, await membersWithRoles(tx, ["STOREKEEPER"]), {
            type: "repair_order.parts_needed",
            title: `Pièces à commander — ${order.number}`,
            link: `/ordres/${order.id}`,
          });
        }
        return updated;
      });
    }),

  /** US-M04-11 — contrôle qualité : validation (→ READY) ou refus (→ IN_PROGRESS). */
  qc: requirePermission("repair_order:qc")
    .input(qcInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const order = await loadOrder(tx, ctx, input.id);
        const lines = await tx.repairOrderLine.findMany({ where: { repairOrderId: order.id } });
        const evaluation = evaluateQc(org.settings.qcChecklist, input.checklist);
        const labels = new Map(org.settings.qcChecklist.map((i) => [i.key, i.label]));
        const qcChecklist = {
          items: input.checklist.map((c) => ({ ...c, label: labels.get(c.key) ?? c.key })),
          roadTest: input.roadTest ?? null,
          comment: input.comment ?? null,
        } as unknown as Prisma.InputJsonValue;

        if (input.reject) {
          const to = assertTransition(order, lines, "qc_reject", {
            ...transitionCtx(ctx, org),
            reason: input.comment,
          });
          const reopened = lines.filter((l) => input.rejectLineIds?.includes(l.id));
          for (const line of reopened) {
            await tx.repairOrderLine.update({
              where: { id: line.id },
              data: { status: "IN_PROGRESS", completedAt: null, completedById: null },
            });
          }
          await notify(
            tx,
            ctx.organizationId,
            reopened.map((l) => l.assignedToId),
            {
              type: "repair_order.qc_rejected",
              title: `Contrôle qualité refusé — ${order.number}`,
              body: input.comment,
              link: `/ordres/${order.id}`,
            },
          );
          return applyTransition(tx, {
            order,
            to,
            transition: "qc_reject",
            reason: input.comment,
            membershipId: ctx.membership.id,
            now,
            data: { qcChecklist },
          });
        }

        // RG-M04-13 : avertissement (non bloquant) si le contrôleur est le seul mécanicien.
        const to = assertTransition(order, lines, "qc_pass", {
          ...transitionCtx(ctx, org),
          qcPassed: evaluation.ok,
        });
        return applyTransition(tx, {
          order,
          to,
          transition: "qc_pass",
          membershipId: ctx.membership.id,
          now,
          data: { qcChecklist, qcBy: { connect: { id: ctx.membership.id } }, qcAt: now },
        });
      });
    }),

  /** US-M04-13 / RG-M04-14 — restitution du véhicule. */
  deliver: requirePermission("repair_order:deliver")
    .input(deliverInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const pre = await tenantDb.transaction((tx) => loadOrder(tx, ctx, input.id));
      const signatureUrl = input.signature
        ? await tenantDb.transaction((tx) =>
            storeSignature(
              tx,
              ctx.organizationId,
              pre.id,
              input.signature!.dataUrl,
              ctx.membership.id,
            ),
          )
        : null;
      return tenantDb.transaction(async (tx) => {
        const order = await loadOrder(tx, ctx, input.id);
        const lines = await tx.repairOrderLine.findMany({ where: { repairOrderId: order.id } });
        const to = assertTransition(order, lines, "deliver", {
          ...transitionCtx(ctx, org),
          reason: input.skipQcReason,
          forceFromQualityCheck: Boolean(input.skipQcReason),
        });
        const facts = await deliveryFacts(tx, org, order, now);
        const check = canDeliver({
          customerBalance: facts.customerBalance,
          invoiceIssued: facts.invoiceIssued,
          paymentTermsDays: facts.customer.paymentTermsDays,
          creditLimit: facts.customer.creditLimit,
          outstanding: facts.outstanding,
          cashOnly: order.cashOnly,
          creditHold: facts.customer.creditHold,
          forceUnpaidReason: input.forceUnpaidReason,
          canForceUnpaid: ctx.permissions.has("repair_order:deliver_unpaid"),
        });
        if (!check.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: check.message,
            cause:
              check.code === "UNPAID_BALANCE"
                ? { code: check.code, balance: check.balance }
                : { code: check.code, outstanding: check.outstanding, limit: check.limit },
          });
        }
        if (check.basis === "FORCED") {
          await writeAuditLog({
            organizationId: ctx.organizationId,
            userId: ctx.user.id,
            membershipId: ctx.membership.id,
            siteId: order.siteId,
            action: "repair_order.deliver_unpaid",
            entity: "RepairOrder",
            entityId: order.id,
            after: { balance: facts.customerBalance },
            reason: input.forceUnpaidReason,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
          await notify(tx, ctx.organizationId, await membersWithRoles(tx, ["OWNER"]), {
            type: "repair_order.delivered_unpaid",
            title: `Véhicule restitué impayé — ${order.number}`,
            body: `${formatFCFA(facts.customerBalance)} : ${input.forceUnpaidReason}`,
            link: `/ordres/${order.id}`,
          });
        }
        if (input.skipQcReason) {
          await writeAuditLog({
            organizationId: ctx.organizationId,
            userId: ctx.user.id,
            membershipId: ctx.membership.id,
            siteId: order.siteId,
            action: "repair_order.deliver_without_qc",
            entity: "RepairOrder",
            entityId: order.id,
            reason: input.skipQcReason,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        }

        // Kilométrage de sortie (relevé) et garanties figées (RG-M04-11).
        if (input.checkOut.mileage != null) {
          const vehicle = await tx.vehicle.findFirstOrThrow({ where: { id: order.vehicleId } });
          if (vehicle.currentMileage == null || input.checkOut.mileage > vehicle.currentMileage) {
            await recordRepairOrderMileage(tx, {
              organizationId: ctx.organizationId,
              vehicleId: order.vehicleId,
              repairOrderId: order.id,
              mileage: input.checkOut.mileage,
              readAt: now,
              membershipId: ctx.membership.id,
              confirm: true,
            });
          }
        }
        const deliveredOn = businessDate(now, org.timeZone);
        for (const line of lines.filter((l) => isWorkableLine(l))) {
          const terms = warrantyFor(line, deliveredOn, order.mileageIn, org.warranty);
          await tx.repairOrderLine.update({ where: { id: line.id }, data: terms });
        }

        const previous = parseCheckIn(order);
        const updated = await applyTransition(tx, {
          order,
          to,
          transition: "deliver",
          reason: input.forceUnpaidReason ?? input.skipQcReason,
          membershipId: ctx.membership.id,
          now,
          data: {
            deliveredAt: now,
            deliverySignatureUrl: signatureUrl,
            checkIn: {
              ...previous,
              checkOut: {
                ...input.checkOut,
                signatureUrl: signatureUrl ?? undefined,
                signerName: input.signature?.signerName,
                at: now.toISOString(),
              },
            } as unknown as Prisma.InputJsonValue,
          },
        });

        // Révision / vidange réalisée → échéance de révision (M02/M10).
        const serviceDone = lines.some(
          (l) => isWorkableLine(l) && SERVICE_PATTERN.test(l.description),
        );
        if (serviceDone) {
          await tx.vehicle.update({
            where: { id: order.vehicleId },
            data: {
              lastServiceDate: deliveredOn,
              lastServiceMileage: order.mileageIn ?? undefined,
            },
          });
          await emitDomainEvent(tx as never, ctx.organizationId, "vehicle.service_recorded", {
            vehicleId: order.vehicleId,
            repairOrderId: order.id,
            date: deliveredOn.toISOString().slice(0, 10),
            mileage: order.mileageIn,
          });
        }
        if (order.appointmentId) {
          // M03 §5 : OR livré → RDV COMPLETED (completedAt + appointment.completed).
          await completeAppointmentForRepairOrder(tx as never, {
            organizationId: ctx.organizationId,
            appointmentId: order.appointmentId,
            repairOrderId: order.id,
            now,
          });
        }
        // Facture déjà émise → INVOICED immédiatement (§5 invoice_issued).
        if (facts.invoiceIssued) {
          return applyTransition(tx, {
            order: updated,
            to: "INVOICED",
            transition: "invoice_issued",
            membershipId: null,
            now,
          });
        }
        return updated;
      });
    }),

  setWarrantyDecision: requirePermission("repair_order:warranty_decide")
    .input(warrantyDecisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const order = await loadOrder(tx, ctx, input.id);
        if (!order.isComeback) badRequest("Cet OR n'est pas un retour sur travaux.");
        const updated = await tx.repairOrder.update({
          where: { id: order.id },
          data: { warrantyDecision: input.decision, warrantyDecisionReason: input.reason },
        });
        // Sous garantie : lignes non facturées au client (payer = WARRANTY, NOT_REQUIRED).
        if (input.decision === "COVERED") {
          await tx.repairOrderLine.updateMany({
            where: { repairOrderId: order.id, status: { not: "CANCELLED" } },
            data: { payer: "WARRANTY", approval: "NOT_REQUIRED" },
          });
        }
        const org = await loadOrgRoContext(ctx.organizationId);
        await recomputeTotals(tx, order.id, org.vatEnabled);
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          siteId: order.siteId,
          action: "repair_order.warranty_decision",
          entity: "RepairOrder",
          entityId: order.id,
          before: { warrantyDecision: order.warrantyDecision },
          after: { warrantyDecision: input.decision },
          reason: input.reason,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return updated;
      });
    }),

  markComeback: requirePermission("repair_order:update")
    .input(markComebackInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgRoContext(ctx.organizationId);
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const order = await loadOrder(tx, ctx, input.id);
        const original = await tx.repairOrder.findFirst({
          where: {
            id: input.originalRepairOrderId,
            vehicleId: order.vehicleId,
            status: { in: ["DELIVERED", "INVOICED"] },
          },
        });
        if (!original || original.id === order.id)
          badRequest("OR d'origine introuvable pour ce véhicule.");
        const updated = await tx.repairOrder.update({
          where: { id: order.id },
          data: { isComeback: true, comebackOfId: original.id },
        });
        const originalLines = (
          await tx.repairOrderLine.findMany({
            where: { repairOrderId: original.id, status: { not: "CANCELLED" } },
          })
        ).filter((l) =>
          isUnderWarranty(l, businessDate(now, org.timeZone), order.mileageIn ?? null),
        );
        return { order: updated, linesUnderWarranty: originalLines };
      });
    }),

  sendTrackingLink: requirePermission("repair_order:update")
    .input(sendTrackingLinkInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      const out = await tenantDb.transaction(async (tx) => {
        const order = await loadOrder(tx, ctx, input.id);
        const customer = await tx.customer.findFirstOrThrow({ where: { id: order.customerId } });
        const link = await createTrackingToken(tx, {
          organizationId: ctx.organizationId,
          repairOrderId: order.id,
          customerId: customer.id,
          createdById: ctx.membership.id,
          now,
        });
        const messageId = await sendTransactional(tx, ctx.organizationId, {
          idempotencyKey: `ro:${order.id}:tracking:${now.getTime()}`,
          customer,
          sentById: ctx.membership.id,
          channels: input.channel ? [input.channel] : undefined,
          body: `Bonjour ${customer.displayName}, suivez l'avancement de votre véhicule (${order.number}) ici : ${link.trackingUrl}`,
        });
        return { messageId, trackingUrl: link.trackingUrl };
      });
      await flushMessages([out.messageId]);
      return out;
    }),

  /** RG-M04-15 — proposition de frais de gardiennage (jamais ajoutés automatiquement). */
  storageFee: requirePermission("repair_order:read")
    .input(storageFeeInputSchema)
    .query(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const order = await tenantDb.transaction((tx) => loadOrder(tx, ctx, input.id));
      if (!org.settings.storageFeeEnabled || order.status !== "READY" || !order.readyAt)
        return null;
      const holidays = await tenantDb.holiday.findMany({
        where: { OR: [{ siteId: null }, { siteId: order.siteId }] },
        select: { date: true },
      });
      return storageFee({
        readyOn: businessDate(order.readyAt, org.timeZone),
        today: businessDate(roNow(), org.timeZone),
        afterDays: org.settings.storageFeeAfterDays,
        perDay: org.settings.storageFeePerDay,
        holidays: holidays.map((h) => h.date),
      });
    }),

  addStorageFee: requirePermission("repair_order:update")
    .input(storageFeeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const order = await loadOrder(tx, ctx, input.id);
        if (!org.settings.storageFeeEnabled || order.status !== "READY" || !order.readyAt) {
          badRequest("Aucun frais de gardiennage à proposer.");
        }
        const holidays = await tx.holiday.findMany({
          where: { OR: [{ siteId: null }, { siteId: order.siteId }] },
          select: { date: true },
        });
        const fee = storageFee({
          readyOn: businessDate(order.readyAt, org.timeZone),
          today: businessDate(now, org.timeZone),
          afterDays: org.settings.storageFeeAfterDays,
          perDay: org.settings.storageFeePerDay,
          holidays: holidays.map((h) => h.date),
        });
        if (!fee) badRequest("Aucun frais de gardiennage à proposer.");
        const sortOrder = await tx.repairOrderLine.count({ where: { repairOrderId: order.id } });
        const line = await tx.repairOrderLine.create({
          data: {
            organizationId: ctx.organizationId,
            repairOrderId: order.id,
            type: "FEE",
            description: fee.description,
            quantity: fee.days,
            unitPrice: org.settings.storageFeePerDay,
            vatRate: org.vatEnabled ? org.vatRate : 0,
            approval: "APPROVED",
            approvalSource: "IN_PERSON",
            status: "DONE",
            sortOrder,
          },
        });
        await recomputeTotals(tx, order.id, org.vatEnabled);
        return line;
      });
    }),

  settings: requirePermission("repair_order:read").query(async ({ ctx }) => {
    const org = await loadOrgRoContext(ctx.organizationId);
    return { ...org.settings, laborRates: org.laborRates, warranty: org.warranty };
  }),

  updateSettings: requirePermission("settings:update")
    .input(repairOrderSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const raw = (
        org.rawSettings && typeof org.rawSettings === "object" ? org.rawSettings : {}
      ) as Record<string, unknown>;
      const { laborRates, warranty, ...repairOrders } = input;
      const before = {
        repairOrders: org.settings,
        laborRates: org.laborRates,
        warranty: org.warranty,
      };
      const next = {
        ...raw,
        repairOrders: { ...org.settings, ...repairOrders },
        labor: { ...((raw.labor as object) ?? {}), rates: { ...org.laborRates, ...laborRates } },
        warranty: { ...org.warranty, ...warranty },
      };
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { settings: next as unknown as Prisma.InputJsonValue },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "settings.repair_orders_updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        before,
        after: {
          repairOrders: next.repairOrders,
          laborRates: next.labor.rates,
          warranty: next.warranty,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      const after = await loadOrgRoContext(ctx.organizationId);
      return { ...after.settings, laborRates: after.laborRates, warranty: after.warranty };
    }),

  /** Lignes de suggestion d'approbation (utilisé par l'écran pour afficher l'effet du plafond). */
  approvalPreview: requirePermission("repair_order:read")
    .input(z.object({ id: z.string().min(1), lineTotal: z.number().int().min(0) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const order = await loadOrder(tx, ctx, input.id);
        const org = await loadOrgRoContext(ctx.organizationId);
        const lines = await tx.repairOrderLine.findMany({
          where: {
            repairOrderId: order.id,
            approvalSource: "PRE_AUTHORIZED",
            status: { not: "CANCELLED" },
          },
        });
        const preAuthorizedTotal = lines.reduce(
          (s, l) => s + lineAmounts(l, org.vatEnabled).total,
          0,
        );
        return decideLineApproval({
          payer: "CUSTOMER",
          phase: "AFTER_CHECK_IN",
          authorizationCeiling: parseCheckIn(order).authorizationCeiling ?? 0,
          preAuthorizedTotal,
          lineTotal: input.lineTotal,
        });
      });
    }),
});

async function resolveSiteId(ctx: OrgCtx, requested?: string): Promise<string> {
  const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
  const siteId = requested ?? ctx.session.activeSiteId ?? undefined;
  if (siteId) {
    requireSite(ctx, siteId);
    return siteId;
  }
  const site = await tenantDb.site.findFirst({
    where: {
      isActive: true,
      ...(ctx.allowedSiteIds === "ALL" ? {} : { id: { in: ctx.allowedSiteIds } }),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!site) badRequest("Aucun site actif : créez un site dans les paramètres.");
  return site.id;
}

async function assertCustomerVehicle(tx: Tx, customerId: string, vehicleId: string) {
  const [customer, vehicle] = await Promise.all([
    tx.customer.findFirst({ where: { id: customerId, deletedAt: null } }),
    tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } }),
  ]);
  if (!customer) notFound("Client introuvable.");
  if (!vehicle) notFound("Véhicule introuvable.");
  if (vehicle.customerId !== customer.id) badRequest("Ce véhicule n'appartient pas à ce client.");
  return { customer, vehicle };
}

/** RG-M04-02 : un seul OR actif par véhicule (forçable par le chef d'atelier). */
async function assertSingleActive(
  tx: Tx,
  ctx: OrgCtx,
  vehicleId: string,
  excludeId: string | undefined,
  force: boolean | undefined,
): Promise<void> {
  const active = await tx.repairOrder.findFirst({
    where: {
      vehicleId,
      deletedAt: null,
      status: { in: [...ACTIVE_REPAIR_ORDER_STATUSES] },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { number: true },
  });
  if (!active) return;
  if (force && ctx.permissions.has("repair_order:assign")) return;
  badRequest(`Ce véhicule a déjà un OR ouvert (${active.number}). Ajoutez-y les travaux.`);
}
