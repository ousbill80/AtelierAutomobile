// M07 §8 — fournisseurs : liste, fiche (historique d'achats, produits), création, modification.
// Téléphones normalisés E.164 (+225) via core/phone.
import { normalizePhoneCI } from "@atelieros/core";
import { db } from "@atelieros/db";
import { supplierInputSchema, supplierUpdateInputSchema } from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { canSeeCost } from "../stock/helpers";
import { requirePermission, router } from "../trpc";

function phoneOrThrow(value: string | null | undefined, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (!value) return null;
  const normalized = normalizePhoneCI(value);
  if (!normalized.e164) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${label} invalide : saisissez un numéro ivoirien à 10 chiffres (ex. 07 47 21 88 90).`,
    });
  }
  return normalized.e164;
}

export const supplierRouter = router({
  list: requirePermission("purchase:read")
    .input(
      z.object({
        q: z.string().trim().max(80).optional(),
        includeInactive: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const suppliers = await tenantDb.supplier.findMany({
        where: {
          ...(input.includeInactive ? {} : { isActive: true }),
          ...(input.q ? { name: { contains: input.q, mode: "insensitive" } } : {}),
        },
        include: { _count: { select: { products: true, purchaseOrders: true } } },
        orderBy: { name: "asc" },
      });
      return suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        phone: s.phone,
        whatsappPhone: s.whatsappPhone,
        email: s.email,
        paymentTermsDays: s.paymentTermsDays,
        isActive: s.isActive,
        products: s._count.products,
        purchaseOrders: s._count.purchaseOrders,
      }));
    }),

  get: requirePermission("purchase:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const supplier = await tenantDb.supplier.findFirst({ where: { id: input.id } });
      if (!supplier)
        throw new TRPCError({ code: "NOT_FOUND", message: "Fournisseur introuvable." });
      const purchaseOrders = await tenantDb.purchaseOrder.findMany({
        where: { supplierId: supplier.id },
        include: { site: { select: { code: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const products = await tenantDb.product.findMany({
        where: { defaultSupplierId: supplier.id, isActive: true },
        select: { id: true, sku: true, name: true, purchasePrice: true },
        orderBy: { name: "asc" },
        take: 200,
      });
      const showCost = canSeeCost(ctx);
      return {
        supplier,
        purchaseOrders: purchaseOrders.map((po) => ({
          id: po.id,
          number: po.number,
          status: po.status,
          siteCode: po.site.code,
          total: po.total,
          orderedAt: po.orderedAt,
          expectedAt: po.expectedAt,
          createdAt: po.createdAt,
        })),
        products: products.map((p) => ({ ...p, purchasePrice: showCost ? p.purchasePrice : null })),
        totalPurchased: purchaseOrders
          .filter((po) => po.status !== "CANCELLED" && po.status !== "DRAFT")
          .reduce((s, po) => s + po.total, 0),
      };
    }),

  create: requirePermission("supplier:manage")
    .input(supplierInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const supplier = await tenantDb.supplier.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          phone: phoneOrThrow(input.phone, "Téléphone") ?? null,
          whatsappPhone: phoneOrThrow(input.whatsappPhone, "Numéro WhatsApp") ?? null,
          email: input.email ? input.email.toLowerCase() : null,
          address: input.address,
          paymentTermsDays: input.paymentTermsDays,
          notes: input.notes,
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "supplier.created",
        entity: "supplier",
        entityId: supplier.id,
        after: { name: supplier.name },
      });
      return supplier;
    }),

  update: requirePermission("supplier:manage")
    .input(supplierUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.supplier.findFirst({ where: { id: input.id } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Fournisseur introuvable." });
      const supplier = await tenantDb.supplier.update({
        where: { id: before.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: phoneOrThrow(input.phone, "Téléphone") } : {}),
          ...(input.whatsappPhone !== undefined
            ? { whatsappPhone: phoneOrThrow(input.whatsappPhone, "Numéro WhatsApp") }
            : {}),
          ...(input.email !== undefined
            ? { email: input.email ? input.email.toLowerCase() : null }
            : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.paymentTermsDays !== undefined
            ? { paymentTermsDays: input.paymentTermsDays }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "supplier.updated",
        entity: "supplier",
        entityId: supplier.id,
        before: { name: before.name, isActive: before.isActive },
        after: { name: supplier.name, isActive: supplier.isActive },
      });
      return supplier;
    }),
});
