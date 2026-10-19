import { describe, expect, it } from "vitest";
import { canAddMember, canAddSite, PLAN_LIMITS } from "./plan";

describe("PLAN_LIMITS — RG-M01-13", () => {
  it("expose les limites par défaut STARTER/PRO/NETWORK", () => {
    expect(PLAN_LIMITS.STARTER).toEqual({ maxActiveMembers: 5, maxSites: 1 });
    expect(PLAN_LIMITS.PRO).toEqual({ maxActiveMembers: 15, maxSites: 3 });
    expect(PLAN_LIMITS.NETWORK).toEqual({ maxActiveMembers: null, maxSites: null });
  });
});

describe("canAddSite — RG-M01-13", () => {
  it("refuse un 2e site sur STARTER (limite 1)", () => {
    expect(canAddSite("STARTER", 1)).toBe(false);
  });

  it("autorise un 2e site sur PRO (limite 3)", () => {
    expect(canAddSite("PRO", 1)).toBe(true);
    expect(canAddSite("PRO", 2)).toBe(true);
    expect(canAddSite("PRO", 3)).toBe(false);
  });

  it("autorise toujours sur NETWORK (illimité)", () => {
    expect(canAddSite("NETWORK", 999)).toBe(true);
  });
});

describe("canAddMember — RG-M01-13", () => {
  it("refuse un 6e membre actif sur STARTER (limite 5)", () => {
    expect(canAddMember("STARTER", 5)).toBe(false);
    expect(canAddMember("STARTER", 4)).toBe(true);
  });

  it("refuse un 16e membre actif sur PRO (limite 15)", () => {
    expect(canAddMember("PRO", 15)).toBe(false);
    expect(canAddMember("PRO", 14)).toBe(true);
  });

  it("autorise toujours sur NETWORK (illimité)", () => {
    expect(canAddMember("NETWORK", 10000)).toBe(true);
  });
});
