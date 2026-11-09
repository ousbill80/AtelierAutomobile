import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildResetLink, buildResetToken, parseResetLinkArgs } from "./account-reset-link";

describe("account:reset-link — arguments", () => {
  it("lit un email (normalisé en minuscules)", () => {
    expect(parseResetLinkArgs(["--email", " Konan@Garage.CI "])).toEqual({
      kind: "EMAIL",
      value: "konan@garage.ci",
    });
  });

  it("lit un téléphone ivoirien et le normalise en E.164", () => {
    expect(parseResetLinkArgs(["--phone", "07 08 12 34 56"])).toEqual({
      kind: "PHONE",
      value: "+2250708123456",
    });
  });

  it("refuse une commande vide, ambiguë ou mal formée", () => {
    expect(parseResetLinkArgs([])).toBeNull();
    expect(parseResetLinkArgs(["--email"])).toBeNull();
    expect(parseResetLinkArgs(["--email", "pas-un-email"])).toBeNull();
    expect(parseResetLinkArgs(["--email", "a@b.ci", "--phone", "0708123456"])).toBeNull();
    expect(parseResetLinkArgs(["--phone", "123"])).toBeNull();
  });
});

describe("account:reset-link — jeton et lien", () => {
  it("produit le même format et la même empreinte SHA-256 que auth.verifyOtp(RESET)", () => {
    const { token, hash } = buildResetToken("user_1", Buffer.alloc(24, 1));
    expect(token).toBe(`user_1.${"01".repeat(24)}`);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("construit le lien vers la page mot de passe oublié", () => {
    expect(buildResetLink("https://atelier.exemple.ci/", "u.abc")).toBe(
      "https://atelier.exemple.ci/mot-de-passe-oublie?token=u.abc",
    );
  });
});
