import { PERMISSIONS } from "@atelieros/core";
import { describe, expect, it } from "vitest";
import { t } from "./t";

// Paramètres › Rôles affiche chaque permission du catalogue : un libellé manquant fait planter
// la page (t() lève une erreur). Toute nouvelle permission doit avoir son libellé français.
describe("libellés des permissions", () => {
  it("chaque permission du catalogue a un libellé dans fr.json", () => {
    const missing = PERMISSIONS.filter((p) => {
      try {
        return !t(`permissions.${p}`);
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });
});
