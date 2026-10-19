import { describe, expect, it } from "vitest";
import {
  assertModuleAllowed,
  canSwitchOperatingMode,
  isModuleVisible,
  MODULE_KEYS,
  REMINDERS_ONLY_VISIBLE_MODULES,
} from "./operating-mode";

describe("isModuleVisible — RG-M15-23", () => {
  it("en FULL, tous les modules sont visibles", () => {
    for (const moduleKey of MODULE_KEYS) {
      expect(isModuleVisible("FULL", moduleKey)).toBe(true);
    }
  });

  it("en REMINDERS_ONLY, seuls les modules de la liste US-M15-10 sont visibles", () => {
    expect([...REMINDERS_ONLY_VISIBLE_MODULES].sort()).toEqual(
      [
        "dashboard",
        "reminders",
        "receivables",
        "customers",
        "vehicles",
        "deadlines",
        "messages",
        "import",
        "settings",
      ].sort(),
    );
  });

  it.each([
    "repair_orders",
    "quotes",
    "workshop",
    "stock",
    "purchasing",
    "cash",
    "invoicing",
  ] as const)("en REMINDERS_ONLY, %s est masqué", (moduleKey) => {
    expect(isModuleVisible("REMINDERS_ONLY", moduleKey)).toBe(false);
  });
});

describe("assertModuleAllowed — RG-M15-23", () => {
  it("ne lève pas pour un module autorisé", () => {
    expect(() => assertModuleAllowed("REMINDERS_ONLY", "reminders")).not.toThrow();
    expect(() => assertModuleAllowed("FULL", "stock")).not.toThrow();
  });

  it("lève une DomainError explicite pour un module masqué", () => {
    expect(() => assertModuleAllowed("REMINDERS_ONLY", "stock")).toThrow(/gestion complète/);
  });
});

describe("canSwitchOperatingMode — RG-M15-23", () => {
  it("permet toujours le passage en REMINDERS_ONLY", () => {
    expect(
      canSwitchOperatingMode({ from: "FULL", to: "REMINDERS_ONLY", hasActiveDataSource: true }),
    ).toEqual({ allowed: true });
    expect(
      canSwitchOperatingMode({ from: "FULL", to: "REMINDERS_ONLY", hasActiveDataSource: false }),
    ).toEqual({ allowed: true });
  });

  it("permet le passage direct en FULL si aucune source de synchro n'est active", () => {
    expect(
      canSwitchOperatingMode({
        from: "REMINDERS_ONLY",
        to: "FULL",
        hasActiveDataSource: false,
      }),
    ).toEqual({ allowed: true });
  });

  it("refuse le passage direct en FULL si une source de synchro est active (renvoie vers M13)", () => {
    const result = canSwitchOperatingMode({
      from: "REMINDERS_ONLY",
      to: "FULL",
      hasActiveDataSource: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/assistant de migration/);
  });

  it("ne change rien (no-op autorisé) quand from === to", () => {
    expect(canSwitchOperatingMode({ from: "FULL", to: "FULL", hasActiveDataSource: true })).toEqual(
      { allowed: true },
    );
  });
});
