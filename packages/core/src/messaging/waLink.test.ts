import { describe, expect, it } from "vitest";
import { buildWaLinkUrl } from "./waLink";

describe("buildWaLinkUrl", () => {
  it("construit l'URL wa.me avec le numéro sans '+' et le texte encodé", () => {
    expect(buildWaLinkUrl("+2250747218890", "Bonjour, votre VT expire bientôt.")).toBe(
      "https://wa.me/2250747218890?text=Bonjour%2C%20votre%20VT%20expire%20bient%C3%B4t.",
    );
  });
});
