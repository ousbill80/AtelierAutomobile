// US-M07-10 / RG-M07-15 — transferts inter-sites : TRANSFER_OUT à l'envoi, TRANSFER_IN à la
// réception (au CMP courant) ; un écart de réception est signalé pour justification.
import {
  assertTransferTransition,
  DomainError,
  transferShortfalls,
  type StockTransferStatusLike,
} from "@atelieros/core";
import type { StockTransfer } from "@prisma/client";
import {
  emitStockEvent,
  nextSiteDocumentNumber,
  notifyMembers,
  type StockContext,
  type Tx,
} from "./context";
import { applyMovement, lockProducts } from "./movements";
import { promoteBackorders } from "./reservations";

export async function createTransfer(
  tx: Tx,
  ctx: StockContext,
  input: {
    fromSiteId: string;
    toSiteId: string;
    lines: { productId: string; quantity: number }[];
    notes?: string | null;
    createdById?: string | null;
  },
  now: Date,
): Promise<StockTransfer> {
  if (input.fromSiteId === input.toSiteId) {
    throw new DomainError("transfer.same_site", "Choisissez deux sites différents.");
  }
  const lines = input.lines.filter((l) => l.quantity > 0);
  if (lines.length === 0) {
    throw new DomainError("transfer.empty", "Ajoutez au moins une pièce à transférer.");
  }
  if (new Set(lines.map((l) => l.productId)).size !== lines.length) {
    throw new DomainError(
      "transfer.duplicate_product",
      "Chaque produit ne peut figurer qu'une fois.",
    );
  }
  const number = await nextSiteDocumentNumber(tx, ctx, "TR", input.fromSiteId, now);
  return tx.stockTransfer.create({
    data: {
      organizationId: ctx.organizationId,
      number,
      fromSiteId: input.fromSiteId,
      toSiteId: input.toSiteId,
      notes: input.notes ?? null,
      createdById: input.createdById ?? null,
      lines: {
        create: lines.map((l) => ({
          organizationId: ctx.organizationId,
          productId: l.productId,
          quantity: l.quantity,
        })),
      },
    },
  });
}

/** DRAFT → IN_TRANSIT : TRANSFER_OUT (−q) au site d'envoi. */
export async function shipTransfer(
  tx: Tx,
  ctx: StockContext,
  transferId: string,
  createdById: string | null,
  now: Date,
): Promise<StockTransfer> {
  const transfer = await tx.stockTransfer.findFirstOrThrow({
    where: { id: transferId },
    include: { lines: true },
  });
  assertTransferTransition(transfer.status as StockTransferStatusLike, "IN_TRANSIT");
  await lockProducts(
    tx,
    transfer.lines.map((l) => l.productId),
    now,
  );
  for (const line of transfer.lines) {
    await applyMovement(
      tx,
      ctx,
      {
        siteId: transfer.fromSiteId,
        productId: line.productId,
        type: "TRANSFER_OUT",
        quantity: -line.quantity,
        transferId: transfer.id,
        reason: `Transfert ${transfer.number}`,
        createdById,
        alreadyLocked: true,
      },
      now,
    );
  }
  return tx.stockTransfer.update({
    where: { id: transfer.id },
    data: { status: "IN_TRANSIT", shippedAt: now },
  });
}

/** IN_TRANSIT → RECEIVED : TRANSFER_IN (+reçu) au site d'arrivée ; écart signalé au gérant. */
export async function receiveTransfer(
  tx: Tx,
  ctx: StockContext,
  input: {
    transferId: string;
    lines: { lineId: string; receivedQty: number }[];
    createdById: string | null;
  },
  now: Date,
): Promise<{ transfer: StockTransfer; shortfalls: { lineId: string; shortfall: number }[] }> {
  const transfer = await tx.stockTransfer.findFirstOrThrow({
    where: { id: input.transferId },
    include: { lines: { include: { product: { select: { name: true } } } } },
  });
  assertTransferTransition(transfer.status as StockTransferStatusLike, "RECEIVED");
  const receipts = transfer.lines.map((line) => ({
    lineId: line.id,
    quantity: line.quantity,
    receivedQty: input.lines.find((l) => l.lineId === line.id)?.receivedQty ?? line.quantity,
  }));
  const shortfalls = transferShortfalls(receipts);
  await lockProducts(
    tx,
    transfer.lines.map((l) => l.productId),
    now,
  );
  for (const line of transfer.lines) {
    const receivedQty = receipts.find((r) => r.lineId === line.id)!.receivedQty;
    await tx.stockTransferLine.update({ where: { id: line.id }, data: { receivedQty } });
    if (receivedQty > 0) {
      await applyMovement(
        tx,
        ctx,
        {
          siteId: transfer.toSiteId,
          productId: line.productId,
          type: "TRANSFER_IN",
          quantity: receivedQty,
          transferId: transfer.id,
          reason: `Transfert ${transfer.number}`,
          createdById: input.createdById,
          alreadyLocked: true,
        },
        now,
      );
      await promoteBackorders(tx, ctx, transfer.toSiteId, line.productId, now);
    }
  }
  const updated = await tx.stockTransfer.update({
    where: { id: transfer.id },
    data: { status: "RECEIVED", receivedAt: now },
  });
  await emitStockEvent(tx, ctx.organizationId, "stock.received", {
    transferId: transfer.id,
    siteId: transfer.toSiteId,
    productIds: transfer.lines.map((l) => l.productId),
  });
  if (shortfalls.length > 0) {
    const detail = shortfalls
      .map((s) => {
        const line = transfer.lines.find((l) => l.id === s.lineId)!;
        return `${line.product.name} : ${s.shortfall}`;
      })
      .join(", ");
    await notifyMembers(
      tx,
      ctx.organizationId,
      { roles: ["OWNER", "MANAGER"] },
      {
        type: "stock.transfer_shortfall",
        title: `Écart à la réception du transfert ${transfer.number}`,
        body: `Manquant(s) à justifier sur le site d'envoi — ${detail}.`,
        link: "/stock/transferts",
        severity: "warning",
        dedupeKey: `stock.transfer_shortfall:${transfer.id}`,
      },
    );
  }
  return { transfer: updated, shortfalls };
}

export async function cancelTransfer(tx: Tx, transferId: string): Promise<StockTransfer> {
  const transfer = await tx.stockTransfer.findFirstOrThrow({ where: { id: transferId } });
  assertTransferTransition(transfer.status as StockTransferStatusLike, "CANCELLED");
  return tx.stockTransfer.update({ where: { id: transfer.id }, data: { status: "CANCELLED" } });
}
