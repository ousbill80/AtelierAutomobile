// M06 §8 — routeur `tech` : PWA tablette du mécanicien. `bootstrap` fournit l'instantané mis en
// cache (IndexedDB), `sync` applique la file d'opérations hors-ligne, `uploadPhoto` envoie les
// photos de travaux. Un MECHANIC ne voit ni prix de vente ni coût horaire (§10).
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  businessDate,
  computeDurationMinutes,
  fromBaseQty,
  matchCompatibility,
  timeEntryState,
  WORKABLE_ORDER_STATUSES,
} from "@atelieros/core";
import { db, repairOrderLineStock, type Prisma } from "@atelieros/db";
import {
  techProductSearchInputSchema,
  techBootstrapInputSchema,
  techSyncInputSchema,
  techUploadPhotoInputSchema,
} from "@atelieros/validators";
import { assertRoModule, badRequest, loadOrgRoContext, roNow } from "../repairOrders/helpers";
import { getAttachmentStorage } from "../storage";
import { orgProcedure, requireSite, router } from "../trpc";
import { syncTechOps } from "../workshop/sync";

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;

function assertTabletUser(ctx: { permissions: Set<string> }) {
  if (
    !ctx.permissions.has("time:clock") &&
    !ctx.permissions.has("time:edit") &&
    !ctx.permissions.has("inspection:perform")
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Permission manquante : time:clock" });
  }
}

const tabletProcedure = orgProcedure.use(({ ctx, next }) => {
  assertTabletUser(ctx);
  return next({ ctx });
});

export const techRouter = router({
  /** Instantané pour le cache local (RG-M06-13) : mes tâches, présence, inspections ouvertes. */
  bootstrap: tabletProcedure.input(techBootstrapInputSchema).query(async ({ ctx, input }) => {
    const org = await loadOrgRoContext(ctx.organizationId);
    assertRoModule(org);
    if (input.siteId) requireSite(ctx, input.siteId);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const now = roNow();
    const me = ctx.membership.id;
    const siteWhere: Prisma.RepairOrderWhereInput = input.siteId
      ? { siteId: input.siteId }
      : ctx.allowedSiteIds === "ALL"
        ? {}
        : { siteId: { in: ctx.allowedSiteIds } };

    return tenantDb.transaction(async (tx) => {
      const openEntries = await tx.timeEntry.findMany({
        where: { membershipId: me, endedAt: null },
      });
      const openLineIds = openEntries
        .map((e) => e.repairOrderLineId)
        .filter((x): x is string => !!x);
      const lines = await tx.repairOrderLine.findMany({
        where: {
          repairOrder: {
            ...siteWhere,
            deletedAt: null,
            status: {
              in: [
                ...WORKABLE_ORDER_STATUSES,
                "QUALITY_CHECK",
                "CHECKED_IN",
                "DIAGNOSING",
                "AWAITING_APPROVAL",
              ],
            },
          },
          OR: [
            { assignedToId: me, status: { in: ["PENDING", "IN_PROGRESS"] } },
            { id: { in: openLineIds } },
          ],
        },
        include: {
          repairOrder: {
            include: {
              vehicle: { select: { plate: true, make: true, model: true, year: true } },
              customer: { select: { displayName: true } },
              lines: {
                where: { type: "PART" },
                select: { id: true, description: true, quantity: true, status: true },
              },
            },
          },
          workNotes: {
            orderBy: { createdAt: "asc" },
            select: { id: true, body: true, visibleToCustomer: true, createdAt: true },
          },
        },
      });
      const orderIds = [...new Set(lines.map((l) => l.repairOrderId))];
      const stockByOrder = new Map(
        await Promise.all(
          orderIds.map(async (id) => [id, await repairOrderLineStock(tx, id)] as const),
        ),
      );
      const photos = await tx.attachment.groupBy({
        by: ["entityId"],
        where: { entity: "repair_order_line", entityId: { in: lines.map((l) => l.id) } },
        _count: { _all: true },
      });
      const photoCount = new Map(photos.map((p) => [p.entityId, p._count._all]));
      const partRequests = await tx.partRequest.findMany({
        where: { repairOrderId: { in: orderIds }, requestedById: me },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          repairOrderId: true,
          freeText: true,
          quantity: true,
          status: true,
          product: { select: { name: true } },
        },
      });

      const tasks = lines
        .map((l) => {
          const order = l.repairOrder;
          const entry = openEntries.find((e) => e.repairOrderLineId === l.id) ?? null;
          const stock = stockByOrder.get(order.id) ?? [];
          return {
            id: l.id,
            description: l.description,
            type: l.type,
            status: l.status,
            standardHours: l.type === "LABOR" ? l.quantity : null,
            updatedAt: l.updatedAt,
            photoCount: photoCount.get(l.id) ?? 0,
            notes: l.workNotes,
            entry: entry
              ? {
                  id: entry.id,
                  startedAt: entry.startedAt,
                  pausedAt: entry.pausedAt,
                  pauseMinutes: entry.pauseMinutes,
                  state: timeEntryState(entry),
                  minutes: computeDurationMinutes(entry, now),
                }
              : null,
            order: {
              id: order.id,
              number: order.number,
              status: order.status,
              priority: order.priority,
              promisedAt: order.promisedAt,
              complaint: order.complaint,
              diagnosis: order.diagnosis,
              customerName: order.customer.displayName,
              vehicle: order.vehicle,
              parts: order.lines.map((p) => ({
                ...p,
                stockState: stock.find((s) => s.lineId === p.id)?.state ?? null,
              })),
              partRequests: partRequests
                .filter((r) => r.repairOrderId === order.id)
                .map((r) => ({
                  id: r.id,
                  label: r.product?.name ?? r.freeText ?? "",
                  quantity: r.quantity,
                  status: r.status,
                })),
            },
          };
        })
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.order.priority] - PRIORITY_RANK[b.order.priority] ||
            (a.order.promisedAt?.getTime() ?? Infinity) -
              (b.order.promisedAt?.getTime() ?? Infinity) ||
            a.order.number.localeCompare(b.order.number),
        );

      const inspections = await tx.inspection.findMany({
        where: {
          completedAt: null,
          repairOrder: { ...siteWhere, deletedAt: null, lines: { some: { assignedToId: me } } },
        },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          repairOrder: { select: { number: true, vehicle: { select: { plate: true } } } },
        },
        take: 20,
      });
      const attendance = await tx.attendance.findFirst({
        where: { membershipId: me, date: businessDate(now, org.timeZone) },
        select: { clockIn: true, clockOut: true },
      });
      return {
        serverNow: now,
        timeZone: org.timeZone,
        membershipId: me,
        attendance,
        tasks,
        inspections: inspections.map((i) => ({
          id: i.id,
          repairOrderId: i.repairOrderId,
          number: i.repairOrder.number,
          plate: i.repairOrder.vehicle.plate,
          items: i.items.map((it) => ({
            id: it.id,
            category: it.category,
            label: it.label,
            result: it.result,
            measurement: it.measurement,
            comment: it.comment,
          })),
        })),
      };
    });
  }),

  /** RG-M06-13/14 — file d'opérations : ordre `seq`, idempotence, rejets listés. */
  sync: tabletProcedure.input(techSyncInputSchema).mutation(async ({ ctx, input }) => {
    const org = await loadOrgRoContext(ctx.organizationId);
    assertRoModule(org);
    return syncTechOps(
      {
        organizationId: ctx.organizationId,
        membershipId: ctx.membership.id,
        permissions: ctx.permissions,
        allowedSiteIds: ctx.allowedSiteIds,
        activeSiteId: ctx.session.activeSiteId,
      },
      org,
      input,
      roNow(),
    );
  }),

  /** US-M06-06 — photo de travaux (compressée par la tablette), idempotente par `clientOpId`. */
  uploadPhoto: tabletProcedure
    .input(techUploadPhotoInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const known = await tenantDb.techSyncOperation.findFirst({
        where: { clientOpId: input.clientOpId },
      });
      if (known?.entityId) {
        return { attachmentId: known.entityId, url: `/api/attachments/${known.entityId}` };
      }
      const line = await tenantDb.repairOrderLine.findFirst({
        where: { id: input.lineId },
        include: { repairOrder: { select: { siteId: true } } },
      });
      if (!line) badRequest("Tâche introuvable.");
      requireSite(ctx, line.repairOrder.siteId);
      const body = Buffer.from(input.dataBase64, "base64");
      const ext = input.mimeType.split("/")[1];
      const key = `${ctx.organizationId}/repair-orders/${line.repairOrderId}/photo_work-${randomUUID()}.${ext}`;
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
          String((error as { code: unknown }).code).startsWith("storage.")
        ) {
          badRequest(error.message);
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Envoi de la photo impossible. Réessayez.",
        });
      }
      const now = roNow();
      const attachment = await tenantDb.transaction(async (tx) => {
        const created = await tx.attachment.create({
          data: {
            organizationId: ctx.organizationId,
            entity: "repair_order_line",
            entityId: line.id,
            kind: "photo_work",
            url: key,
            mimeType: input.mimeType,
            size: body.byteLength,
            caption: input.caption,
            createdById: ctx.membership.id,
          },
        });
        await tx.techSyncOperation.create({
          data: {
            organizationId: ctx.organizationId,
            clientOpId: input.clientOpId,
            membershipId: ctx.membership.id,
            type: "photo.attach",
            status: "ok",
            entityId: created.id,
            appliedAt: now,
          },
        });
        return created;
      });
      return { attachmentId: attachment.id, url: `/api/attachments/${attachment.id}` };
    }),

  /** US-M06-07 — recherche de pièce : compatibles avec le véhicule d'abord, stock du site. */
  products: orgProcedure.input(techProductSearchInputSchema).query(async ({ ctx, input }) => {
    if (!ctx.permissions.has("partrequest:create")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Permission manquante : partrequest:create",
      });
    }
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const order = await tenantDb.repairOrder.findFirst({
      where: { id: input.repairOrderId },
      include: { vehicle: { select: { make: true, model: true, year: true } } },
    });
    if (!order) badRequest("Ordre de réparation introuvable.");
    requireSite(ctx, order.siteId);
    const q = input.query.trim();
    const products = await tenantDb.product.findMany({
      where: {
        isActive: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { barcode: q },
                { oemReference: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { stockLevels: { where: { siteId: order.siteId } } },
      take: 50,
      orderBy: { name: "asc" },
    });
    return products
      .map((p) => {
        const level = p.stockLevels[0];
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          barcode: p.barcode,
          compatible: matchCompatibility(p.compatibleWith, order.vehicle),
          available: level ? fromBaseQty(level.onHand - level.reserved, p.quantityScale) : 0,
          unit: p.unit,
        };
      })
      .sort((a, b) => Number(b.compatible) - Number(a.compatible))
      .slice(0, 20);
  }),
});
