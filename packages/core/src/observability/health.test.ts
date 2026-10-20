import { describe, expect, it } from "vitest";
import { buildHealthReport, runHealthCheck } from "./health";

describe("runHealthCheck", () => {
  it("réussit et mesure la latence avec l'horloge fournie", async () => {
    let t = 100;
    const result = await runHealthCheck(
      async () => {
        t += 12;
      },
      1000,
      () => t,
    );
    expect(result).toEqual({ ok: true, latencyMs: 12 });
  });

  it("signale une indisponibilité sans exposer le message d'erreur", async () => {
    const result = await runHealthCheck(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.3:5432 user=atelieros");
    }, 1000);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("atelieros");
  });

  it("abandonne une sonde trop lente", async () => {
    const result = await runHealthCheck(() => new Promise(() => {}), 20);
    expect(result).toMatchObject({ ok: false, error: "timeout" });
  });
});

describe("buildHealthReport", () => {
  it("est « ok » quand toutes les sondes répondent", async () => {
    const report = await buildHealthReport({
      database: async () => {},
      redis: async () => "PONG",
      storage: async () => {},
    });
    expect(report.status).toBe("ok");
    expect(Object.keys(report.checks).sort()).toEqual(["database", "redis", "storage"]);
  });

  it("est « degraded » dès qu'une sonde échoue", async () => {
    const report = await buildHealthReport({
      database: async () => {},
      redis: async () => {
        throw new Error("down");
      },
    });
    expect(report.status).toBe("degraded");
    expect(report.checks.redis?.ok).toBe(false);
    expect(report.checks.database?.ok).toBe(true);
  });
});
