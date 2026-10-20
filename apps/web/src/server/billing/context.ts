// M08 — contexte d'appel des routeurs de facturation : acteur (audit), site actif, lignes saisies.
import { TRPCError } from "@trpc/server";
import { checkSalePrice, type DraftInvoiceLine } from "@atelieros/core";
import type { InvoiceLineFormInput } from "@atelieros/validators";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "../context";
import { requireSite } from "../trpc";
import { audit, bad, type Actor, type OrgBillingContext, type Tx } from "./service";

export type OrgCtx = Ctx & {
  user: CtxUser;
  session: CtxSession;
  membership: CtxMembership;
  organizationId: string;
};

export function actorOf(ctx: OrgCtx): Actor {
  return {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    membershipId: ctx.membership.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

/** Site demandé, sinon site actif de la session, sinon premier site autorisé (RG-M01-09). */
export async function resolveSiteId(tx: Tx, ctx: OrgCtx, siteId?: string | null): Promise<string> {
  const wanted = siteId ?? ctx.session.activeSiteId ?? null;
  if (wanted) {
    const site = await tx.site.findFirst({ where: { id: wanted }, select: { id: true } });
    if (!site) throw new TRPCError({ code: "NOT_FOUND", message: "Site introuvable." });
    requireSite(ctx, site.id);
    return site.id;
  }
  const site = await tx.site.findFirst({
    where: ctx.allowedSiteIds === "ALL" ? {} : { id: { in: ctx.allowedSiteIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!site) bad("Aucun site configuré : créez un site dans Paramètres > Sites.");
  return site.id;
}

/**
 * Lignes saisies dans l'éditeur (vente comptoir, brouillon) → lignes de facture : prix et TVA du
 * catalogue par défaut, contrôle prix mini / coût RG-M07-13 (dérogation `invoice:price_below_min`).
 */
export async function draftLinesFromInput(
  tx: Tx,
  ctx: OrgCtx,
  org: OrgBillingContext,
  invoiceRef: string | null,
  lines: readonly InvoiceLineFormInput[],
  priceReason?: string,
): Promise<DraftInvoiceLine[]> {
  const out: DraftInvoiceLine[] = [];
  for (const line of lines) {
    let unitPrice = line.unitPrice;
    let vatRate = line.vatRate ?? (org.vatEnabled ? org.vatRate : 0);
    let productId: string | null = null;
    let laborOperationId: string | null = null;
    if (line.productId) {
      const product = await tx.product.findFirst({ where: { id: line.productId } });
      if (!product) bad("Pièce introuvable.");
      productId = product.id;
      unitPrice ??= product.salePrice;
      if (line.vatRate === undefined) vatRate = org.vatEnabled ? product.vatRate : 0;
      const check = checkSalePrice({
        unitPrice,
        discountRate: line.discountRate ?? 0,
        minSalePrice: product.minSalePrice,
        averageCost: product.averageCost,
      });
      if (check.belowMin && !ctx.permissions.has("invoice:price_below_min")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Prix inférieur au minimum autorisé pour « ${product.name} ». Demandez au gérant.`,
        });
      }
      if (check.reasonRequired) {
        if (!priceReason?.trim()) {
          bad(
            check.belowMin
              ? "Indiquez le motif du prix sous le minimum."
              : `Vente à perte sur « ${product.name} » : indiquez un motif.`,
          );
        }
        await audit(actorOf(ctx), "invoice.price_below_min", "Invoice", invoiceRef ?? "draft", {
          after: { productId, unitPrice, discountRate: line.discountRate ?? 0 },
          reason: priceReason,
        });
      }
    }
    if (line.laborOperationId) {
      const op = await tx.laborOperation.findFirst({ where: { id: line.laborOperationId } });
      if (!op) bad("Opération de main-d'œuvre introuvable.");
      laborOperationId = op.id;
    }
    if (unitPrice === undefined) bad(`Indiquez le prix unitaire de « ${line.description} ».`);
    out.push({
      type: line.type,
      productId,
      laborOperationId,
      description: line.description,
      quantity: line.quantity,
      unitPrice,
      discountRate: line.discountRate ?? 0,
      vatRate,
      payer: "CUSTOMER",
      repairOrderLineId: null,
      depositInvoiceId: null,
      unitCost: null,
      fixed: null,
    });
  }
  return out;
}
