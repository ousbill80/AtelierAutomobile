import { describe, expect, it, vi } from "vitest";
import { checkWorkerHealth } from "./health";

vi.mock("@atelieros/db", () => ({
  pingDatabases: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./redis", () => ({
  createRedisConnection: vi.fn().mockReturnValue({
    ping: vi.fn().mockResolvedValue("PONG"),
    disconnect: vi.fn(),
  }),
}));

describe("worker healthcheck", () => {
  it("retourne un rapport avec état ok", async () => {
    const report = await checkWorkerHealth();
    expect(report.status).toBe("ok");
    expect(report.checks.database?.ok).toBe(true);
    expect(report.checks.redis?.ok).toBe(true);
  });
});
