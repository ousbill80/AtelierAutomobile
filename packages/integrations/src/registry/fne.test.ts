import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "../encryption";
import { DgiApiFneProvider } from "../fne/dgi-api";
import { FakeFneProvider } from "../fne/fake";
import { samplePayload } from "../fne/fixtures";
import { ManualFneProvider } from "../fne/manual";
import type { FneConfigRecord, FneConfigStore } from "./types";
import { resolveFneProvider } from "./fne";

const key = randomBytes(32);

function storeWith(record: FneConfigRecord | undefined): FneConfigStore {
  return {
    async get() {
      return record;
    },
  };
}

describe("resolveFneProvider", () => {
  it("renvoie le fournisseur manuel sans configuration, en mode 'manual' ou 'disabled'", async () => {
    const none = await resolveFneProvider("org_1", { store: storeWith(undefined) });
    await expect(none.certify(samplePayload())).rejects.toThrow(/manuel/);
    for (const mode of ["manual", "disabled"] as const) {
      await expect(
        resolveFneProvider("org_1", {
          store: storeWith({ mode, isActive: true, credentials: null }),
        }),
      ).resolves.toBeInstanceOf(ManualFneProvider);
    }
  });

  it("mode 'api' + simulateur : autorisé hors production, refusé en production", async () => {
    const store = storeWith({ mode: "api", provider: "fake", isActive: true, credentials: null });
    await expect(resolveFneProvider("org_1", { store })).resolves.toBeInstanceOf(FakeFneProvider);
    await expect(resolveFneProvider("org_1", { store, allowSimulator: false })).rejects.toThrow(
      /production/,
    );
  });

  it("mode 'api' + dgi_api : déchiffre les identifiants ; absents → erreur explicite", async () => {
    const credentials = encryptSecret(
      JSON.stringify({ baseUrl: "https://fne.example.test", apiKey: "k" }),
      key,
    );
    await expect(
      resolveFneProvider("org_1", {
        store: storeWith({ mode: "api", provider: "dgi_api", isActive: true, credentials }),
        encryptionKey: key,
      }),
    ).resolves.toBeInstanceOf(DgiApiFneProvider);
    await expect(
      resolveFneProvider("org_1", {
        store: storeWith({ mode: "api", provider: "dgi_api", isActive: true, credentials: null }),
        encryptionKey: key,
      }),
    ).rejects.toThrow(/Identifiants DGI/);
    await expect(
      resolveFneProvider("org_1", {
        store: storeWith({ mode: "api", provider: "autre", isActive: true, credentials: null }),
      }),
    ).rejects.toThrow(/inconnu/);
  });
});
