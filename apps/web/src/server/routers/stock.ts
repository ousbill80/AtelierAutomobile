// M07 §8 — stock : niveaux, réservations, sorties / retours vers OR, ajustements, journal des
// mouvements, valorisation (à date), pièces dormantes, négatifs et file du magasin.
import {
  computeValuation,
  daysSince,
  dormantBucket,
  formatQty,
  reconstructStockAt,
  stockSettingsFrom,
  valueOf,
} from "@atelieros/core";
import {
  adminDb,
  db,
  issueStock,
  releaseReservation,
  reserveStock,
  returnFromRepairOrder,
  applyMovement,
  type Prisma,
} from "@atelieros/db";
import {
  adjustInputSchema,
  dormantInputSchema,
  issueInputSchema,
  movementsInputSchema,
  queueInputSchema,
  releaseInputSchema,
  reserveInputSchema,
  returnFromRoInputSchema,
  valuationInputSchema,
} from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { baseQty, canSeeCost, siteFilter, stockNow, stockTx } from "../stock/helpers";
import { requirePermission, requireSite, router } from "../trpc";

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT: "Réception achat",
  ISSUE_TO_RO: "Sortie OR",
  RETURN_FROM_RO: "Retour OR",
  ADJUSTMENT: "Ajustement",
  TRANSFER_OUT: "Transfert sortant",
  TRANSFER_IN: "Transfert entrant",
  COUNT_CORRECTION: "Correction d'inventaire",
  SUPPLIER_RETURN: "Retour fournisseur",
};

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function movementsWhere(
  ctx: { allowedSiteIds: string[] | "ALL" },
  input: z.infer<typeof movementsInputSchema>,
): Prisma.StockMovementWhereInput {
  return {
    ...siteFilter(ctx),
    ...(input.siteId ? { siteId: input.siteId } : {}),
    ...(input.productId ? { productId: input.productId } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.repairOrderId ? { repairOrderId: input.repairOrderId } : {}),
    ...(input.createdById ? { createdById: input.createdById } : {}),
    ...(input.from || input.to
      ? {
          createdAt: {
            ...(input.from ? { gte: new Date(`${input.from}T00:00:00.000Z`) } : {}),
            ...(input.to
              ? { lt: new Date(new Date(`${input.to}T00:00:00.000Z`).getTime() + 86_400_000) }
              : {}),
          },
        }
      : {}),
  };
}

const MOVEMENT_INCLUDE = {
  site: { select: { code: true } },
  product: { select: { id: true, sku: true, name: true, unit: true, quantityScale: true } },
  repairOrder: { select: { id: true, number: true } },
  purchaseOrder: { select: { id: true, number: true } },
  createdBy: { select: { user: { select: { name: true } } } },
} satisfies Prisma.StockMovementInclude;

export const stockRouter = router({
  levels: requirePermission("stock:read")
    .input(z.object({ productId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.stockLevel.findMany({
        where: { productId: input.productId, ...siteFilter(ctx) },
        include: { site: { select: { code: true, name: true } } },
      });
    }),

  /** Paramètres `settings.stock` (lecture pour l'interface : stock négatif, seuils). */
  settings: requirePermission("stock:read").query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { settings: true },
    });
    return stockSettingsFrom(org.settings);
  }),

  updateSettings: requirePermission("settings:update")
    .input(
      z.object({
        allowNegative: z.boolean().optional(),
        dormantDays: z.number().int().min(30).max(3650).optional(),
        countApprovalThreshold: z.number().int().min(0).optional(),
        autoIssueOnInvoice: z.boolean().optional(),
        customerPartFee: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { settings: true },
      });
      const settings = (org.settings ?? {}) as Record<string, unknown>;
      const before = stockSettingsFrom(settings);
      const next = { ...before, ...input };
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { settings: { ...settings, stock: next } as Prisma.InputJsonValue },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "settings.stock_updated",
        entity: "organization",
        entityId: ctx.organizationId,
        before,
        after: next,
      });
      return next;
    }),

  /** US-M07-03 : réservation manuelle pour un OR (par id ou numéro d'OR). */
  reserve: requirePermission("stock:reserve")
    .input(reserveInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      return stockTx(ctx.organizationId, async (tx, stock, now) => {
        const product = await tx.product.findFirstOrThrow({ where: { id: input.productId } });
        let repairOrderId = input.repairOrderId ?? null;
        if (!repairOrderId && input.repairOrderNumber) {
          const ro = await tx.repairOrder.findFirst({
            where: { number: { equals: input.repairOrderNumber.trim(), mode: "insensitive" } },
            select: { id: true },
          });
          if (!ro) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Ordre de réparation ${input.repairOrderNumber} introuvable.`,
            });
          }
          repairOrderId = ro.id;
        }
        return reserveStock(
          tx,
          stock,
          {
            siteId: input.siteId,
            productId: product.id,
            quantity: baseQty(input.quantity, product.quantityScale),
            repairOrderId,
            repairOrderLineId: input.repairOrderLineId ?? null,
            note: input.note,
            createdById: ctx.membership.id,
          },
          now,
        );
      });
    }),

  release: requirePermission("stock:reserve")
    .input(releaseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const reservation = await stockTx(ctx.organizationId, async (tx, stock, now) => {
        const existing = await tx.stockReservation.findFirstOrThrow({
          where: { id: input.reservationId },
        });
        requireSite(ctx, existing.siteId);
        return releaseReservation(tx, stock, existing.id, now);
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: reservation.siteId,
        action: "stock.reservation_released",
        entity: "stock_reservation",
        entityId: reservation.id,
        reason: input.reason,
      });
      return reservation;
    }),

  /** US-M07-04 : sortie vers un OR (depuis une réservation ou directe). */
  issue: requirePermission("stock:issue")
    .input(issueInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      return stockTx(ctx.organizationId, async (tx, stock, now) => {
        const product = await tx.product.findFirstOrThrow({ where: { id: input.productId } });
        return issueStock(
          tx,
          stock,
          {
            reservationId: input.reservationId,
            repairOrderId: input.repairOrderId,
            repairOrderLineId: input.repairOrderLineId,
            productId: product.id,
            siteId: input.siteId,
            quantity: baseQty(input.quantity, product.quantityScale),
            createdById: ctx.membership.id,
          },
          now,
        );
      });
    }),

  /** US-M07-05 : retour d'une pièce non utilisée (ou démontée non revendable). */
  returnFromRo: requirePermission("stock:issue")
    .input(returnFromRoInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      return stockTx(ctx.organizationId, async (tx, stock, now) => {
        const product = await tx.product.findFirstOrThrow({ where: { id: input.productId } });
        const movements = await returnFromRepairOrder(
          tx,
          stock,
          {
            repairOrderId: input.repairOrderId,
            repairOrderLineId: input.repairOrderLineId,
            productId: product.id,
            siteId: input.siteId,
            quantity: baseQty(input.quantity, product.quantityScale),
            resellable: input.resellable,
            reason: input.reason,
            createdById: ctx.membership.id,
          },
          now,
        );
        return { movements };
      });
    }),

  /** RG-M07-12 : ajustement manuel motivé (permission `stock:adjust`, audit). */
  adjust: requirePermission("stock:adjust")
    .input(adjustInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const result = await stockTx(ctx.organizationId, async (tx, stock, now) => {
        const product = await tx.product.findFirstOrThrow({ where: { id: input.productId } });
        return applyMovement(
          tx,
          stock,
          {
            type: "ADJUSTMENT",
            reasonCode: input.reasonCode,
            reason: input.reason,
            siteId: input.siteId,
            productId: product.id,
            quantity: baseQty(input.quantity, product.quantityScale),
            createdById: ctx.membership.id,
          },
          now,
        );
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: input.siteId,
        action: "stock.adjust",
        entity: "product",
        entityId: input.productId,
        before: { onHand: result.plan.siteOnHandAfter - result.plan.quantity },
        after: {
          onHand: result.plan.siteOnHandAfter,
          quantity: result.plan.quantity,
          reasonCode: input.reasonCode,
          value: valueOf(result.plan.quantity, result.product.quantityScale, result.plan.unitCost),
        },
        reason: input.reason,
      });
      return { movement: result.movement };
    }),

  movements: requirePermission("stock:read")
    .input(movementsInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const showCost = canSeeCost(ctx);
      const rows = await tenantDb.stockMovement.findMany({
        where: movementsWhere(ctx, input),
        include: MOVEMENT_INCLUDE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const items = rows.slice(0, input.limit).map((m) => ({
        id: m.id,
        type: m.type,
        quantity: m.quantity,
        siteCode: m.site.code,
        product: m.product,
        unitCost: showCost ? m.unitCost : null,
        value:
          showCost && m.unitCost != null
            ? valueOf(m.quantity, m.product.quantityScale, m.unitCost)
            : null,
        costAfter: showCost ? m.costAfter : null,
        reason: m.reason,
        reasonCode: m.reasonCode,
        repairOrder: m.repairOrder,
        purchaseOrder: m.purchaseOrder,
        createdBy: m.createdBy?.user.name ?? null,
        createdAt: m.createdAt,
      }));
      return { items, nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.id : null };
    }),

  /** §7 : export CSV du journal (séparateur « ; », compatible Excel français). */
  movementsCsv: requirePermission("stock:read")
    .input(movementsInputSchema.omit({ cursor: true, limit: true }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const showCost = canSeeCost(ctx);
      const rows = await tenantDb.stockMovement.findMany({
        where: movementsWhere(ctx, { ...input, limit: 50 }),
        include: MOVEMENT_INCLUDE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20_000,
      });
      const header = [
        "Date",
        "Site",
        "Type",
        "SKU",
        "Produit",
        "Quantité",
        "Unité",
        ...(showCost ? ["Coût unitaire", "Valeur", "CMP après"] : []),
        "OR",
        "BC",
        "Motif",
        "Utilisateur",
      ];
      const lines = rows.map((m) =>
        [
          m.createdAt.toISOString(),
          m.site.code,
          MOVEMENT_LABELS[m.type] ?? m.type,
          m.product.sku,
          m.product.name,
          formatQty(m.quantity, m.product.quantityScale),
          m.product.unit,
          ...(showCost
            ? [
                m.unitCost ?? "",
                m.unitCost != null ? valueOf(m.quantity, m.product.quantityScale, m.unitCost) : "",
                m.costAfter ?? "",
              ]
            : []),
          m.repairOrder?.number ?? "",
          m.purchaseOrder?.number ?? "",
          [m.reasonCode, m.reason].filter(Boolean).join(" — "),
          m.createdBy?.user.name ?? "",
        ]
          .map(csvCell)
          .join(";"),
      );
      return { filename: "mouvements-stock.csv", content: [header.join(";"), ...lines].join("\n") };
    }),

  /** US-M07-13 / RG-M07-09 : valeur par site ou catégorie, à date si demandée. */
  valuation: requirePermission("stock:valuation")
    .input(valuationInputSchema)
    .query(async ({ ctx, input }) => {
      if (input.siteId) requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const sites = await tenantDb.site.findMany({ select: { id: true, code: true, name: true } });
      const products = await tenantDb.product.findMany({
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
          quantityScale: true,
          averageCost: true,
        },
      });
      const productOf = new Map(products.map((p) => [p.id, p]));
      const siteWhere = input.siteId ? { siteId: input.siteId } : siteFilter(ctx);

      let items: Parameters<typeof computeValuation>[0];
      if (input.at) {
        const at = new Date(new Date(`${input.at}T00:00:00.000Z`).getTime() + 86_400_000 - 1);
        const movements = await tenantDb.stockMovement.findMany({
          where: { ...siteWhere, createdAt: { lte: at } },
          select: {
            productId: true,
            siteId: true,
            quantity: true,
            costAfter: true,
            unitCost: true,
            createdAt: true,
          },
        });
        // Le CMP à date est global : on le reconstruit sur tous les sites du produit.
        const allSites = input.siteId
          ? await tenantDb.stockMovement.findMany({
              where: { createdAt: { lte: at } },
              select: {
                productId: true,
                siteId: true,
                quantity: true,
                costAfter: true,
                unitCost: true,
                createdAt: true,
              },
            })
          : movements;
        const { quantities } = reconstructStockAt(movements, at);
        const { costs } = reconstructStockAt(allSites, at);
        items = [...quantities.entries()].map(([key, onHand]) => {
          const [productId, siteId] = key.split("|") as [string, string];
          const p = productOf.get(productId)!;
          return {
            productId,
            siteId,
            category: p.category,
            onHand,
            quantityScale: p.quantityScale,
            averageCost: costs.get(productId) ?? 0,
          };
        });
      } else {
        const levels = await tenantDb.stockLevel.findMany({
          where: siteWhere,
          select: { productId: true, siteId: true, onHand: true },
        });
        items = levels.map((l) => {
          const p = productOf.get(l.productId)!;
          return {
            productId: l.productId,
            siteId: l.siteId,
            category: p.category,
            onHand: l.onHand,
            quantityScale: p.quantityScale,
            averageCost: p.averageCost,
          };
        });
      }
      const result = computeValuation(items, input.groupBy);
      const siteOf = new Map(sites.map((s) => [s.id, s]));
      return {
        total: result.total,
        at: input.at ?? null,
        groups: result.groups.map((g) => ({
          ...g,
          label: input.groupBy === "site" ? (siteOf.get(g.key)?.name ?? g.key) : g.key, // "" = sans catégorie (libellé côté interface)
        })),
        negatives: result.negatives.map((n) => ({
          ...n,
          siteCode: siteOf.get(n.siteId)?.code ?? "",
          sku: productOf.get(n.productId)?.sku ?? "",
          name: productOf.get(n.productId)?.name ?? "",
        })),
      };
    }),

  /** RG-M07-11 : pièces dormantes (sans sortie depuis N jours, stock > 0). */
  dormant: requirePermission("stock:valuation")
    .input(dormantInputSchema)
    .query(async ({ ctx, input }) => {
      if (input.siteId) requireSite(ctx, input.siteId);
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { settings: true },
      });
      const days = input.days ?? stockSettingsFrom(org.settings).dormantDays;
      const now = stockNow();
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const products = await tenantDb.product.findMany({
        where: {
          stockLevels: {
            some: {
              onHand: { gt: 0 },
              ...(input.siteId ? { siteId: input.siteId } : siteFilter(ctx)),
            },
          },
        },
        include: {
          stockLevels: { where: input.siteId ? { siteId: input.siteId } : siteFilter(ctx) },
        },
      });
      const rows = products
        .map((p) => {
          const onHand = p.stockLevels.reduce((s, l) => s + Math.max(l.onHand, 0), 0);
          const bucket = dormantBucket(
            { onHand, lastIssuedAt: p.lastIssuedAt, createdAt: p.createdAt },
            now,
            days,
          );
          if (!bucket) return null;
          return {
            productId: p.id,
            sku: p.sku,
            name: p.name,
            category: p.category,
            unit: p.unit,
            quantityScale: p.quantityScale,
            onHand,
            value: valueOf(onHand, p.quantityScale, p.averageCost),
            lastIssuedAt: p.lastIssuedAt,
            days: daysSince(p.lastIssuedAt ?? p.createdAt, now),
            bucket,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.value - a.value);
      return { days, rows, totalValue: rows.reduce((s, r) => s + r.value, 0) };
    }),

  /** RG-M07-06 : lignes « À régulariser » (stock négatif). */
  negatives: requirePermission("stock:read").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.stockLevel.findMany({
      where: { onHand: { lt: 0 }, ...siteFilter(ctx) },
      include: {
        site: { select: { code: true } },
        product: { select: { id: true, sku: true, name: true, unit: true, quantityScale: true } },
      },
      orderBy: { onHand: "asc" },
    });
  }),

  /** Onglet « Ventes sous coût » : événements `stock.sold_below_cost` (émis par M05/M08). */
  belowCostSales: requirePermission("stock:valuation").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const events = await tenantDb.domainEvent.findMany({
      where: { type: "stock.sold_below_cost" },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
    return events.map((e) => ({ id: e.id, occurredAt: e.occurredAt, payload: e.payload }));
  }),

  /** `/stock/sorties` : réservations à sortir (et en attente de réception) du site. */
  queue: requirePermission("stock:read")
    .input(queueInputSchema)
    .query(async ({ ctx, input }) => {
      if (input.siteId) requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const reservations = await tenantDb.stockReservation.findMany({
        where: {
          status: { in: ["RESERVED", "BACKORDERED"] },
          ...(input.siteId ? { siteId: input.siteId } : siteFilter(ctx)),
        },
        include: {
          site: { select: { id: true, code: true } },
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              unit: true,
              quantityScale: true,
              stockLevels: { select: { siteId: true, onHand: true, binLocation: true } },
            },
          },
          purchaseOrder: { select: { id: true, number: true, expectedAt: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      const roIds = [
        ...new Set(reservations.map((r) => r.repairOrderId).filter((x): x is string => !!x)),
      ];
      const orders = roIds.length
        ? await tenantDb.repairOrder.findMany({
            where: { id: { in: roIds } },
            select: {
              id: true,
              number: true,
              status: true,
              priority: true,
              promisedAt: true,
              vehicle: { select: { plate: true } },
            },
          })
        : [];
      const priorityRank: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
      return reservations
        .map((r) => {
          const ro = orders.find((o) => o.id === r.repairOrderId) ?? null;
          const level = r.product.stockLevels.find((l) => l.siteId === r.siteId);
          return {
            id: r.id,
            status: r.status,
            quantity: r.quantity,
            createdAt: r.createdAt,
            note: r.note,
            site: r.site,
            product: {
              id: r.product.id,
              sku: r.product.sku,
              name: r.product.name,
              unit: r.product.unit,
              quantityScale: r.product.quantityScale,
            },
            onHand: level?.onHand ?? 0,
            binLocation: level?.binLocation ?? null,
            purchaseOrder: r.purchaseOrder,
            repairOrder: ro
              ? {
                  id: ro.id,
                  number: ro.number,
                  plate: ro.vehicle.plate,
                  priority: ro.priority,
                  promisedAt: ro.promisedAt,
                }
              : null,
          };
        })
        .sort(
          (a, b) =>
            Number(a.status !== "RESERVED") - Number(b.status !== "RESERVED") ||
            (priorityRank[a.repairOrder?.priority ?? "NORMAL"] ?? 2) -
              (priorityRank[b.repairOrder?.priority ?? "NORMAL"] ?? 2) ||
            (a.repairOrder?.promisedAt?.getTime() ?? Infinity) -
              (b.repairOrder?.promisedAt?.getTime() ?? Infinity) ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        );
    }),

  /** Recherche d'un OR (numéro ou plaque) pour réserver / sortir / retourner. */
  findRepairOrders: requirePermission("stock:read")
    .input(z.object({ q: z.string().trim().min(2).max(40) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const compact = input.q.replace(/\s+/g, "").toUpperCase();
      return tenantDb.repairOrder.findMany({
        where: {
          deletedAt: null,
          ...siteFilter(ctx),
          OR: [
            { number: { contains: input.q, mode: "insensitive" } },
            { vehicle: { plateCompact: { contains: compact } } },
          ],
        },
        select: {
          id: true,
          number: true,
          siteId: true,
          status: true,
          vehicle: { select: { plate: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
    }),
});
