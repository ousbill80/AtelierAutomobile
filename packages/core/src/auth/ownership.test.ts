import { describe, expect, it } from "vitest";
import { wouldRemoveLastOwner } from "./ownership";

describe("wouldRemoveLastOwner — RG-M01-11", () => {
  it("refuse de retirer le seul OWNER actif", () => {
    const memberships = [{ id: "m1", role: "OWNER" as const, isActive: true }];
    expect(wouldRemoveLastOwner(memberships, "m1")).toBe(true);
  });

  it("autorise de retirer un OWNER s'il reste un autre OWNER actif", () => {
    const memberships = [
      { id: "m1", role: "OWNER" as const, isActive: true },
      { id: "m2", role: "OWNER" as const, isActive: true },
    ];
    expect(wouldRemoveLastOwner(memberships, "m1")).toBe(false);
  });

  it("ignore un OWNER déjà inactif (ne compte pas comme restant)", () => {
    const memberships = [
      { id: "m1", role: "OWNER" as const, isActive: true },
      { id: "m2", role: "OWNER" as const, isActive: false },
    ];
    expect(wouldRemoveLastOwner(memberships, "m1")).toBe(true);
  });

  it("autorise de retirer un membre qui n'est pas OWNER", () => {
    const memberships = [
      { id: "m1", role: "OWNER" as const, isActive: true },
      { id: "m2", role: "MANAGER" as const, isActive: true },
    ];
    expect(wouldRemoveLastOwner(memberships, "m2")).toBe(false);
  });

  it("autorise de retirer un OWNER déjà inactif (aucun changement)", () => {
    const memberships = [
      { id: "m1", role: "OWNER" as const, isActive: false },
      { id: "m2", role: "MANAGER" as const, isActive: true },
    ];
    expect(wouldRemoveLastOwner(memberships, "m1")).toBe(false);
  });
});
