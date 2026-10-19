import { describe, expect, it } from "vitest";
import { approvalExpiry } from "./approvalExpiry";

const VT_STEPS = [
  { key: "J-30", offsetDays: -30 },
  { key: "J-7", offsetDays: -7 },
  { key: "J0", offsetDays: 0 },
  { key: "J+7", offsetDays: 7 },
];

describe("approvalExpiry — RG-M10-19", () => {
  it("min(t(palier suivant) − 1 j, t(palier) + 7 j) : le palier suivant gagne s'il est plus proche", () => {
    // t(J-7) = anchor-7 ; t(J0) = anchor ; t(J-7)+7 = anchor ; t(J0)-1 = anchor-1 → le palier suivant gagne.
    const expiry = approvalExpiry(VT_STEPS, new Date("2026-11-02"), VT_STEPS[1]!);
    expect(expiry.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("sans palier suivant : t(palier) + 7 j", () => {
    const expiry = approvalExpiry(VT_STEPS, new Date("2026-10-12"), VT_STEPS[3]!);
    expect(expiry.toISOString().slice(0, 10)).toBe("2026-10-26");
  });
});
