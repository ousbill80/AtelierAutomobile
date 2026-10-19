import { describe, expect, it } from "vitest";
import { mergePlan, type MergePlanInput } from "./merge";

const baseConsent = {
  remindersConsent: true,
  marketingConsent: true,
  doNotRemind: false,
  optedOutAt: null,
};

function baseInput(overrides: Partial<MergePlanInput> = {}): MergePlanInput {
  return {
    fields: {},
    sourceUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    targetUpdatedAt: new Date("2026-06-01T00:00:00.000Z"),
    sourceTags: [],
    targetTags: [],
    sourceConsent: baseConsent,
    targetConsent: baseConsent,
    sourceReminderDedupeKeys: [],
    targetReminderDedupeKeys: [],
    ...overrides,
  };
}

describe("mergePlan — RG-M02-08", () => {
  it("choix de champ explicite prime sur la règle par défaut", () => {
    const result = mergePlan(
      baseInput({
        fields: { email: { sourceValue: "a@old.ci", targetValue: "b@new.ci" } },
        choices: { email: "source" },
      }),
    );
    expect(result.fields.email).toBe("a@old.ci");
  });

  it("par défaut, la valeur non vide la plus récente l'emporte", () => {
    const result = mergePlan(
      baseInput({
        fields: { commune: { sourceValue: "Yopougon", targetValue: "Cocody" } },
        targetUpdatedAt: new Date("2026-12-01T00:00:00.000Z"), // cible plus récente
      }),
    );
    expect(result.fields.commune).toBe("Cocody");
  });

  it("si la valeur la plus récente est vide, on retient l'autre", () => {
    const result = mergePlan(
      baseInput({
        fields: { email: { sourceValue: "a@old.ci", targetValue: "" } },
        targetUpdatedAt: new Date("2026-12-01T00:00:00.000Z"), // cible plus récente mais vide
      }),
    );
    expect(result.fields.email).toBe("a@old.ci");
  });

  it("tags : union sans doublon", () => {
    const result = mergePlan(
      baseInput({ sourceTags: ["VIP", "Flotte"], targetTags: ["Flotte", "Impayé"] }),
    );
    expect(result.tags.sort()).toEqual(["Flotte", "Impayé", "VIP"].sort());
  });

  it("consentement : le plus restrictif l'emporte (désinscrit si l'un l'est)", () => {
    const result = mergePlan(
      baseInput({
        sourceConsent: { ...baseConsent, remindersConsent: false },
        targetConsent: baseConsent,
      }),
    );
    expect(result.consent.remindersConsent).toBe(false);
  });

  it("consentement : doNotRemind vrai si l'un des deux l'a", () => {
    const result = mergePlan(
      baseInput({
        sourceConsent: baseConsent,
        targetConsent: { ...baseConsent, doNotRemind: true },
      }),
    );
    expect(result.consent.doNotRemind).toBe(true);
  });

  it("consentement : conserve la date de désinscription la plus ancienne", () => {
    const result = mergePlan(
      baseInput({
        sourceConsent: { ...baseConsent, optedOutAt: new Date("2026-02-01T00:00:00.000Z") },
        targetConsent: { ...baseConsent, optedOutAt: new Date("2026-05-01T00:00:00.000Z") },
      }),
    );
    expect(result.consent.optedOutAt).toEqual(new Date("2026-02-01T00:00:00.000Z"));
  });

  it("collision de dedupeKey : la relance de la source correspondante est annulée", () => {
    const result = mergePlan(
      baseInput({
        sourceReminderDedupeKeys: ["INSPECTION:veh1:2026-11", "SERVICE:veh1:2026-12"],
        targetReminderDedupeKeys: ["INSPECTION:veh1:2026-11"],
      }),
    );
    expect(result.cancelledSourceReminderDedupeKeys).toEqual(["INSPECTION:veh1:2026-11"]);
  });

  it("pas de collision → aucune relance source annulée", () => {
    const result = mergePlan(
      baseInput({
        sourceReminderDedupeKeys: ["INSPECTION:veh1:2026-11"],
        targetReminderDedupeKeys: ["SERVICE:veh2:2026-12"],
      }),
    );
    expect(result.cancelledSourceReminderDedupeKeys).toEqual([]);
  });
});
