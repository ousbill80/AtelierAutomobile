import { describe, expect, it } from "vitest";
import { computeDisplayName } from "./display-name";

describe("computeDisplayName — RG-M02-01", () => {
  it("particulier : nom puis prénom, majuscule initiale à chaque mot", () => {
    expect(
      computeDisplayName({ type: "INDIVIDUAL", lastName: "KOUASSI", firstName: "jean-marc" }),
    ).toBe("Kouassi Jean-Marc");
  });

  it("conserve les particules composées (apostrophe, tiret)", () => {
    expect(
      computeDisplayName({ type: "INDIVIDUAL", lastName: "n'guessan", firstName: "kouadio-konan" }),
    ).toBe("N'Guessan Kouadio-Konan");
  });

  it("particulier sans prénom", () => {
    expect(computeDisplayName({ type: "INDIVIDUAL", lastName: "bamba", firstName: null })).toBe(
      "Bamba",
    );
  });

  it("entreprise : companyName tel quel, sans recasse", () => {
    expect(computeDisplayName({ type: "COMPANY", companyName: "SOTRA Logistique SARL" })).toBe(
      "SOTRA Logistique SARL",
    );
  });

  it("particulier sans nom de famille → erreur", () => {
    expect(() => computeDisplayName({ type: "INDIVIDUAL", lastName: "  " })).toThrow(
      /Le nom de famille est obligatoire/,
    );
  });

  it("entreprise sans raison sociale → erreur", () => {
    expect(() => computeDisplayName({ type: "COMPANY", companyName: "" })).toThrow(
      /Le nom de l'entreprise est obligatoire/,
    );
  });
});
