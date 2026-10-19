import { describe, expect, it } from "vitest";
import { computeReachability } from "./reachability";

describe("computeReachability", () => {
  it("DO_NOT_REMIND l'emporte sur tout le reste", () => {
    expect(
      computeReachability({
        hasMobilePhone: true,
        hasEmail: true,
        doNotRemind: true,
        optedOutAt: new Date(),
      }),
    ).toBe("DO_NOT_REMIND");
  });

  it("OPTED_OUT si le client a répondu STOP (et n'est pas en doNotRemind)", () => {
    expect(
      computeReachability({
        hasMobilePhone: true,
        hasEmail: false,
        doNotRemind: false,
        optedOutAt: new Date(),
      }),
    ).toBe("OPTED_OUT");
  });

  it("REACHABLE avec un mobile seul", () => {
    expect(
      computeReachability({
        hasMobilePhone: true,
        hasEmail: false,
        doNotRemind: false,
        optedOutAt: null,
      }),
    ).toBe("REACHABLE");
  });

  it("REACHABLE avec un email seul (ex. téléphone fixe uniquement)", () => {
    expect(
      computeReachability({
        hasMobilePhone: false,
        hasEmail: true,
        doNotRemind: false,
        optedOutAt: null,
      }),
    ).toBe("REACHABLE");
  });

  it("UNREACHABLE sans aucun moyen de contact", () => {
    expect(
      computeReachability({
        hasMobilePhone: false,
        hasEmail: false,
        doNotRemind: false,
        optedOutAt: null,
      }),
    ).toBe("UNREACHABLE");
  });
});
