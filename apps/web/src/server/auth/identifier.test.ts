import { describe, expect, it } from "vitest";
import { resolveIdentifier } from "./identifier";

describe("resolveIdentifier", () => {
  it("reconnaît un email et le normalise en minuscules", () => {
    expect(resolveIdentifier("  Jean.Dupont@Example.com ")).toEqual({
      kind: "EMAIL",
      value: "jean.dupont@example.com",
    });
  });

  it("reconnaît un numéro ivoirien et le normalise en E.164", () => {
    const result = resolveIdentifier("0701020304");
    expect(result.kind).toBe("PHONE");
    expect(result.value).toMatch(/^\+225/);
  });

  it("lève une erreur sur un ancien numéro à 8 chiffres non résolu (à vérifier)", () => {
    expect(() => resolveIdentifier("12345678")).toThrow("Numéro de téléphone invalide.");
  });

  it("lève une erreur sur un format de numéro invalide", () => {
    expect(() => resolveIdentifier("12345")).toThrow();
  });
});
