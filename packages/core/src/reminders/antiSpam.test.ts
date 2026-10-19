import { describe, expect, it } from "vitest";
import { antiSpamAllows, deferOutcome } from "./antiSpam";

describe("antiSpamAllows — RG-M10-16", () => {
  it("autorise sous les deux plafonds", () => {
    expect(
      antiSpamAllows({
        sentOrQueuedToday: 0,
        sentOrQueuedLast7Days: 1,
        maxPerDay: 1,
        maxPerWeek: 3,
      }),
    ).toBe(true);
  });

  it("refuse au plafond quotidien", () => {
    expect(
      antiSpamAllows({
        sentOrQueuedToday: 1,
        sentOrQueuedLast7Days: 1,
        maxPerDay: 1,
        maxPerWeek: 3,
      }),
    ).toBe(false);
  });

  it("refuse au plafond hebdomadaire même si le quotidien est respecté", () => {
    expect(
      antiSpamAllows({
        sentOrQueuedToday: 0,
        sentOrQueuedLast7Days: 3,
        maxPerDay: 1,
        maxPerWeek: 3,
      }),
    ).toBe(false);
  });
});

describe("deferOutcome — RG-M10-16", () => {
  it("report tant que le compteur est sous 3", () => {
    expect(deferOutcome(1)).toBe("SNOOZED");
    expect(deferOutcome(2)).toBe("SNOOZED");
  });

  it("abandon (SKIPPED) après 3 reports", () => {
    expect(deferOutcome(3)).toBe("SKIPPED");
    expect(deferOutcome(4)).toBe("SKIPPED");
  });
});
