import { describe, expect, it } from "vitest";
import { canonicalize, computeRowHash } from "./hash";

describe("canonicalize", () => {
  it("trie les clés pour ne jamais dépendre de l'ordre des colonnes", () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }));
  });

  it("produit une chaîne JSON déterministe", () => {
    expect(canonicalize({ phone: "+2250708123456", displayName: "Kouassi" })).toBe(
      '{"displayName":"Kouassi","phone":"+2250708123456"}',
    );
  });
});

describe("computeRowHash", () => {
  it("produit le même hash indépendamment de l'ordre des champs", async () => {
    const hash1 = await computeRowHash({ phone: "+2250708123456", displayName: "Kouassi" });
    const hash2 = await computeRowHash({ displayName: "Kouassi", phone: "+2250708123456" });
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produit un hash différent si une valeur change", async () => {
    const hash1 = await computeRowHash({ phone: "+2250708123456" });
    const hash2 = await computeRowHash({ phone: "+2250505112233" });
    expect(hash1).not.toBe(hash2);
  });
});
