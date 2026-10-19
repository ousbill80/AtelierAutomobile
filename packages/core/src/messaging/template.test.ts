import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template";
import { isDomainError } from "../errors";

describe("renderTemplate", () => {
  it("rend une variable simple pour SMS sans échappement", () => {
    const result = renderTemplate({
      template: "Bonjour {{client.prenom}}, votre VT expire le {{vt.date}}.",
      context: { client: { prenom: "Jean-Marc" }, vt: { date: "30/11/2026" } },
      channel: "SMS",
    });
    expect(result.body).toBe("Bonjour Jean-Marc, votre VT expire le 30/11/2026.");
  });

  it("applique les helpers formatMoney et upper", () => {
    const result = renderTemplate({
      template: "{{upper client.prenom}}, solde {{formatMoney facture.solde}}.",
      context: { client: { prenom: "jean" }, facture: { solde: 185000 } },
      channel: "SMS",
    });
    expect(result.body).toBe("JEAN, solde 185 000 FCFA.");
  });

  it("bloque l'envoi si une variable référencée est manquante ou vide", () => {
    expect(() =>
      renderTemplate({
        template: "Payez ici : {{lien.paiement}}",
        context: { lien: { paiement: "" } },
        channel: "SMS",
      }),
    ).toThrowError();
    try {
      renderTemplate({
        template: "Payez ici : {{lien.paiement}}",
        context: {},
        channel: "SMS",
      });
      expect.fail("devrait lever une erreur");
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      if (isDomainError(error)) {
        expect(error.code).toBe("messaging.template_variable_missing");
        expect(error.details?.variable).toBe("lien.paiement");
      }
    }
  });

  it("n'exige pas une variable marquée optionnelle", () => {
    const result = renderTemplate({
      template: "Horaires : {{garage.horaires}}",
      context: { garage: {} },
      channel: "SMS",
      optionalVariables: ["garage.horaires"],
    });
    expect(result.body).toBe("Horaires : ");
  });

  it("échappe le HTML pour l'email mais pas pour le SMS/WhatsApp", () => {
    const context = { client: { prenom: "<Jean>" } };
    const email = renderTemplate({ template: "{{client.prenom}}", context, channel: "EMAIL" });
    expect(email.body).toBe("&lt;Jean&gt;");

    const sms = renderTemplate({ template: "{{client.prenom}}", context, channel: "SMS" });
    expect(sms.body).toBe("<Jean>");
  });
});
