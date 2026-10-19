import { describe, expect, it } from "vitest";
import { computeDisplayName, titleCaseName } from "./display-name";

describe("computeDisplayName — RG-M02-01", () => {
  it("particulier : nom puis prénom, majuscule initiale", () => {
    expect(
      computeDisplayName({ type: "INDIVIDUAL", lastName: "kouassi", firstName: "jean-marc" }),
    ).toBe("Kouassi Jean-Marc");
  });

  it("conserve les particules (apostrophe, tiret)", () => {
    expect(
      computeDisplayName({ type: "INDIVIDUAL", lastName: "n'guessan", firstName: "aya" }),
    ).toBe("N'Guessan Aya");
    expect(titleCaseName("kouadio-konan")).toBe("Kouadio-Konan");
  });

  it("particulier sans prénom", () => {
    expect(computeDisplayName({ type: "INDIVIDUAL", lastName: "koné" })).toBe("Koné");
  });

  it("entreprise : displayName = companyName tel quel (hors espaces)", () => {
    expect(computeDisplayName({ type: "COMPANY", companyName: " SOTRA Logistique SARL " })).toBe(
      "SOTRA Logistique SARL",
    );
  });
});
