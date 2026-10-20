import { describe, expect, it } from "vitest";
import { t } from "./t";

describe("t() — libellés fr.json", () => {
  it("résout un chemin simple et les variables", () => {
    expect(t("aiInbox.book", { label: "samedi 24/10 à 08:30" })).toBe(
      "Réserver samedi 24/10 à 08:30",
    );
  });

  it("résout une clé contenant des points (événements, actions d'audit)", () => {
    expect(t("auditActions.auth.login.failed")).toBe("Connexion échouée");
    expect(t("automations.triggers.repair_order.status_changed")).toBeTruthy();
  });

  it("lève une erreur explicite pour une clé absente", () => {
    expect(() => t("aiInbox.inexistant")).toThrow(/Clé de traduction manquante/);
  });
});
