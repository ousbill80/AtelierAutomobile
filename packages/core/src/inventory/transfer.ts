// RG-M07-15 / US-M07-10 — transferts inter-sites.
import { DomainError } from "../errors";

export type StockTransferStatusLike = "DRAFT" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";
export type StockCountStatusLike =
  "DRAFT" | "IN_PROGRESS" | "SUBMITTED" | "VALIDATED" | "CANCELLED";

const TRANSFER_TRANSITIONS: Record<StockTransferStatusLike, StockTransferStatusLike[]> = {
  DRAFT: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

export function assertTransferTransition(
  from: StockTransferStatusLike,
  to: StockTransferStatusLike,
): void {
  if (!TRANSFER_TRANSITIONS[from].includes(to)) {
    throw new DomainError(
      "transfer.invalid_transition",
      "Cette action n'est pas possible au statut actuel du transfert.",
      { from, to },
    );
  }
}

const COUNT_TRANSITIONS: Record<StockCountStatusLike, StockCountStatusLike[]> = {
  DRAFT: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["VALIDATED", "CANCELLED", "IN_PROGRESS"],
  VALIDATED: [],
  CANCELLED: [],
};

export function assertCountTransition(from: StockCountStatusLike, to: StockCountStatusLike): void {
  if (!COUNT_TRANSITIONS[from].includes(to)) {
    throw new DomainError(
      "count.invalid_transition",
      "Cette action n'est pas possible au statut actuel de l'inventaire.",
      { from, to },
    );
  }
}

export interface TransferLineReceipt {
  lineId: string;
  quantity: number;
  receivedQty: number;
}

/** Écart à la réception (quantité envoyée − reçue), à justifier en perte sur le site d'envoi. */
export function transferShortfalls(
  lines: TransferLineReceipt[],
): { lineId: string; shortfall: number }[] {
  return lines
    .map((l) => {
      if (l.receivedQty < 0 || l.receivedQty > l.quantity) {
        throw new DomainError(
          "transfer.invalid_received_qty",
          "La quantité reçue doit être comprise entre 0 et la quantité envoyée.",
          { lineId: l.lineId },
        );
      }
      return { lineId: l.lineId, shortfall: l.quantity - l.receivedQty };
    })
    .filter((l) => l.shortfall > 0);
}
