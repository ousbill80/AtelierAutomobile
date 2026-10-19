// M07 §8 — inventaires (`count.*`) : liste, écran de comptage, démarrer / compter / soumettre /
// valider (validation `stock:count_validate`, OWNER au-delà du seuil d'écart) / annuler.
import { computeCountVariance, summarizeCount } from "@atelieros/core";
import {
  cancelCount,
  createCount,
  db,
  setCountLine,
  startCount,
  submitCount,
  validateCount,
} from "@atelieros/db";
import {
  countCreateInputSchema,
  countIdInputSchema,
  countListInputSchema,
  countSetLineInputSchema,
} from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import { writeAuditLog } from "../audit";
import { baseQty, canSeeCost, siteFilter, stockTx } from "../stock/helpers";
import { requirePermission, requireSite, router } from "../trpc";

export const stockCountRouter = router({
  list: requirePermission("stock:count")
    .input(countListInputSchema)
    .query(async ({ ctx, input }) => {
      if (input.siteId) requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const counts = await tenantDb.stockCount.findMany({
        where: {
          ...(input.siteId ? { siteId: input.siteId } : siteFilter(ctx)),
          ...(input.status ? { status: input.status } : {}),
        },
        include: {
          site: { select: { code: true, name: true } },
          _count: { select: { lines: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const showCost = canSeeCost(ctx);
      return counts.map((c) => ({
        id: c.id,
        number: c.number,
        status: c.status,
        site: c.site,
        scope: c.scope,
        lines: c._count.lines,
        startedAt: c.startedAt,
        validatedAt: c.validatedAt,
        createdAt: c.createdAt,
        varianceValue: showCost ? c.varianceValue : null,
      }));
    }),

  get: requirePermission("stock:count")
    .input(countIdInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const count = await tenantDb.stockCount.findFirst({
        where: { id: input.id },
        include: {
          site: { select: { id: true, code: true, name: true } },
          lines: {
            include: {
              product: {
                select: {
                  id: true,
                  sku: true,
                  name: true,
                  barcode: true,
                  unit: true,
                  quantityScale: true,
                  category: true,
                  stockLevels: { select: { siteId: true, binLocation: true } },
                },
              },
            },
          },
        },
      });
      if (!count) throw new TRPCError({ code: "NOT_FOUND", message: "Inventaire introuvable." });
      requireSite(ctx, count.siteId);
      const showCost = canSeeCost(ctx);
      const lines = count.lines
        .map((l) => {
          const v = computeCountVariance(l, l.product.quantityScale);
          return {
            id: l.id,
            product: {
              id: l.product.id,
              sku: l.product.sku,
              name: l.product.name,
              barcode: l.product.barcode,
              unit: l.product.unit,
              quantityScale: l.product.quantityScale,
              category: l.product.category,
            },
            binLocation:
              l.product.stockLevels.find((s) => s.siteId === count.siteId)?.binLocation ?? null,
            expectedQty: l.expectedQty,
            countedQty: l.countedQty,
            movedAfterCount: l.movedAfterCount,
            variance: v.variance,
            varianceValue: showCost ? v.varianceValue : null,
          };
        })
        .sort(
          (a, b) =>
            (a.binLocation ?? "").localeCompare(b.binLocation ?? "") ||
            a.product.name.localeCompare(b.product.name),
        );
      const summary = summarizeCount(
        count.lines.map((l) => ({ ...l, quantityScale: l.product.quantityScale })),
      );
      return {
        id: count.id,
        number: count.number,
        status: count.status,
        site: count.site,
        scope: count.scope,
        startedAt: count.startedAt,
        submittedAt: count.submittedAt,
        validatedAt: count.validatedAt,
        lines,
        summary: showCost ? summary : { ...summary, netValue: null, absoluteValue: null },
        canValidate: ctx.permissions.has("stock:count_validate"),
      };
    }),

  create: requirePermission("stock:count")
    .input(countCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      return stockTx(ctx.organizationId, (tx, stock, now) =>
        createCount(
          tx,
          stock,
          { siteId: input.siteId, scope: input.scope, createdById: ctx.membership.id },
          now,
        ),
      );
    }),

  start: requirePermission("stock:count")
    .input(countIdInputSchema)
    .mutation(async ({ ctx, input }) =>
      stockTx(ctx.organizationId, async (tx, _stock, now) => {
        const count = await tx.stockCount.findFirstOrThrow({ where: { id: input.id } });
        requireSite(ctx, count.siteId);
        return startCount(tx, count.id, now);
      }),
    ),

  /** Saisie (ou scan) d'une quantité comptée, en unités d'affichage. */
  setLine: requirePermission("stock:count")
    .input(countSetLineInputSchema)
    .mutation(async ({ ctx, input }) =>
      stockTx(ctx.organizationId, async (tx, _stock, now) => {
        const count = await tx.stockCount.findFirstOrThrow({ where: { id: input.countId } });
        requireSite(ctx, count.siteId);
        const product = await tx.product.findFirstOrThrow({ where: { id: input.productId } });
        return setCountLine(
          tx,
          {
            countId: count.id,
            productId: product.id,
            countedQty:
              input.countedQty == null ? null : baseQty(input.countedQty, product.quantityScale),
            countedById: ctx.membership.id,
          },
          now,
        );
      }),
    ),

  submit: requirePermission("stock:count")
    .input(countIdInputSchema)
    .mutation(async ({ ctx, input }) =>
      stockTx(ctx.organizationId, async (tx, _stock, now) => {
        const count = await tx.stockCount.findFirstOrThrow({ where: { id: input.id } });
        requireSite(ctx, count.siteId);
        return submitCount(tx, count.id, now);
      }),
    ),

  validate: requirePermission("stock:count_validate")
    .input(countIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await stockTx(ctx.organizationId, async (tx, stock, now) => {
        const count = await tx.stockCount.findFirstOrThrow({ where: { id: input.id } });
        requireSite(ctx, count.siteId);
        return validateCount(
          tx,
          stock,
          {
            countId: count.id,
            validatedById: ctx.membership.id,
            validatorRole: ctx.membership.role,
          },
          now,
        );
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: result.count.siteId,
        action: "stock.count_validated",
        entity: "stock_count",
        entityId: result.count.id,
        after: {
          number: result.count.number,
          corrections: result.corrections,
          netValue: result.summary.netValue,
          absoluteValue: result.summary.absoluteValue,
        },
      });
      return result;
    }),

  cancel: requirePermission("stock:count")
    .input(countIdInputSchema)
    .mutation(async ({ ctx, input }) =>
      stockTx(ctx.organizationId, async (tx) => {
        const count = await tx.stockCount.findFirstOrThrow({ where: { id: input.id } });
        requireSite(ctx, count.siteId);
        return cancelCount(tx, count.id);
      }),
    ),
});
