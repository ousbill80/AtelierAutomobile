import { describe, expect, it } from "vitest";
import { checkPasswordPolicy, isPasswordPolicyCompliant } from "./password-policy";

describe("checkPasswordPolicy (RG-M01-03)", () => {
  it("rejette un mot de passe trop court", () => {
    expect(checkPasswordPolicy("Abc123")).toBe("TOO_SHORT");
  });

  it("rejette un mot de passe sans chiffre", () => {
    expect(checkPasswordPolicy("Abcdefgh")).toBe("MISSING_LETTER_OR_DIGIT");
  });

  it("rejette un mot de passe sans lettre", () => {
    expect(checkPasswordPolicy("12345678")).toBe("MISSING_LETTER_OR_DIGIT");
  });

  it("rejette un mot de passe de la liste des 10 000 plus courants", () => {
    expect(checkPasswordPolicy("password1")).toBe("COMMON_PASSWORD");
    expect(checkPasswordPolicy("PASSWORD1")).toBe("COMMON_PASSWORD");
  });

  it("rejette un mot de passe contenant « garage »", () => {
    expect(checkPasswordPolicy("MonGarage2026")).toBe("CONTEXTUAL_MATCH");
  });

  it("rejette un mot de passe contenant le nom du garage", () => {
    expect(checkPasswordPolicy("AutoPlus2026", { garageName: "Auto Plus CI" })).toBe(
      "CONTEXTUAL_MATCH",
    );
  });

  it("rejette un mot de passe contenant le numéro de téléphone du compte", () => {
    expect(checkPasswordPolicy("Secret12345678", { phone: "+2250712345678" })).toBe(
      "CONTEXTUAL_MATCH",
    );
  });

  it("accepte un mot de passe conforme et sans lien contextuel", () => {
    expect(checkPasswordPolicy("CorrectHorse123", { garageName: "Garage Abobo" })).toBeNull();
    expect(isPasswordPolicyCompliant("CorrectHorse123")).toBe(true);
  });
});
