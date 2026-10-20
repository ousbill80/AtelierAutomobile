import { describe, expect, it } from "vitest";
import { samplePayload } from "./fixtures";
import { ManualFneProvider } from "./manual";

describe("ManualFneProvider", () => {
  it("refuse toute certification programmatique plutôt que de fabriquer un faux numéro FNE", async () => {
    const provider = new ManualFneProvider();
    await expect(provider.certify(samplePayload())).rejects.toThrow(/manuel/);
    await expect(provider.healthCheck()).resolves.toMatchObject({ ok: true });
  });
});
