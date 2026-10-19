// US-M07-09 / RG-M07-10 — inventaires : création, démarrage (théorique figé), comptage,
// soumission, validation (mouvements COUNT_CORRECTION) et annulation.
import {
  assertCountTransition,
  computeCountVariance,
  countRequiresOwnerValidation,
  DomainError,
  summarizeCount,
  type CountSummary,
  type StockCountStatusLike,
} from "@atelieros/core";
import type { Prisma, StockCount } from "@prisma/client";
import { nextSiteDocumentNumber, type StockContext, type Tx } from "./context";
import { applyMovement, ensureLevel, lockProducts } from "./movements";

export interface CountScope {
  categories?: string[];
  bins?: string[];
}

export async function createCount(
  tx: Tx,
  ctx: StockContext,
  input: { siteId: string; scope: CountScope; createdById?: string | null },
  now: Date,
): Promise<StockCount> {
  const number = await nextSiteDocumentNumber(tx, ctx, "INV", input.siteId, now);
  return tx.stockCount.create({
    data: {
      organizationId: ctx.organizationId,
      siteId: input.siteId,
      number,
      scope: input.scope as Prisma.InputJsonValue,
      createdById: input.createdById ?? null,
    },
  });
}

/** DRAFT → IN_PROGRESS : fige `expectedQty` = onHand et `unitCost` = CMP par ligne. */
export async function startCount(tx: Tx, countId: string, now: Date): Promise<StockCount> {
  const count = await tx.stockCount.findFirstOrThrow({ where: { id: countId } });
  assertCountTransition(count.status as StockCountStatusLike, "IN_PROGRESS");
  const scope = (count.scope ?? {}) as CountScope;
  const categories = scope.categories?.filter(Boolean) ?? [];
  const bins = scope.bins?.filter(Boolean) ?? [];
  const products = await tx.product.findMany({
    where: {
      isActive: true,
      isStocked: true,
      ...(categories.length ? { category: { in: categories } } : {}),
      ...(bins.length
        ? { stockLevels: { some: { siteId: count.siteId, binLocation: { in: bins } } } }
        : {}),
    },
    include: { stockLevels: { where: { siteId: count.siteId } } },
  });
  if (products.length === 0) {
    throw new DomainError("count.empty_scope", "Aucun produit ne correspond à ce périmètre.");
  }
  await tx.stockCountLine.createMany({
    data: products.map((p) => ({
      organizationId: count.organizationId,
      stockCountId: count.id,
      productId: p.id,
      expectedQty: p.stockLevels[0]?.onHand ?? 0,
      unitCost: p.averageCost,
    })),
    skipDuplicates: true,
  });
  return tx.stockCount.update({
    where: { id: count.id },
    data: { status: "IN_PROGRESS", startedAt: now },
  });
}

/** Saisie d'une quantité comptée (unités de base). Ajoute la ligne si le produit est hors liste. */
export async function setCountLine(
  tx: Tx,
  input: {
    countId: string;
    productId: string;
    countedQty: number | null;
    countedById?: string | null;
  },
  now: Date,
) {
  const count = await tx.stockCount.findFirstOrThrow({ where: { id: input.countId } });
  if (count.status !== "IN_PROGRESS") {
    throw new DomainError(
      "count.not_in_progress",
      "Cet inventaire n'est pas en cours de comptage.",
    );
  }
  if (input.countedQty != null && (!Number.isInteger(input.countedQty) || input.countedQty < 0)) {
    throw new DomainError("count.invalid_qty", "La quantité comptée doit être positive.");
  }
  let line = await tx.stockCountLine.findFirst({
    where: { stockCountId: count.id, productId: input.productId },
  });
  if (!line) {
    const product = await tx.product.findFirstOrThrow({ where: { id: input.productId } });
    const level = await tx.stockLevel.findFirst({
      where: { siteId: count.siteId, productId: product.id },
    });
    line = await tx.stockCountLine.create({
      data: {
        organizationId: count.organizationId,
        stockCountId: count.id,
        productId: product.id,
        expectedQty: level?.onHand ?? 0,
        unitCost: product.averageCost,
      },
    });
  }
  return tx.stockCountLine.update({
    where: { id: line.id },
    data: {
      countedQty: input.countedQty,
      countedById: input.countedQty == null ? null : (input.countedById ?? null),
      countedAt: input.countedQty == null ? null : now,
    },
  });
}

async function summaryOf(tx: Tx, countId: string): Promise<CountSummary> {
  const lines = await tx.stockCountLine.findMany({
    where: { stockCountId: countId },
    include: { product: { select: { quantityScale: true } } },
  });
  return summarizeCount(lines.map((l) => ({ ...l, quantityScale: l.product.quantityScale })));
}

/** IN_PROGRESS → SUBMITTED. */
export async function submitCount(tx: Tx, countId: string, now: Date): Promise<StockCount> {
  const count = await tx.stockCount.findFirstOrThrow({ where: { id: countId } });
  assertCountTransition(count.status as StockCountStatusLike, "SUBMITTED");
  const summary = await summaryOf(tx, countId);
  if (summary.linesCounted === 0) {
    throw new DomainError(
      "count.nothing_counted",
      "Comptez au moins un produit avant de soumettre.",
    );
  }
  return tx.stockCount.update({
    where: { id: count.id },
    data: { status: "SUBMITTED", submittedAt: now, varianceValue: summary.netValue },
  });
}

/**
 * SUBMITTED → VALIDATED : un mouvement COUNT_CORRECTION par écart. Écart valorisé au-delà de
 * `countApprovalThreshold` → validation OWNER obligatoire.
 */
export async function validateCount(
  tx: Tx,
  ctx: StockContext,
  input: { countId: string; validatedById: string; validatorRole: string },
  now: Date,
): Promise<{ count: StockCount; corrections: number; summary: CountSummary }> {
  const count = await tx.stockCount.findFirstOrThrow({
    where: { id: input.countId },
    include: { lines: { include: { product: true } } },
  });
  assertCountTransition(count.status as StockCountStatusLike, "VALIDATED");
  const summary = summarizeCount(
    count.lines.map((l) => ({ ...l, quantityScale: l.product.quantityScale })),
  );
  if (
    countRequiresOwnerValidation(summary.absoluteValue, ctx.settings.countApprovalThreshold) &&
    input.validatorRole !== "OWNER"
  ) {
    throw new DomainError(
      "count.owner_required",
      `Écart valorisé supérieur à ${ctx.settings.countApprovalThreshold.toLocaleString("fr-FR")} FCFA : validation par le propriétaire obligatoire.`,
    );
  }
  const toCorrect = count.lines.filter(
    (l) => computeCountVariance(l, l.product.quantityScale).variance !== 0,
  );
  await lockProducts(
    tx,
    toCorrect.map((l) => l.productId),
    now,
  );
  for (const line of toCorrect) {
    const variance = (line.countedQty ?? 0) - line.expectedQty;
    await ensureLevel(tx, ctx.organizationId, count.siteId, line.productId);
    await applyMovement(
      tx,
      ctx,
      {
        siteId: count.siteId,
        productId: line.productId,
        type: "COUNT_CORRECTION",
        quantity: variance,
        countId: count.id,
        reason: `Inventaire ${count.number}`,
        createdById: input.validatedById,
        // Une correction d'inventaire constate la réalité : jamais bloquée par le stock négatif.
        allowNegative: true,
        alreadyLocked: true,
      },
      now,
    );
  }
  const updated = await tx.stockCount.update({
    where: { id: count.id },
    data: {
      status: "VALIDATED",
      validatedAt: now,
      validatedById: input.validatedById,
      varianceValue: summary.netValue,
    },
  });
  return { count: updated, corrections: toCorrect.length, summary };
}

export async function cancelCount(tx: Tx, countId: string): Promise<StockCount> {
  const count = await tx.stockCount.findFirstOrThrow({ where: { id: countId } });
  assertCountTransition(count.status as StockCountStatusLike, "CANCELLED");
  return tx.stockCount.update({ where: { id: count.id }, data: { status: "CANCELLED" } });
}
