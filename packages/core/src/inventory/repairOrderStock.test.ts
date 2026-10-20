import { describe, expect, it } from "vitest";
import {
  isReservableLine,
  isStockLine,
  lineBaseQty,
  lineStockState,
  planLineStock,
} from "./repairOrderStock";

const part = {
  type: "PART",
  productId: "p1",
  isCustomerSupplied: false,
  status: "PENDING",
  approval: "APPROVED",
};

describe("réservations d'un OR (RG-M04-09 / RG-M07-04)", () => {
  it("ligne de stock : pièce ou consommable du catalogue, non fournie par le client", () => {
    expect(isStockLine(part)).toBe(true);
    expect(isStockLine({ ...part, type: "CONSUMABLE" })).toBe(true);
    expect(isStockLine({ ...part, type: "LABOR" })).toBe(false);
    expect(isStockLine({ ...part, productId: null })).toBe(false);
    expect(isStockLine({ ...part, isCustomerSupplied: true })).toBe(false);
  });

  it("réservable seulement si OR approuvé et ligne approuvée, non annulée", () => {
    expect(isReservableLine(part, "APPROVED")).toBe(true);
    expect(isReservableLine(part, "WAITING_PARTS")).toBe(true);
    expect(isReservableLine(part, "AWAITING_APPROVAL")).toBe(false);
    expect(isReservableLine(part, "CANCELLED")).toBe(false);
    expect(isReservableLine({ ...part, approval: "PENDING" }, "IN_PROGRESS")).toBe(false);
    expect(isReservableLine({ ...part, approval: "DECLINED" }, "IN_PROGRESS")).toBe(false);
    expect(isReservableLine({ ...part, approval: "NOT_REQUIRED" }, "IN_PROGRESS")).toBe(true);
    expect(isReservableLine({ ...part, status: "CANCELLED" }, "IN_PROGRESS")).toBe(false);
    expect(isReservableLine({ ...part, productActive: false }, "IN_PROGRESS")).toBe(false);
  });

  it("plan : réserver le manque, libérer l'excédent, tout libérer si non réservable", () => {
    expect(planLineStock({ reservable: true, target: 4, issued: 0, open: 0 })).toEqual({
      action: "reserve",
      quantity: 4,
    });
    expect(planLineStock({ reservable: true, target: 4, issued: 1, open: 3 })).toEqual({
      action: "none",
    });
    expect(planLineStock({ reservable: true, target: 4, issued: 0, open: 1 })).toEqual({
      action: "reserve",
      quantity: 3,
    });
    expect(planLineStock({ reservable: true, target: 2, issued: 0, open: 4 })).toEqual({
      action: "resync",
      quantity: 2,
    });
    expect(planLineStock({ reservable: false, target: 4, issued: 0, open: 4 })).toEqual({
      action: "resync",
      quantity: 0,
    });
    expect(planLineStock({ reservable: false, target: 4, issued: 0, open: 0 })).toEqual({
      action: "none",
    });
    expect(planLineStock({ reservable: true, target: 4, issued: 5, open: 0 })).toEqual({
      action: "none",
    });
  });

  it("quantité de ligne en unités de base (4,5 L → 45)", () => {
    expect(lineBaseQty(4.5, 10)).toBe(45);
    expect(lineBaseQty(2, 1)).toBe(2);
    expect(lineBaseQty(4.55, 10)).toBe(46);
  });

  it("état de la ligne pour le badge « Pièce manquante »", () => {
    expect(lineStockState({ target: 1, issued: 0, reserved: 0, backordered: 1 })).toBe("missing");
    expect(lineStockState({ target: 3, issued: 0, reserved: 1, backordered: 2 })).toBe("partial");
    expect(lineStockState({ target: 1, issued: 0, reserved: 1, backordered: 0 })).toBe("reserved");
    expect(lineStockState({ target: 1, issued: 1, reserved: 0, backordered: 0 })).toBe("issued");
    expect(lineStockState({ target: 1, issued: 0, reserved: 0, backordered: 0 })).toBe("none");
  });
});
