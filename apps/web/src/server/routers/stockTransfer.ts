// M07 §8 — transferts inter-sites (`transfer.*`) : créer, expédier, réceptionner, annuler.
import { cancelTransfer, createTransfer, db, receiveTransfer, shipTransfer } from "@atelieros/db";
import {
  countIdInputSchema,
  transferCreateInputSchema,
  transferListInputSchema,
  transferReceiveInputSchema,
} from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import { writeAuditLog } from "../audit";
import { baseQty, stockTx } from "../stock/helpers";
import { requirePermission, requireSite, router } from "../trpc";

function canSeeTransfer(
  ctx: { allowedSiteIds: string[] | "ALL" },
  t: { fromSiteId: string; toSiteId: string },
): boolean {
  return (
    ctx.allowedSiteIds === "ALL" ||
    ctx.allowedSiteIds.includes(t.fromSiteId) ||
    ctx.allowedSiteIds.includes(t.toSiteId)
  );
}

export const stockTransferRouter = router({
  list: requirePermission("stock:transfer")
    .input(transferListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const rows = await tenantDb.stockTransfer.findMany({
        where: input.status ? { status: input.status } : {},
        include: {
          fromSite: { select: { code: true, name: true } },
          toSite: { select: { code: true, name: true } },
          lines: {
            include: {
              product: {
                select: { id: true, sku: true, name: true, unit: true, quantityScale: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return rows.filter((t) => canSeeTransfer(ctx, t));
    }),

  get: requirePermission("stock:transfer")
    .input(countIdInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const transfer = await tenantDb.stockTransfer.findFirst({
        where: { id: input.id },
        include: {
          fromSite: { select: { code: true, name: true } },
          toSite: { select: { code: true, name: true } },
          lines: {
            include: {
              product: {
                select: { id: true, sku: true, name: true, unit: true, quantityScale: true },
              },
            },
          },
        },
      });
      if (!transfer || !canSeeTransfer(ctx, transfer)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transfert introuvable." });
      }
      return transfer;
    }),

  create: requirePermission("stock:transfer")
    .input(transferCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.fromSiteId);
      return stockTx(ctx.organizationId, async (tx, stock, now) => {
        const products = await tx.product.findMany({
          where: { id: { in: input.lines.map((l) => l.productId) } },
        });
        const lines = input.lines.map((l) => {
          const p = products.find((x) => x.id === l.productId);
          if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Produit introuvable." });
          return { productId: p.id, quantity: baseQty(l.quantity, p.quantityScale) };
        });
        return createTransfer(
          tx,
          stock,
          {
            fromSiteId: input.fromSiteId,
            toSiteId: input.toSiteId,
            lines,
            notes: input.notes,
            createdById: ctx.membership.id,
          },
          now,
        );
      });
    }),

  ship: requirePermission("stock:transfer")
    .input(countIdInputSchema)
    .mutation(async ({ ctx, input }) =>
      stockTx(ctx.organizationId, async (tx, stock, now) => {
        const t = await tx.stockTransfer.findFirstOrThrow({ where: { id: input.id } });
        requireSite(ctx, t.fromSiteId);
        return shipTransfer(tx, stock, t.id, ctx.membership.id, now);
      }),
    ),

  receive: requirePermission("stock:transfer")
    .input(transferReceiveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await stockTx(ctx.organizationId, async (tx, stock, now) => {
        const t = await tx.stockTransfer.findFirstOrThrow({
          where: { id: input.id },
          include: { lines: { include: { product: { select: { quantityScale: true } } } } },
        });
        requireSite(ctx, t.toSiteId);
        const lines = input.lines.map((l) => {
          const line = t.lines.find((x) => x.id === l.lineId);
          if (!line)
            throw new TRPCError({ code: "NOT_FOUND", message: "Ligne de transfert introuvable." });
          return {
            lineId: line.id,
            receivedQty: baseQty(l.receivedQty, line.product.quantityScale),
          };
        });
        return receiveTransfer(
          tx,
          stock,
          { transferId: t.id, lines, createdById: ctx.membership.id },
          now,
        );
      });
      if (result.shortfalls.length > 0) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "stock.transfer_shortfall",
          entity: "stock_transfer",
          entityId: result.transfer.id,
          after: { shortfalls: result.shortfalls },
        });
      }
      return result;
    }),

  cancel: requirePermission("stock:transfer")
    .input(countIdInputSchema)
    .mutation(async ({ ctx, input }) =>
      stockTx(ctx.organizationId, async (tx) => {
        const t = await tx.stockTransfer.findFirstOrThrow({ where: { id: input.id } });
        requireSite(ctx, t.fromSiteId);
        return cancelTransfer(tx, t.id);
      }),
    ),
});
