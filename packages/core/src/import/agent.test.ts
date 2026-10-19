import { describe, expect, it } from "vitest";
import {
  batchIdempotencyKey,
  chunkRows,
  effectiveAgentStatus,
  generateAgentToken,
  generatePairingCode,
  hashAgentToken,
  hashSourceRow,
  isClockSkewed,
  normalizePairingCode,
  pairingExpiresAt,
} from "./agent";

const now = new Date("2026-10-19T10:00:00Z");

describe("appairage (RG-M13-28)", () => {
  it("code de 8 caractères sans caractères ambigus, valable 15 min", () => {
    const codes = Array.from({ length: 200 }, generatePairingCode);
    expect(codes.every((c) => /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(195);
    expect(pairingExpiresAt(now).toISOString()).toBe("2026-10-19T10:15:00.000Z");
    expect(normalizePairingCode(" abcd-2345 ")).toBe("ABCD2345");
  });

  it("jeton sa_live_ de 32 caractères, stocké en sha256", async () => {
    const token = generateAgentToken();
    expect(token).toMatch(/^sa_live_[A-Za-z0-9]{32}$/);
    expect(await hashAgentToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashAgentToken(token)).toBe(await hashAgentToken(token));
  });
});

describe("statut de l'agent (§5)", () => {
  it("hors ligne sans battement depuis 15 min ; révoqué et appairage inchangés", () => {
    const at = (min: number) => new Date(now.getTime() - min * 60_000);
    expect(effectiveAgentStatus({ status: "ONLINE", lastSeenAt: at(14) }, now)).toBe("ONLINE");
    expect(effectiveAgentStatus({ status: "ONLINE", lastSeenAt: at(16) }, now)).toBe("OFFLINE");
    expect(effectiveAgentStatus({ status: "OFFLINE", lastSeenAt: at(1) }, now)).toBe("ONLINE");
    expect(effectiveAgentStatus({ status: "REVOKED", lastSeenAt: at(1) }, now)).toBe("REVOKED");
    expect(effectiveAgentStatus({ status: "PAIRING", lastSeenAt: null }, now)).toBe("PAIRING");
  });

  it("décalage d'horloge > 5 min (M13 §11)", () => {
    expect(isClockSkewed(new Date(now.getTime() + 5 * 60_000), now)).toBe(false);
    expect(isClockSkewed(new Date(now.getTime() - 6 * 60_000), now)).toBe(true);
  });
});

describe("lots et empreintes", () => {
  it("découpe par 500 lignes", () => {
    const chunks = chunkRows(Array.from({ length: 1201 }, (_, i) => i));
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 201]);
    expect(chunkRows([])).toEqual([]);
  });

  it("empreinte de ligne stable et sensible au contenu ; clé d'idempotence du lot", async () => {
    const a = await hashSourceRow(["phone", "name"], ["0747218890", "SOTRA"]);
    expect(await hashSourceRow(["phone", "name"], ["0747218890", "SOTRA"])).toBe(a);
    expect(await hashSourceRow(["phone", "name"], ["0747218890", "SOTRA SA"])).not.toBe(a);
    const batch = { entity: "customers", columns: ["phone"], rows: [["0747218890"]] };
    expect(await batchIdempotencyKey(batch)).toBe(await batchIdempotencyKey({ ...batch }));
    expect(await batchIdempotencyKey({ ...batch, entity: "vehicles" })).not.toBe(
      await batchIdempotencyKey(batch),
    );
  });
});
