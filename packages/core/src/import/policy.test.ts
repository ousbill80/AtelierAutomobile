import { describe, expect, it } from "vitest";
import { computeBalanceChange, mergeFields, outcomeForHash } from "./policy";

describe("mergeFields", () => {
  it("renvoie 'create' sans enregistrement existant", () => {
    const result = mergeFields(null, { displayName: "Kouassi" }, "UPSERT");
    expect(result).toEqual({ outcome: "create", patch: { displayName: "Kouassi" } });
  });

  it("CREATE_ONLY ne met jamais à jour un enregistrement existant", () => {
    const result = mergeFields(
      { displayName: "Ancien" },
      { displayName: "Nouveau" },
      "CREATE_ONLY",
    );
    expect(result).toEqual({ outcome: "skip", patch: {} });
  });

  it("UPSERT n'écrase pas une valeur existante avec un champ vide du fichier", () => {
    const result = mergeFields(
      { displayName: "Kouassi", email: "a@b.com" },
      { displayName: "Kouassi", email: "" },
      "UPSERT",
    );
    expect(result).toEqual({ outcome: "unchanged", patch: {} });
  });

  it("UPSERT met à jour les champs non vides qui ont changé", () => {
    const result = mergeFields(
      { displayName: "Kouassi" },
      { displayName: "Kouassi Jean-Marc" },
      "UPSERT",
    );
    expect(result).toEqual({ outcome: "update", patch: { displayName: "Kouassi Jean-Marc" } });
  });

  it("UPSERT_OVERWRITE écrase même avec un champ vide du fichier", () => {
    const result = mergeFields({ email: "a@b.com" }, { email: "" }, "UPSERT_OVERWRITE");
    expect(result).toEqual({ outcome: "update", patch: { email: "" } });
  });

  it("ne modifie jamais les champs protégés (consentement relances)", () => {
    const result = mergeFields(
      { remindersConsent: true, displayName: "Kouassi" },
      { remindersConsent: false, displayName: "Kouassi Jean-Marc" },
      "UPSERT_OVERWRITE",
    );
    expect(result.patch).toEqual({ displayName: "Kouassi Jean-Marc" });
    expect(result.patch).not.toHaveProperty("remindersConsent");
  });

  it("renvoie 'unchanged' si rien à écrire après filtrage", () => {
    const result = mergeFields({ displayName: "Kouassi" }, { displayName: "Kouassi" }, "UPSERT");
    expect(result.outcome).toBe("unchanged");
  });
});

describe("outcomeForHash", () => {
  it("renvoie 'unchanged' pour un hash identique", () => {
    expect(outcomeForHash("abc", "abc")).toBe("unchanged");
  });

  it("renvoie 'changed' pour un hash différent", () => {
    expect(outcomeForHash("abc", "def")).toBe("changed");
  });

  it("renvoie 'changed' si aucun hash existant", () => {
    expect(outcomeForHash(null, "def")).toBe("changed");
  });
});

describe("computeBalanceChange", () => {
  it("détecte une baisse de solde", () => {
    const result = computeBalanceChange(185000, 0, "UPSERT", "FAC-2026-0412");
    expect(result).toEqual({ kind: "decrease", delta: 185000 });
  });

  it("détecte une absence de changement", () => {
    const result = computeBalanceChange(185000, 185000, "UPSERT", "FAC-2026-0412");
    expect(result).toEqual({ kind: "unchanged", delta: 0 });
  });

  it("signale une erreur pour une hausse de solde en UPSERT", () => {
    const result = computeBalanceChange(0, 50000, "UPSERT", "FAC-2026-0412");
    expect(result.kind).toBe("increase");
    expect(result.error).toMatch(/augmenté/);
  });

  it("accepte une hausse de solde en UPSERT_OVERWRITE sans erreur", () => {
    const result = computeBalanceChange(0, 50000, "UPSERT_OVERWRITE", "FAC-2026-0412");
    expect(result.kind).toBe("increase");
    expect(result.error).toBeUndefined();
  });
});
