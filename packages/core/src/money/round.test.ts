import { describe, expect, it } from "vitest";
import { roundHalfUp } from "./round";

describe("roundHalfUp", () => {
  it("arrondit vers le haut en valeur absolue au demi", () => {
    expect(roundHalfUp(5143.5)).toBe(5144);
    expect(roundHalfUp(-5143.5)).toBe(-5144);
    expect(roundHalfUp(2.4)).toBe(2);
    expect(roundHalfUp(-2.4)).toBe(-2);
  });

  it("laisse un entier inchangé", () => {
    expect(roundHalfUp(100)).toBe(100);
    expect(roundHalfUp(0)).toBe(0);
  });
});
