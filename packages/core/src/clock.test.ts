import { describe, expect, it } from "vitest";
import { fixedClock, systemClock } from "./clock";

describe("clock", () => {
  it("systemClock.now() renvoie une Date proche de l'instant présent", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it("fixedClock renvoie toujours la même date injectée", () => {
    const fixed = new Date("2026-10-18T09:00:00.000Z");
    const clock = fixedClock(fixed);
    expect(clock.now()).toBe(fixed);
    expect(clock.now()).toStrictEqual(fixed);
  });
});
