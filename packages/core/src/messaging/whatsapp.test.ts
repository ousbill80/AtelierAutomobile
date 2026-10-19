import { describe, expect, it } from "vitest";
import { toWhatsappParams, whatsappTemplateName } from "./whatsapp";

describe("toWhatsappParams", () => {
  it("convertit les variables en paramètres positionnels dans l'ordre d'apparition", () => {
    const result = toWhatsappParams(
      "{{client.salutation}}, votre VT ({{vehicule.plaque}}) expire le {{vt.dateExpiration}}.",
    );
    expect(result.body).toBe("{{1}}, votre VT ({{2}}) expire le {{3}}.");
    expect(result.paramMap).toEqual(["client.salutation", "vehicule.plaque", "vt.dateExpiration"]);
  });

  it("répète un numéro de paramètre distinct même si la variable est utilisée deux fois", () => {
    const result = toWhatsappParams("Bonjour {{client.prenom}}, {{client.prenom}} !");
    expect(result.body).toBe("Bonjour {{1}}, {{2}} !");
    expect(result.paramMap).toEqual(["client.prenom", "client.prenom"]);
  });

  it("laisse un texte sans variable inchangé", () => {
    expect(toWhatsappParams("Véhicule prêt.")).toEqual({ body: "Véhicule prêt.", paramMap: [] });
  });
});

describe("whatsappTemplateName", () => {
  it("construit {orgSlug}_{key}_v{n} en minuscules", () => {
    expect(whatsappTemplateName("GarageExcellenceAuto", "vt_j30", 1)).toBe(
      "garageexcellenceauto_vt_j30_v1",
    );
  });

  it("remplace les caractères non autorisés par des underscores", () => {
    expect(whatsappTemplateName("Garage Excellence", "vt-j30", 2)).toBe(
      "garage_excellence_vt_j30_v2",
    );
  });
});
