import { describe, expect, it } from "vitest";
import {
  defaultFieldChoice,
  mergeConsent,
  mergeTags,
  resolveDedupeKeyCollisions,
  resolveField,
} from "./merge";

describe("mergeConsent — RG-M02-08 consentement le plus restrictif", () => {
  const permissive = {
    remindersConsent: true,
    marketingConsent: true,
    doNotRemind: false,
    optedOutAt: null,
  };

  it("si l'un est désinscrit (STOP), le résultat l'est", () => {
    const optedOut = { ...permissive, optedOutAt: new Date("2026-10-12") };
    const result = mergeConsent(permissive, optedOut);
    expect(result.optedOutAt).toEqual(new Date("2026-10-12"));
  });

  it("si l'un refuse les relances ou le marketing, le résultat refuse", () => {
    const refusesReminders = { ...permissive, remindersConsent: false };
    expect(mergeConsent(permissive, refusesReminders).remindersConsent).toBe(false);
  });

  it("doNotRemind : vrai si l'un des deux l'a activé", () => {
    const blocked = { ...permissive, doNotRemind: true };
    expect(mergeConsent(permissive, blocked).doNotRemind).toBe(true);
  });
});

describe("mergeTags — union", () => {
  it("fusionne sans doublon", () => {
    expect(mergeTags(["VIP", "Taxi"], ["Taxi", "Flotte"])).toEqual(["VIP", "Taxi", "Flotte"]);
  });
});

describe("defaultFieldChoice / resolveField", () => {
  it("choisit la source si la cible est vide et la source renseignée", () => {
    expect(defaultFieldChoice(null, "")).toBe("target");
    expect(defaultFieldChoice("07 00 00 00 00", "")).toBe("source");
    expect(defaultFieldChoice("07 00 00 00 00", "07 11 11 11 11")).toBe("target");
  });

  it("resolveField applique le choix explicite, sinon le défaut", () => {
    expect(resolveField("source", "A", "B")).toBe("A");
    expect(resolveField("target", "A", "B")).toBe("B");
    expect(resolveField(undefined, "A", "")).toBe("A");
  });
});

describe("resolveDedupeKeyCollisions — RG-M02-08", () => {
  it("annule la relance source en cas de collision avec la cible", () => {
    const sourceReminders = [
      { id: "s1", dedupeKey: "VT:veh1" },
      { id: "s2", dedupeKey: "VT:veh2" },
    ];
    const targetReminders = [{ id: "t1", dedupeKey: "VT:veh1" }];

    const { keep, cancel } = resolveDedupeKeyCollisions(sourceReminders, targetReminders);
    expect(cancel.map((r) => r.id)).toEqual(["s1"]);
    expect(keep.map((r) => r.id)).toEqual(["s2"]);
  });
});
