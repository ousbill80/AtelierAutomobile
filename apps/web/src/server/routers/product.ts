// M07 §8 — catalogue pièces : recherche floue (références, nom, code-barres, références
// croisées), compatibilités véhicule, fiche, création/modification, archivage, contrôle prix.
import {
  availableQty,
  checkSalePrice,
  computeMarginRate,
  defaultQuantityScale,
  looksLikeBarcode,
  matchCompatibility,
  minStockOfLevel,
  normalizeReference,
  tokenizeProductQuery,
} from "@atelieros/core";
import { db, type Prisma } from "@atelieros/db";
import {
  checkPriceInputSchema,
  levelSettingsInputSchema,
  productInputSchema,
  productSearchInputSchema,
  productUpdateInputSchema,
} from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { baseQty, canSeeCost } from "../stock/helpers";
import { requirePermission, requireSite, router } from "../trpc";

type TenantDb = ReturnType<typeof db.forTenant>;

const PRODUCT_INCLUDE = {
  stockLevels: { include: { site: { select: { id: true, code: true, name: true } } } },
  defaultSupplier: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

type ProductWithLevels = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

/**
 * Recherche floue (US-M07-01) : chaque mot doit correspondre à l'un des champs texte (ILIKE,
 * index trigram) ou à une référence croisée / compatibilité (« corolla » → TOYOTA|COROLLA).
 * Les tableaux ne supportant pas le « contient » en Prisma, ils sont filtrés en mémoire.
 */
async function searchWhere(
  tenantDb: TenantDb,
  q: string | undefined,
): Promise<Prisma.ProductWhereInput> {
  if (!q) return {};
  const tokens = tokenizeProductQuery(q);
  if (tokens.length === 0) return {};
  const arrays = await tenantDb.product.findMany({
    where: {
      OR: [
        { NOT: { compatibleWith: { isEmpty: true } } },
        { NOT: { crossReferences: { isEmpty: true } } },
      ],
    },
    select: { id: true, compatibleWith: true, crossReferences: true },
  });
  return {
    AND: tokens.map((token) => {
      const ref = normalizeReference(token);
      const arrayIds = arrays
        .filter(
          (p) =>
            p.crossReferences.some((c) => c.includes(ref)) ||
            p.compatibleWith.some((c) =>
              c
                .split("|")
                .slice(0, 2)
                .some((part) => part.includes(ref)),
            ),
        )
        .map((p) => p.id);
      return {
        OR: [
          { sku: { contains: token, mode: "insensitive" } },
          { name: { contains: token, mode: "insensitive" } },
          { oemReference: { contains: token, mode: "insensitive" } },
          { brand: { contains: token, mode: "insensitive" } },
          { category: { contains: token, mode: "insensitive" } },
          { barcode: { equals: token } },
          ...(arrayIds.length ? [{ id: { in: arrayIds } }] : []),
        ],
      } satisfies Prisma.ProductWhereInput;
    }),
  };
}

/** Vue publique d'un produit : coûts masqués sans `product:view_cost`. */
function present(
  product: ProductWithLevels,
  showCost: boolean,
  allowedSiteIds: string[] | "ALL",
  vehicle?: { make: string; model: string; year: number | null } | null,
) {
  const levels = product.stockLevels
    .filter((l) => allowedSiteIds === "ALL" || allowedSiteIds.includes(l.siteId))
    .sort((a, b) => a.site.code.localeCompare(b.site.code))
    .map((l) => ({
      id: l.id,
      siteId: l.siteId,
      siteCode: l.site.code,
      siteName: l.site.name,
      onHand: l.onHand,
      reserved: l.reserved,
      available: availableQty(l),
      minStock: minStockOfLevel(l, product),
      maxStock: l.maxStock,
      binLocation: l.binLocation,
      belowMin: product.isStocked && availableQty(l) < minStockOfLevel(l, product),
    }));
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    oemReference: product.oemReference,
    barcode: product.barcode,
    category: product.category,
    unit: product.unit,
    quantityScale: product.quantityScale,
    packSize: product.packSize,
    crossReferences: product.crossReferences,
    compatibleWith: product.compatibleWith,
    salePrice: product.salePrice,
    minSalePrice: product.minSalePrice,
    vatRate: product.vatRate,
    minStock: product.minStock,
    reorderQty: product.reorderQty,
    isStocked: product.isStocked,
    isActive: product.isActive,
    defaultSupplier: product.defaultSupplier,
    lastIssuedAt: product.lastIssuedAt,
    averageCost: showCost ? product.averageCost : null,
    purchasePrice: showCost ? product.purchasePrice : null,
    marginRate: showCost ? computeMarginRate(product.salePrice, product.averageCost) : null,
    levels,
    totalOnHand: levels.reduce((s, l) => s + l.onHand, 0),
    totalAvailable: levels.reduce((s, l) => s + l.available, 0),
    belowMin: levels.some((l) => l.belowMin),
    negative: levels.some((l) => l.onHand < 0),
    compatible: vehicle ? matchCompatibility(product.compatibleWith, vehicle) : false,
  };
}

async function assertUnique(
  tenantDb: TenantDb,
  input: { sku?: string; barcode?: string | null },
  excludeId?: string,
) {
  if (input.sku) {
    const sku = await tenantDb.product.findFirst({
      where: {
        sku: { equals: input.sku, mode: "insensitive" },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (sku) {
      throw new TRPCError({ code: "CONFLICT", message: `Le SKU ${input.sku} existe déjà.` });
    }
  }
  if (input.barcode) {
    const barcode = await tenantDb.product.findFirst({
      where: { barcode: input.barcode, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (barcode) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Ce code-barres est déjà affecté au produit « ${barcode.name} ».`,
      });
    }
  }
}

function productData(input: Partial<z.infer<typeof productInputSchema>>) {
  const data: Prisma.ProductUncheckedUpdateInput = {};
  for (const key of [
    "sku",
    "name",
    "brand",
    "oemReference",
    "barcode",
    "category",
    "unit",
    "salePrice",
    "minSalePrice",
    "vatRate",
    "minStock",
    "reorderQty",
    "packSize",
    "isStocked",
    "defaultSupplierId",
  ] as const) {
    if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
  }
  if (input.crossReferences) {
    data.crossReferences = [...new Set(input.crossReferences.map(normalizeReference))];
  }
  if (input.compatibleWith) data.compatibleWith = [...new Set(input.compatibleWith)];
  return data;
}

export const productRouter = router({
  search: requirePermission("stock:read")
    .input(productSearchInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = input.vehicleId
        ? await tenantDb.vehicle.findFirst({
            where: { id: input.vehicleId },
            select: { make: true, model: true, year: true },
          })
        : null;
      const q = input.barcode ?? input.q;
      const barcodeOnly = !!input.barcode || (q ? looksLikeBarcode(q) : false);
      const where: Prisma.ProductWhereInput = {
        isActive: input.filter !== "inactive",
        ...(input.category ? { category: input.category } : {}),
        ...(barcodeOnly && q
          ? { OR: [{ barcode: q.trim() }, { crossReferences: { has: q.trim() } }] }
          : await searchWhere(tenantDb, q)),
        ...(input.filter === "negative" ? { stockLevels: { some: { onHand: { lt: 0 } } } } : {}),
      };
      const showCost = canSeeCost(ctx);
      // « Sous le mini » et « compatible d'abord » se calculent sur le résultat : on charge
      // alors toutes les correspondances (catalogue de quelques milliers de références).
      const inMemory = input.filter === "belowMin" || !!vehicle;
      const offset = input.cursor ?? 0;
      const rows = await tenantDb.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        ...(inMemory ? { take: 2000 } : { skip: offset, take: input.limit + 1 }),
      });
      let items = rows.map((p) => present(p, showCost, ctx.allowedSiteIds, vehicle));
      if (input.siteId) {
        requireSite(ctx, input.siteId);
        items = items.map((p) => ({
          ...p,
          levels: p.levels.filter((l) => l.siteId === input.siteId),
        }));
      }
      if (input.filter === "belowMin") {
        items = items.filter((p) => p.levels.some((l) => l.belowMin));
      }
      if (vehicle) {
        items.sort((a, b) => Number(b.compatible) - Number(a.compatible));
      }
      if (inMemory) {
        const page = items.slice(offset, offset + input.limit);
        return {
          items: page,
          nextCursor: offset + input.limit < items.length ? offset + input.limit : null,
        };
      }
      return {
        items: items.slice(0, input.limit),
        nextCursor: items.length > input.limit ? offset + input.limit : null,
      };
    }),

  categories: requirePermission("stock:read").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const rows = await tenantDb.product.groupBy({
      by: ["category"],
      where: { category: { not: null } },
      orderBy: { category: "asc" },
    });
    return rows.map((r) => r.category!).filter(Boolean);
  }),

  get: requirePermission("stock:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const product = await tenantDb.product.findFirst({
        where: { id: input.id },
        include: PRODUCT_INCLUDE,
      });
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Produit introuvable." });
      const showCost = canSeeCost(ctx);
      const reservations = await tenantDb.stockReservation.findMany({
        where: { productId: product.id, status: { in: ["RESERVED", "BACKORDERED"] } },
        include: { site: { select: { code: true } } },
        orderBy: { createdAt: "asc" },
      });
      const roIds = [
        ...new Set(reservations.map((r) => r.repairOrderId).filter((x): x is string => !!x)),
      ];
      const orders = roIds.length
        ? await tenantDb.repairOrder.findMany({
            where: { id: { in: roIds } },
            select: { id: true, number: true, vehicle: { select: { plate: true } } },
          })
        : [];
      const movements = await tenantDb.stockMovement.findMany({
        where: { productId: product.id },
        include: {
          site: { select: { code: true } },
          repairOrder: { select: { number: true } },
          purchaseOrder: { select: { number: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
      });
      const purchaseLines = await tenantDb.purchaseOrderLine.findMany({
        where: { productId: product.id, purchaseOrder: { status: { not: "CANCELLED" } } },
        include: {
          purchaseOrder: {
            select: {
              id: true,
              number: true,
              orderedAt: true,
              supplier: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { purchaseOrder: { orderedAt: { sort: "desc", nulls: "last" } } },
        take: 30,
      });
      const suppliers = new Map<
        string,
        {
          supplierId: string;
          name: string;
          lastCost: number | null;
          lastOrderAt: Date | null;
          number: string;
        }
      >();
      for (const line of purchaseLines) {
        const s = line.purchaseOrder.supplier;
        if (!suppliers.has(s.id)) {
          suppliers.set(s.id, {
            supplierId: s.id,
            name: s.name,
            lastCost: showCost ? (line.receivedCost ?? line.unitCost) : null,
            lastOrderAt: line.purchaseOrder.orderedAt,
            number: line.purchaseOrder.number,
          });
        }
      }
      return {
        product: present(product, showCost, ctx.allowedSiteIds),
        reservations: reservations.map((r) => {
          const ro = orders.find((o) => o.id === r.repairOrderId);
          return {
            id: r.id,
            siteId: r.siteId,
            siteCode: r.site.code,
            quantity: r.quantity,
            status: r.status,
            createdAt: r.createdAt,
            note: r.note,
            repairOrderId: r.repairOrderId,
            repairOrderNumber: ro?.number ?? null,
            plate: ro?.vehicle.plate ?? null,
          };
        }),
        movements: movements.map((m) => ({
          id: m.id,
          type: m.type,
          quantity: m.quantity,
          siteCode: m.site.code,
          unitCost: showCost ? m.unitCost : null,
          costAfter: showCost ? m.costAfter : null,
          reason: m.reason,
          reasonCode: m.reasonCode,
          repairOrderNumber: m.repairOrder?.number ?? null,
          purchaseOrderNumber: m.purchaseOrder?.number ?? null,
          createdAt: m.createdAt,
        })),
        suppliers: [...suppliers.values()],
        canSeeCost: showCost,
      };
    }),

  create: requirePermission("product:manage")
    .input(productInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await assertUnique(tenantDb, input);
      const product = await tenantDb.product.create({
        data: {
          ...(productData(input) as Prisma.ProductUncheckedCreateInput),
          organizationId: ctx.organizationId,
          sku: input.sku,
          name: input.name,
          quantityScale: defaultQuantityScale(input.unit),
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "product.created",
        entity: "product",
        entityId: product.id,
        after: { sku: product.sku, name: product.name },
      });
      return product;
    }),

  update: requirePermission("product:manage")
    .input(productUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.product.findFirst({ where: { id: input.id } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Produit introuvable." });
      await assertUnique(
        tenantDb,
        {
          sku: input.sku && input.sku !== before.sku ? input.sku : undefined,
          barcode: input.barcode && input.barcode !== before.barcode ? input.barcode : undefined,
        },
        before.id,
      );
      const data = productData(input);
      if (input.unit && input.unit !== before.unit) {
        const scale = defaultQuantityScale(input.unit);
        if (scale !== before.quantityScale) {
          const moved = await tenantDb.stockMovement.count({ where: { productId: before.id } });
          if (moved > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Impossible de changer l'unité de précision d'un produit qui a déjà des mouvements de stock.",
            });
          }
          data.quantityScale = scale;
        }
      }
      const product = await tenantDb.product.update({ where: { id: before.id }, data });
      const priceChanged =
        before.salePrice !== product.salePrice || before.minSalePrice !== product.minSalePrice;
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: priceChanged ? "product.price_changed" : "product.updated",
        entity: "product",
        entityId: product.id,
        before: {
          salePrice: before.salePrice,
          minSalePrice: before.minSalePrice,
          name: before.name,
        },
        after: {
          salePrice: product.salePrice,
          minSalePrice: product.minSalePrice,
          name: product.name,
        },
      });
      return product;
    }),

  archive: requirePermission("product:manage")
    .input(z.object({ id: z.string().min(1), archived: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const product = await tenantDb.product.findFirst({
        where: { id: input.id },
        include: { stockLevels: true },
      });
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Produit introuvable." });
      if (input.archived) {
        const onHand = product.stockLevels.some((l) => l.onHand !== 0);
        const open = await tenantDb.stockReservation.count({
          where: { productId: product.id, status: { in: ["RESERVED", "BACKORDERED"] } },
        });
        if (onHand || open > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: onHand
              ? "Archivage impossible : il reste du stock pour ce produit."
              : "Archivage impossible : des réservations sont encore ouvertes.",
          });
        }
      }
      const updated = await tenantDb.product.update({
        where: { id: product.id },
        data: { isActive: !input.archived },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: input.archived ? "product.archived" : "product.restored",
        entity: "product",
        entityId: product.id,
      });
      return updated;
    }),

  /** Seuils et emplacement par site (StockLevel.minStock/maxStock/binLocation). */
  setLevelSettings: requirePermission("product:manage")
    .input(levelSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const product = await tenantDb.product.findFirst({ where: { id: input.productId } });
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Produit introuvable." });
      const toBase = (v: number | null | undefined) =>
        v == null ? null : baseQty(v, product.quantityScale);
      const level = await tenantDb.stockLevel.findFirst({
        where: { siteId: input.siteId, productId: product.id },
      });
      const data = {
        ...(input.minStock !== undefined ? { minStock: toBase(input.minStock) } : {}),
        ...(input.maxStock !== undefined ? { maxStock: toBase(input.maxStock) } : {}),
        ...(input.binLocation !== undefined ? { binLocation: input.binLocation } : {}),
      };
      if (level) return tenantDb.stockLevel.update({ where: { id: level.id }, data });
      return tenantDb.stockLevel.create({
        data: {
          organizationId: ctx.organizationId,
          siteId: input.siteId,
          productId: product.id,
          ...data,
        },
      });
    }),

  /** US-M07-12 / RG-M07-13 : contrôle du prix d'une ligne PART/CONSUMABLE (devis, OR, facture). */
  checkPrice: requirePermission("stock:read")
    .input(checkPriceInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const product = await tenantDb.product.findFirst({ where: { id: input.productId } });
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Produit introuvable." });
      const result = checkSalePrice({
        unitPrice: input.unitPrice,
        discountRate: input.discountRate,
        minSalePrice: product.minSalePrice,
        averageCost: product.averageCost,
      });
      return {
        ...result,
        canOverride: ctx.permissions.has("invoice:price_below_min"),
        // Le CMP n'est révélé qu'aux rôles autorisés ; l'alerte « vente à perte » reste visible.
        averageCost: canSeeCost(ctx) ? result.averageCost : null,
        marginRate: canSeeCost(ctx) ? result.marginRate : null,
      };
    }),

  /** Libellés et quantités d'affichage pour un ensemble de produits (lignes de documents). */
  byIds: requirePermission("stock:read")
    .input(z.object({ ids: z.array(z.string().min(1)).max(200) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const rows = await tenantDb.product.findMany({
        where: { id: { in: input.ids } },
        include: PRODUCT_INCLUDE,
      });
      return rows.map((p) => present(p, canSeeCost(ctx), ctx.allowedSiteIds));
    }),
});
