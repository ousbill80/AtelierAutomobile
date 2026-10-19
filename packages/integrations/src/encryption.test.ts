import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, loadEncryptionKey } from "./encryption";

describe("loadEncryptionKey", () => {
  it("décode une clé base64 de 32 octets", () => {
    const base64Key = randomBytes(32).toString("base64");
    expect(loadEncryptionKey(base64Key)).toHaveLength(32);
  });

  it("refuse une clé absente", () => {
    expect(() => loadEncryptionKey(undefined)).toThrow(/requis/);
  });

  it("refuse une clé d'une longueur incorrecte", () => {
    expect(() => loadEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32 octets/);
  });
});

describe("encryptSecret / decryptSecret", () => {
  const key = randomBytes(32);

  it("chiffre puis déchiffre un secret fournisseur", () => {
    const plaintext = JSON.stringify({ apiKey: "wave_live_xxx", apiSecret: "yyy" });
    const encrypted = encryptSecret(plaintext, key);

    expect(encrypted).not.toContain("wave_live_xxx");
    expect(decryptSecret(encrypted, key)).toBe(plaintext);
  });

  it("produit un chiffré différent à chaque appel (IV aléatoire)", () => {
    const plaintext = "secret";
    expect(encryptSecret(plaintext, key)).not.toBe(encryptSecret(plaintext, key));
  });

  it("refuse de déchiffrer avec la mauvaise clé", () => {
    const encrypted = encryptSecret("secret", key);
    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow(/déchiffrer/);
  });

  it("refuse un secret chiffré altéré", () => {
    const encrypted = encryptSecret("secret", key);
    const tampered = encrypted.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered, key)).toThrow(/déchiffrer/);
  });

  it("refuse une enveloppe mal formée", () => {
    expect(() => decryptSecret("pas-une-enveloppe-valide", key)).toThrow(/mal formé/);
  });
});
