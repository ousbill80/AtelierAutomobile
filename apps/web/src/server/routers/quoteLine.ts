// M05 §8 — routeur `quoteLine` : ajout, modification, retrait, réordonnancement / regroupement.
// Un devis envoyé est figé (RG-M05-15) : seules les lignes d'un brouillon courant se modifient.
import { db, type QuoteLine } from "@atelieros/db";
import {
  addQuoteLineInputSchema,
  removeQuoteLineInputSchema,
  reorderQuoteLinesInputSchema,
  updateQuoteLineInputSchema,
} from "@atelieros/validators";
import { roNow } from "../repairOrders/helpers";
import {
  assertMinSalePrice,
  bad,
  buildQuoteLineData,
  evaluateDiscounts,
  loadOrgQuoteContext,
  quoteNotFound,
  recomputeQuote,
  type Tx,
} from "../quotes/service";
import { requirePermission, requireSite, router } from "../trpc";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "../context";
import type { Role } from "@atelieros/core";

type OrgCtx = Ctx & {
  user: CtxUser;
  session: CtxSession;
  membership: CtxMembership;
  organizationId: string;
};

function actorOf(ctx: OrgCtx) {
  return {
    organizationId: ctx.organizationId,
    permissions: ctx.permissions as ReadonlySet<string>,
    userId: ctx.user.id,
    membershipId: ctx.membership.id,
    role: ctx.membership.role as Role,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

async function loadDraft(tx: Tx, ctx: OrgCtx, quoteId: string) {
  const quote = await tx.quote.findFirst({ where: { id: quoteId, deletedAt: null } });
  if (!quote) quoteNotFound();
  requireSite(ctx, quote.siteId);
  if (quote.supersededAt || quote.status !== "DRAFT") {
    bad("Devis envoyé : créez une nouvelle version pour le modifier (« Modifier »).");
  }
  return quote;
}

async function loadLine(tx: Tx, ctx: OrgCtx, id: string): Promise<QuoteLine> {
  const line = await tx.quoteLine.findFirst({ where: { id } });
  if (!line) bad("Ligne introuvable.");
  await loadDraft(tx, ctx, line.quoteId);
  return line;
}

export const quoteLineRouter = router({
  add: requirePermission("quote:update")
    .input(addQuoteLineInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadDraft(tx, ctx, input.quoteId);
        const { quoteId: _q, priceReason, ...line } = input;
        void _q;
        const data = await buildQuoteLineData(tx, actorOf(ctx), org, quote, line, priceReason);
        const sortOrder = await tx.quoteLine.count({ where: { quoteId: quote.id } });
        const created = await tx.quoteLine.create({ data: { ...data, sortOrder } });
        const totals = await recomputeQuote(tx, quote.id, org.vatEnabled);
        const discount = await evaluateDiscounts(tx, actorOf(ctx), org, quote.id);
        return { line: created, totals, discount };
      });
    }),

  update: requirePermission("quote:update")
    .input(updateQuoteLineInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const line = await loadLine(tx, ctx, input.id);
        const patch = { ...input.patch };
        const supplied = patch.isCustomerSupplied ?? line.isCustomerSupplied;
        if (line.type === "PART" && supplied) patch.unitPrice = 0;
        if (patch.unitPrice !== undefined || patch.discountRate !== undefined) {
          await assertMinSalePrice(tx, actorOf(ctx), line.quoteId, line.productId, {
            unitPrice: patch.unitPrice ?? line.unitPrice,
            discountRate: patch.discountRate ?? line.discountRate,
            isCustomerSupplied: supplied,
            priceReason: input.priceReason,
          });
        }
        const { productId: _p, laborOperationId: _l, ...rest } = patch;
        void _p;
        void _l;
        const updated = await tx.quoteLine.update({ where: { id: line.id }, data: rest });
        const totals = await recomputeQuote(tx, line.quoteId, org.vatEnabled);
        const discount = await evaluateDiscounts(tx, actorOf(ctx), org, line.quoteId);
        return { line: updated, totals, discount };
      });
    }),

  remove: requirePermission("quote:update")
    .input(removeQuoteLineInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgQuoteContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const line = await loadLine(tx, ctx, input.id);
        await tx.repairOrderLine.updateMany({
          where: { quoteLineId: line.id },
          data: { quoteLineId: null },
        });
        if (line.inspectionItemId) {
          const others = await tx.quoteLine.count({
            where: {
              quoteId: line.quoteId,
              inspectionItemId: line.inspectionItemId,
              NOT: { id: line.id },
            },
          });
          if (others === 0) {
            await tx.inspectionItem.updateMany({
              where: { id: line.inspectionItemId },
              data: { addedToQuote: false },
            });
          }
        }
        await tx.quoteLine.delete({ where: { id: line.id } });
        const totals = await recomputeQuote(tx, line.quoteId, org.vatEnabled);
        const discount = await evaluateDiscounts(tx, actorOf(ctx), org, line.quoteId);
        void roNow;
        return { totals, discount };
      });
    }),

  reorder: requirePermission("quote:update")
    .input(reorderQuoteLinesInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const quote = await loadDraft(tx, ctx, input.quoteId);
        const lines = await tx.quoteLine.findMany({
          where: { quoteId: quote.id },
          select: { id: true },
        });
        const ids = new Set(lines.map((l) => l.id));
        if (input.orderedIds.some((id) => !ids.has(id))) bad("Ligne inconnue dans ce devis.");
        for (const [i, id] of input.orderedIds.entries()) {
          await tx.quoteLine.update({ where: { id }, data: { sortOrder: i } });
        }
        for (const g of input.groups ?? []) {
          if (!ids.has(g.lineId)) bad("Ligne inconnue dans ce devis.");
          await tx.quoteLine.update({
            where: { id: g.lineId },
            data: { groupKey: g.groupKey, groupLabel: g.groupLabel },
          });
        }
        return { ok: true };
      });
    }),
});
