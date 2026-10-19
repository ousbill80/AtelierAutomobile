import { describe, expect, it } from "vitest";
import { extractTemplateVariables, renderTemplate } from "./render";

describe("renderTemplate", () => {
  it("substitue toutes les variables connues", () => {
    const body = "Bonjour {{client.prenom}}, la VT de {{vehicule.plaque}} expire le {{vt.date}}.";
    const result = renderTemplate(body, {
      "client.prenom": "Jean",
      "vehicule.plaque": "CI-1234-AB",
      "vt.date": "02/11/2026",
    });
    expect(result).toBe("Bonjour Jean, la VT de CI-1234-AB expire le 02/11/2026.");
  });

  it("laisse un placeholder intact si la variable est absente", () => {
    const result = renderTemplate("Bonjour {{client.prenom}} !", {});
    expect(result).toBe("Bonjour {{client.prenom}} !");
  });

  it("laisse un placeholder intact si la valeur est null ou undefined", () => {
    const result = renderTemplate("Montant : {{facture.montant}}", {
      "facture.montant": null,
    });
    expect(result).toBe("Montant : {{facture.montant}}");
  });

  it("convertit les nombres en texte", () => {
    const result = renderTemplate("Solde : {{facture.solde}} FCFA", {
      "facture.solde": 185000,
    });
    expect(result).toBe("Solde : 185000 FCFA");
  });

  it("ne modifie pas un corps sans placeholder", () => {
    expect(renderTemplate("Texte simple.", {})).toBe("Texte simple.");
  });
});

describe("extractTemplateVariables", () => {
  it("retourne les chemins uniques, dans l'ordre d'apparition", () => {
    const body = "{{client.prenom}} — {{vehicule.plaque}} — {{client.prenom}}";
    expect(extractTemplateVariables(body)).toEqual(["client.prenom", "vehicule.plaque"]);
  });

  it("retourne un tableau vide si aucun placeholder", () => {
    expect(extractTemplateVariables("Rien ici.")).toEqual([]);
  });
});
