import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword — RG-M01-03 (argon2id)", () => {
  it("hache un mot de passe en argon2id et le vérifie correctement", async () => {
    const hash = await hashPassword("un-mot-de-passe-valide1");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "un-mot-de-passe-valide1")).toBe(true);
  });

  it("rejette un mauvais mot de passe", async () => {
    const hash = await hashPassword("un-mot-de-passe-valide1");
    expect(await verifyPassword(hash, "autre-mot-de-passe")).toBe(false);
  });

  it("produit des hachages différents pour un même mot de passe (sel aléatoire)", async () => {
    const [a, b] = await Promise.all([
      hashPassword("un-mot-de-passe-valide1"),
      hashPassword("un-mot-de-passe-valide1"),
    ]);
    expect(a).not.toBe(b);
  });
});
