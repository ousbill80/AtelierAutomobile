import { describe, expect, it } from "vitest";
import { FakeFneProvider } from "./fake";
import { samplePayload } from "./fixtures";

describe("FakeFneProvider (simulateur)", () => {
  it("certifie de façon déterministe et idempotente (même clé → même certificat)", async () => {
    const provider = new FakeFneProvider();
    const first = await provider.certify(samplePayload());
    expect(first).toMatchObject({
      fneNumber: "SIM-FAC-2026-000123",
      signedAt: new Date("2026-10-19T10:00:00Z"),
    });
    expect(first.qrCode).toContain("SIM-FAC-2026-000123");
    expect(await provider.certify(samplePayload())).toBe(first);
  });

  it("échoue N fois (transitoire) puis réussit", async () => {
    const provider = new FakeFneProvider({ failTimes: 2 });
    await expect(provider.certify(samplePayload())).rejects.toMatchObject({ kind: "transient" });
    await expect(provider.certify(samplePayload())).rejects.toMatchObject({ kind: "transient" });
    await expect(provider.certify(samplePayload())).resolves.toMatchObject({
      fneNumber: "SIM-FAC-2026-000123",
    });
    expect(provider.calls).toBe(3);
  });

  it("simule un rejet définitif de la DGI", async () => {
    const provider = new FakeFneProvider({ rejectWith: "NCC client invalide" });
    await expect(provider.certify(samplePayload())).rejects.toMatchObject({
      kind: "rejected",
      message: "NCC client invalide",
    });
  });
});
