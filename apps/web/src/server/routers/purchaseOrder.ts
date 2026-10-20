// M07 §8 — bons de commande : liste, fiche, création / modification, envoi (WhatsApp, email,
// lien wa.me ou « marquer comme envoyé »), réception, solde, annulation, retour fournisseur,
// suggestions de réapprovisionnement et création des BC en un clic.
import {
  assertPurchaseLineEdit,
  buildPurchaseOrderMessage,
  buildWaLinkUrl,
  computePurchaseOrderTotal,
  formatDate,
  formatFCFA,
  formatQty,
  isPurchaseOrderLate,
  priceVariance,
  valueOf,
  type PurchaseOrderStatusLike,
} from "@atelieros/core";
import {
  adminDb,
  applyMovement,
  cancelPurchaseOrder,
  closePurchaseOrder,
  computeReorderSuggestions,
  db,
  nextSiteDocumentNumber,
  receivePurchaseOrder,
  type Prisma,
  type ScopedTenantClient,
  type StockContext,
} from "@atelieros/db";
import {
  createFromSuggestionsInputSchema,
  purchaseOrderCreateInputSchema,
  purchaseOrderListInputSchema,
  purchaseOrderReasonInputSchema,
  purchaseOrderReceiveInputSchema,
  purchaseOrderSendInputSchema,
  purchaseOrderUpdateInputSchema,
  suggestionsInputSchema,
  supplierReturnInputSchema,
} from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { messagingEnqueue } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";
import { baseQty, canSeeCost, siteFilter, stockNow, stockTx } from "../stock/helpers";
import { requirePermission, requireSite, router } from "../trpc";

const PO_INCLUDE = {
  supplier: true,
  site: { select: { id: true, code: true, name: true } },
  lines: {
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          quantityScale: true,
          barcode: true,
          purchasePrice: true,
        },
      },
    },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.PurchaseOrderInclude;

function dateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

type LineInput = { productId: string; quantity: number; unitCost: number };

async function toBaseLines(tx: ScopedTenantClient, lines: LineInput[]) {
  const products = await tx.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) } },
    select: { id: true, quantityScale: true },
  });
  return lines.map((l) => {
    const p = products.find((x) => x.id === l.productId);
    if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Produit introuvable." });
    return {
      productId: p.id,
      quantity: baseQty(l.quantity, p.quantityScale),
      unitCost: l.unitCost,
      quantityScale: p.quantityScale,
    };
  });
}

async function createOrder(
  tx: ScopedTenantClient,
  stock: StockContext,
  input: {
    supplierId: string;
    siteId: string;
    lines: LineInput[];
    repairOrderId?: string | null;
    expectedAt?: string | null;
    notes?: string | null;
  },
  now: Date,
) {
  await tx.supplier.findFirstOrThrow({ where: { id: input.supplierId } });
  const lines = await toBaseLines(tx, input.lines);
  const number = await nextSiteDocumentNumber(tx, stock, "BC", input.siteId, now);
  return tx.purchaseOrder.create({
    data: {
      organizationId: stock.organizationId,
      siteId: input.siteId,
      supplierId: input.supplierId,
      number,
      repairOrderId: input.repairOrderId ?? null,
      expectedAt: dateOnly(input.expectedAt) ?? null,
      notes: input.notes ?? null,
      total: computePurchaseOrderTotal(lines.map((l) => ({ ...l, receivedQty: 0 }))),
      lines: {
        create: lines.map((l) => ({
          organizationId: stock.organizationId,
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
        })),
      },
    },
  });
}

async function recomputeTotal(tx: ScopedTenantClient, purchaseOrderId: string) {
  const lines = await tx.purchaseOrderLine.findMany({
    where: { purchaseOrderId },
    include: { product: { select: { quantityScale: true } } },
  });
  return tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: {
      total: computePurchaseOrderTotal(
        lines.map((l) => ({ ...l, quantityScale: l.product.quantityScale })),
      ),
    },
  });
}

export const purchaseOrderRouter = router({
  list: requirePermission("purchase:read")
    .input(purchaseOrderListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = stockNow();
      const rows = await tenantDb.purchaseOrder.findMany({
        where: {
          ...siteFilter(ctx),
          ...(input.status ? { status: input.status } : {}),
          ...(input.supplierId ? { supplierId: input.supplierId } : {}),
          ...(input.late
            ? { status: { in: ["SENT", "PARTIALLY_RECEIVED"] }, expectedAt: { lt: now } }
            : {}),
        },
        include: {
          supplier: { select: { id: true, name: true } },
          site: { select: { code: true } },
          _count: { select: { lines: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 300,
      });
      return rows.map((po) => ({
        id: po.id,
        number: po.number,
        status: po.status,
        supplier: po.supplier,
        siteCode: po.site.code,
        total: po.total,
        lines: po._count.lines,
        orderedAt: po.orderedAt,
        expectedAt: po.expectedAt,
        receivedAt: po.receivedAt,
        createdAt: po.createdAt,
        late: isPurchaseOrderLate(po, now),
      }));
    }),

  get: requirePermission("purchase:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const po = await tenantDb.purchaseOrder.findFirst({
        where: { id: input.id },
        include: PO_INCLUDE,
      });
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Bon de commande introuvable." });
      requireSite(ctx, po.siteId);
      const movements = await tenantDb.stockMovement.findMany({
        where: { purchaseOrderId: po.id },
        include: { product: { select: { name: true, unit: true, quantityScale: true } } },
        orderBy: { createdAt: "asc" },
      });
      const attachments = await tenantDb.attachment.findMany({
        where: { entity: "purchase_order", entityId: po.id },
        orderBy: { createdAt: "asc" },
      });
      const repairOrder = po.repairOrderId
        ? await tenantDb.repairOrder.findFirst({
            where: { id: po.repairOrderId },
            select: { id: true, number: true, vehicle: { select: { plate: true } } },
          })
        : null;
      const showCost = canSeeCost(ctx);
      return {
        ...po,
        repairOrder,
        late: isPurchaseOrderLate(po, stockNow()),
        lines: po.lines.map((l) => ({
          ...l,
          variance: l.receivedCost != null ? priceVariance(l.unitCost, l.receivedCost) : null,
          product: { ...l.product, purchasePrice: showCost ? l.product.purchasePrice : null },
        })),
        movements: movements.map((m) => ({
          id: m.id,
          type: m.type,
          quantity: m.quantity,
          unitCost: showCost ? m.unitCost : null,
          product: m.product,
          createdAt: m.createdAt,
        })),
        attachments,
        waLink:
          po.supplier.whatsappPhone || po.supplier.phone
            ? buildWaLinkUrl(
                (po.supplier.whatsappPhone ?? po.supplier.phone)!,
                await messageFor(ctx.organizationId, po).then((m) => m.body),
              )
            : null,
      };
    }),

  create: requirePermission("purchase:create")
    .input(purchaseOrderCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const po = await stockTx(ctx.organizationId, (tx, stock, now) =>
        createOrder(tx, stock, input, now),
      );
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: po.siteId,
        action: "purchase_order.created",
        entity: "purchase_order",
        entityId: po.id,
        after: { number: po.number, total: po.total },
      });
      return po;
    }),

  /** RG-M07-08 : modifiable en DRAFT ; en SENT, ajout de lignes (audit) sans réduire sous le reçu. */
  update: requirePermission("purchase:create")
    .input(purchaseOrderUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await stockTx(ctx.organizationId, async (tx) => {
        const po = await tx.purchaseOrder.findFirstOrThrow({
          where: { id: input.id },
          include: { lines: true },
        });
        requireSite(ctx, po.siteId);
        const status = po.status as PurchaseOrderStatusLike;
        if (status === "RECEIVED" || status === "CANCELLED") {
          assertPurchaseLineEdit(status, { kind: "update" });
        }
        if (input.lines) {
          const lines = await toBaseLines(tx, input.lines);
          const keptIds = new Set(input.lines.map((l) => l.lineId).filter(Boolean));
          for (const existing of po.lines) {
            if (!keptIds.has(existing.id)) {
              assertPurchaseLineEdit(status, { kind: "remove" });
              await tx.purchaseOrderLine.delete({ where: { id: existing.id } });
            }
          }
          for (const [i, l] of lines.entries()) {
            const lineId = input.lines[i]!.lineId;
            const existing = lineId ? po.lines.find((x) => x.id === lineId) : undefined;
            if (existing) {
              if (existing.quantity === l.quantity && existing.unitCost === l.unitCost) continue;
              assertPurchaseLineEdit(status, {
                kind: "update",
                quantity: l.quantity,
                receivedQty: existing.receivedQty,
              });
              if (status !== "DRAFT" && existing.unitCost !== l.unitCost) {
                assertPurchaseLineEdit(status, { kind: "remove" });
              }
              await tx.purchaseOrderLine.update({
                where: { id: existing.id },
                data: { quantity: l.quantity, unitCost: l.unitCost },
              });
            } else {
              assertPurchaseLineEdit(status, { kind: "add" });
              await tx.purchaseOrderLine.create({
                data: {
                  organizationId: ctx.organizationId,
                  purchaseOrderId: po.id,
                  productId: l.productId,
                  quantity: l.quantity,
                  unitCost: l.unitCost,
                },
              });
            }
          }
        }
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            ...(input.expectedAt !== undefined ? { expectedAt: dateOnly(input.expectedAt) } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
          },
        });
        return { before: po, after: await recomputeTotal(tx, po.id) };
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: result.after.siteId,
        action: "purchase_order.updated",
        entity: "purchase_order",
        entityId: result.after.id,
        before: {
          status: result.before.status,
          total: result.before.total,
          lines: result.before.lines.length,
        },
        after: { total: result.after.total },
      });
      return result.after;
    }),

  /** US-M07-07 : envoi au fournisseur. En cas d'échec, le BC reste DRAFT avec le message M11. */
  send: requirePermission("purchase:create")
    .input(purchaseOrderSendInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const po = await tenantDb.purchaseOrder.findFirst({
        where: { id: input.id },
        include: PO_INCLUDE,
      });
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "Bon de commande introuvable." });
      requireSite(ctx, po.siteId);
      if (po.status !== "DRAFT" && po.status !== "SENT") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ce bon de commande a déjà été traité.",
        });
      }
      if (po.lines.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ajoutez au moins une ligne avant l'envoi.",
        });
      }
      const message = await messageFor(ctx.organizationId, po);
      const now = stockNow();
      let messageId: string | null = null;
      let waLink: string | null = null;

      const updated = await stockTx(ctx.organizationId, async (tx) => {
        if (input.channel === "WHATSAPP" || input.channel === "EMAIL") {
          const to =
            input.channel === "WHATSAPP"
              ? { whatsapp: po.supplier.whatsappPhone ?? po.supplier.phone, name: po.supplier.name }
              : { email: po.supplier.email, name: po.supplier.name };
          if (!(to.whatsapp || to.email)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                input.channel === "WHATSAPP"
                  ? "Ce fournisseur n'a pas de numéro WhatsApp : téléchargez le PDF ou partagez via wa.me."
                  : "Ce fournisseur n'a pas d'adresse email : téléchargez le PDF ou partagez via wa.me.",
            });
          }
          const result = await messagingEnqueue(tx, ctx.organizationId, {
            idempotencyKey: `po:${po.id}:sent:${input.channel}`,
            kind: "transactional",
            to,
            channels: [input.channel],
            bodyOverride: message.body,
            subjectOverride: message.subject,
            sentById: ctx.membership.id,
          });
          if ("reason" in result) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Envoi impossible : aucun canal actif pour ce fournisseur. Partagez via wa.me ou marquez le bon comme envoyé.",
            });
          }
          messageId = result.created ? result.message.id : null;
        } else if (input.channel === "LINK") {
          const phone = po.supplier.whatsappPhone ?? po.supplier.phone;
          if (!phone) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Ce fournisseur n'a pas de numéro : téléchargez le PDF et transmettez-le.",
            });
          }
          waLink = buildWaLinkUrl(phone, message.body);
        }
        if (po.status === "SENT") return po;
        await tx.domainEvent.create({
          data: {
            organizationId: ctx.organizationId,
            type: "purchase_order.sent",
            payload: { purchaseOrderId: po.id, channel: input.channel } as Prisma.InputJsonValue,
          },
        });
        return tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: "SENT", orderedAt: now },
        });
      });
      if (messageId) await enqueueMessageSendJob(messageId);
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: po.siteId,
        action: "purchase_order.sent",
        entity: "purchase_order",
        entityId: po.id,
        after: { channel: input.channel, number: po.number },
      });
      return { purchaseOrder: updated, waLink };
    }),

  /** US-M07-08 : réception (partielle), frais d'approche, hors commande, écarts de prix. */
  receive: requirePermission("stock:receive")
    .input(purchaseOrderReceiveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await stockTx(ctx.organizationId, async (tx, stock, now) => {
        const po = await tx.purchaseOrder.findFirstOrThrow({
          where: { id: input.id },
          include: { lines: { include: { product: { select: { quantityScale: true } } } } },
        });
        requireSite(ctx, po.siteId);
        const lines = input.lines
          .filter((l) => l.quantity > 0)
          .map((l) => {
            const line = po.lines.find((x) => x.id === l.lineId);
            if (!line)
              throw new TRPCError({ code: "NOT_FOUND", message: "Ligne de commande introuvable." });
            return {
              lineId: line.id,
              quantity: baseQty(l.quantity, line.product.quantityScale),
              unitCost: l.unitCost,
            };
          });
        const extraLines = (await toBaseLines(tx, input.extraLines)).map(
          ({ productId, quantity, unitCost }) => ({
            productId,
            quantity,
            unitCost,
          }),
        );
        return receivePurchaseOrder(
          tx,
          stock,
          {
            purchaseOrderId: po.id,
            lines,
            extraLines,
            landedCosts: input.landedCosts,
            confirmAberrantPrices: input.confirmAberrantPrices,
            createdById: ctx.membership.id,
          },
          now,
        );
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: result.purchaseOrder.siteId,
        action:
          input.extraLines.length > 0 ? "purchase_order.received_extra" : "purchase_order.received",
        entity: "purchase_order",
        entityId: result.purchaseOrder.id,
        after: {
          status: result.purchaseOrder.status,
          movements: result.movements.length,
          priceVariances: result.priceVariances.length,
          extraLines: input.extraLines.length,
        },
      });
      return result;
    }),

  /** « Solder le reliquat » : passe RECEIVED sans attendre le reste (motif). */
  close: requirePermission("stock:receive")
    .input(purchaseOrderReasonInputSchema)
    .mutation(async ({ ctx, input }) => {
      const po = await stockTx(ctx.organizationId, async (tx, _stock, now) => {
        const existing = await tx.purchaseOrder.findFirstOrThrow({ where: { id: input.id } });
        requireSite(ctx, existing.siteId);
        return closePurchaseOrder(tx, existing.id, now);
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: po.siteId,
        action: "purchase_order.closed",
        entity: "purchase_order",
        entityId: po.id,
        reason: input.reason,
      });
      return po;
    }),

  cancel: requirePermission("purchase:approve")
    .input(purchaseOrderReasonInputSchema)
    .mutation(async ({ ctx, input }) => {
      const po = await stockTx(ctx.organizationId, async (tx) => {
        const existing = await tx.purchaseOrder.findFirstOrThrow({ where: { id: input.id } });
        requireSite(ctx, existing.siteId);
        return cancelPurchaseOrder(tx, existing.id);
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: po.siteId,
        action: "purchase_order.cancelled",
        entity: "purchase_order",
        entityId: po.id,
        reason: input.reason,
      });
      return po;
    }),

  /** RG-M07-16 : retour fournisseur (SUPPLIER_RETURN au coût d'achat d'origine), avoir attendu. */
  supplierReturn: requirePermission("stock:receive")
    .input(supplierReturnInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await stockTx(ctx.organizationId, async (tx, stock, now) => {
        const po = await tx.purchaseOrder.findFirstOrThrow({
          where: { id: input.purchaseOrderId },
          include: { lines: { include: { product: true } } },
        });
        requireSite(ctx, po.siteId);
        const line = po.lines.find((l) => l.id === input.lineId);
        if (!line)
          throw new TRPCError({ code: "NOT_FOUND", message: "Ligne de commande introuvable." });
        const quantity = baseQty(input.quantity, line.product.quantityScale);
        const returned = await tx.stockMovement.aggregate({
          where: { purchaseOrderId: po.id, productId: line.productId, type: "SUPPLIER_RETURN" },
          _sum: { quantity: true },
        });
        if (quantity > line.receivedQty + (returned._sum.quantity ?? 0)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La quantité retournée dépasse la quantité reçue sur ce bon de commande.",
          });
        }
        const { movement, plan } = await applyMovement(
          tx,
          stock,
          {
            siteId: po.siteId,
            productId: line.productId,
            type: "SUPPLIER_RETURN",
            quantity: -quantity,
            unitCost: line.receivedCost ?? line.unitCost,
            purchaseOrderId: po.id,
            reason: input.reason,
            createdById: ctx.membership.id,
          },
          now,
        );
        const credit = valueOf(quantity, line.product.quantityScale, plan.unitCost);
        const note = `Avoir fournisseur attendu : ${formatFCFA(credit)} (retour de ${formatQty(quantity, line.product.quantityScale)} ${line.product.unit} ${line.product.name}, ${formatDate(now, stock.timezone)}).`;
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { notes: [po.notes, note].filter(Boolean).join("\n") },
        });
        return { movement, credit, siteId: po.siteId };
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: result.siteId,
        action: "purchase_order.supplier_return",
        entity: "purchase_order",
        entityId: input.purchaseOrderId,
        after: { credit: result.credit, quantity: input.quantity },
        reason: input.reason,
      });
      return result;
    }),

  /** US-M07-06 : suggestions de réapprovisionnement du site, groupées par fournisseur. */
  suggestions: requirePermission("purchase:create")
    .input(suggestionsInputSchema)
    .query(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      return stockTx(ctx.organizationId, (tx) => computeReorderSuggestions(tx, input.siteId));
    }),

  createFromSuggestions: requirePermission("purchase:create")
    .input(createFromSuggestionsInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireSite(ctx, input.siteId);
      const orders = await stockTx(ctx.organizationId, async (tx, stock, now) => {
        const created = [];
        for (const order of input.orders) {
          created.push(
            await createOrder(
              tx,
              stock,
              { supplierId: order.supplierId, siteId: input.siteId, lines: order.lines },
              now,
            ),
          );
        }
        return created;
      });
      for (const po of orders) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          siteId: po.siteId,
          action: "purchase_order.created",
          entity: "purchase_order",
          entityId: po.id,
          after: { number: po.number, total: po.total, fromSuggestions: true },
        });
      }
      return orders;
    }),
});

/** Texte du BC (M11) à partir du bon et de l'organisation. */
async function messageFor(
  organizationId: string,
  po: Prisma.PurchaseOrderGetPayload<{ include: typeof PO_INCLUDE }>,
) {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, timezone: true },
  });
  return buildPurchaseOrderMessage({
    garageName: org.name,
    siteName: po.site.name,
    number: po.number,
    supplierName: po.supplier.name,
    expectedAt: po.expectedAt ? formatDate(po.expectedAt, "UTC") : null,
    total: po.total,
    lines: po.lines.map((l) => ({
      sku: l.product.sku,
      name: l.product.name,
      unit: l.product.unit,
      quantity: l.quantity,
      quantityScale: l.product.quantityScale,
      unitCost: l.unitCost,
    })),
  });
}
