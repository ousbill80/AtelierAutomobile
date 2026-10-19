import { describe, expect, it } from "vitest";
import { canTransition, isTerminalStatus, nextStatus } from "./state-machine";

describe("machine à états (M03 §5)", () => {
  it("suit les transitions autorisées", () => {
    expect(nextStatus("BOOKED", "confirm")).toBe("CONFIRMED");
    expect(nextStatus("CONFIRMED", "arrive")).toBe("ARRIVED");
    expect(nextStatus("BOOKED", "arrive")).toBe("ARRIVED");
    expect(nextStatus("ARRIVED", "complete")).toBe("COMPLETED");
    expect(nextStatus("CONFIRMED", "cancel")).toBe("CANCELLED");
    expect(nextStatus("BOOKED", "no_show")).toBe("NO_SHOW");
    expect(nextStatus("NO_SHOW", "revert_no_show")).toBe("ARRIVED");
    expect(nextStatus("CONFIRMED", "reschedule")).toBe("CONFIRMED");
  });

  it("refuse les transitions interdites avec une DomainError", () => {
    expect(() => nextStatus("ARRIVED", "cancel")).toThrow("Impossible d'annuler");
    expect(() => nextStatus("COMPLETED", "reschedule")).toThrow();
    expect(() => nextStatus("CONFIRMED", "confirm")).toThrow();
    expect(canTransition("CANCELLED", "arrive")).toBe(false);
  });

  it("identifie les statuts terminaux", () => {
    expect(isTerminalStatus("COMPLETED")).toBe(true);
    expect(isTerminalStatus("CANCELLED")).toBe(true);
    expect(isTerminalStatus("NO_SHOW")).toBe(false);
  });
});
