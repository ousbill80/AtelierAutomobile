import { describe, expect, it } from "vitest";
import { defaultQuantityScale, formatQty, fromBaseQty, toBaseQty, valueOf } from "./units";

describe("unités (RG-M07-01)", () => {
  it("4,5 L ↔ 45", () => {
    expect(toBaseQty(4.5, 10)).toBe(45);
    expect(fromBaseQty(45, 10)).toBe(4.5);
    expect(formatQty(45, 10)).toBe("4,5");
    expect(formatQty(2080, 10)).toBe("208");
  });

  it("refuse 4,55 L (précision)", () => {
    expect(() => toBaseQty(4.55, 10)).toThrow("Quantité trop précise");
    expect(() => toBaseQty(1.5, 1)).toThrow("quantité entière attendue");
  });

  it("tolère les erreurs d'arrondi binaire (0,1 + 0,2)", () => {
    expect(toBaseQty(0.1 + 0.2, 10)).toBe(3);
  });

  it("échelle par défaut : 10 pour litre et kg", () => {
    expect(defaultQuantityScale("litre")).toBe(10);
    expect(defaultQuantityScale("kg")).toBe(10);
    expect(defaultQuantityScale("pièce")).toBe(1);
  });

  it("valeur : 4,5 L à 4 800 FCFA/L → 21 600", () => {
    expect(valueOf(45, 10, 4800)).toBe(21600);
    expect(valueOf(-1, 1, 3688)).toBe(-3688);
  });
});
