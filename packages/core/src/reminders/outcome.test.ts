import { describe, expect, it } from "vitest";
import { strongerOutcome, type ReminderOutcomeLike } from "./outcome";

describe("strongerOutcome — RG-M10-27", () => {
  it("un résultat plus fort remplace un plus faible", () => {
    expect(strongerOutcome("REPLIED", "PAID")).toBe("PAID");
    expect(strongerOutcome("NO_RESPONSE", "APPOINTMENT_BOOKED")).toBe("APPOINTMENT_BOOKED");
  });

  it("un résultat plus faible ne remplace jamais un plus fort", () => {
    expect(strongerOutcome("PAID", "REPLIED")).toBe("PAID");
    expect(strongerOutcome("APPOINTMENT_BOOKED", "NO_RESPONSE")).toBe("APPOINTMENT_BOOKED");
  });

  it("respecte l'ordre explicite du PRD PAID > PARTIALLY_PAID > PROMISED > APPOINTMENT_BOOKED > VISITED > REPLIED > NO_RESPONSE", () => {
    const order = [
      "NO_RESPONSE",
      "REPLIED",
      "VISITED",
      "APPOINTMENT_BOOKED",
      "PROMISED",
      "PARTIALLY_PAID",
      "PAID",
    ] as const;
    let current: ReminderOutcomeLike | null = null;
    for (const outcome of order) {
      current = strongerOutcome(current, outcome);
      expect(current).toBe(outcome);
    }
  });

  it("sans résultat courant, le nouveau résultat est toujours retenu", () => {
    expect(strongerOutcome(null, "NO_RESPONSE")).toBe("NO_RESPONSE");
  });
});
