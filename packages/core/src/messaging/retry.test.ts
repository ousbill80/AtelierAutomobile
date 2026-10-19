import { describe, expect, it } from "vitest";
import { applyJitter, MAX_RETRY_ATTEMPTS, retryBackoffMs } from "./retry";

describe("retryBackoffMs", () => {
  it("suit l'échéancier 30s, 2min, 8min, 30min, 2h", () => {
    expect(retryBackoffMs(1)).toBe(30_000);
    expect(retryBackoffMs(2)).toBe(120_000);
    expect(retryBackoffMs(3)).toBe(480_000);
    expect(retryBackoffMs(4)).toBe(1_800_000);
    expect(retryBackoffMs(5)).toBe(7_200_000);
  });

  it("plafonne au dernier délai au-delà de 5 tentatives", () => {
    expect(retryBackoffMs(6)).toBe(7_200_000);
    expect(retryBackoffMs(99)).toBe(7_200_000);
  });

  it("5 tentatives maximum", () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(5);
  });
});

describe("applyJitter", () => {
  it("applique ± 20 % autour du délai de base", () => {
    expect(applyJitter(1000, 1)).toBe(1200);
    expect(applyJitter(1000, -1)).toBe(800);
    expect(applyJitter(1000, 0)).toBe(1000);
  });

  it("ne descend jamais sous zéro", () => {
    expect(applyJitter(0, -1)).toBe(0);
  });
});
