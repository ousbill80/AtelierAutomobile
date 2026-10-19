import { describe, expect, it } from "vitest";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  DEFAULT_REMINDER_RULES,
  resolveTemplateCandidates,
} from "./defaults";
import { collectStepIssues } from "./steps";
import { validateStopOn } from "./suppression";

describe("DEFAULT_REMINDER_RULES", () => {
  it("fournit une règle par défaut pour chaque type de relance (RG-M10-02)", () => {
    const types = DEFAULT_REMINDER_RULES.map((rule) => rule.type);
    expect(new Set(types)).toEqual(
      new Set([
        "INSPECTION",
        "SERVICE",
        "RECEIVABLE",
        "APPOINTMENT",
        "QUOTE_FOLLOWUP",
        "VEHICLE_READY",
        "INSURANCE_EXPIRY",
        "SATISFACTION",
      ]),
    );
  });

  it("a une frise de paliers valide pour chaque règle (RG-M10-03/06)", () => {
    for (const rule of DEFAULT_REMINDER_RULES) {
      const issues = collectStepIssues(rule.steps);
      expect(issues, `${rule.name}: ${JSON.stringify(issues)}`).toEqual([]);
    }
  });

  it("n'utilise que des événements `stopOn` de la liste blanche (RG-M10-22/23)", () => {
    for (const rule of DEFAULT_REMINDER_RULES) {
      expect(() => validateStopOn(rule.stopOn)).not.toThrow();
    }
  });

  it("a des clés de règle (`name`) non vides et uniques par type actif", () => {
    const activeByType = new Map<string, number>();
    for (const rule of DEFAULT_REMINDER_RULES) {
      expect(rule.name.trim().length).toBeGreaterThan(0);
      if (rule.isActive) {
        activeByType.set(rule.type, (activeByType.get(rule.type) ?? 0) + 1);
      }
    }
    for (const [type, count] of activeByType) {
      expect(count, `type ${type} a plusieurs règles actives par défaut`).toBeLessThanOrEqual(1);
    }
  });

  it("référence, pour chaque palier avec canaux, un modèle par défaut sur chacun de ses canaux", () => {
    const templateChannels = new Map<string, Set<string>>();
    for (const tpl of DEFAULT_MESSAGE_TEMPLATES) {
      const set = templateChannels.get(tpl.key) ?? new Set<string>();
      set.add(tpl.channel);
      templateChannels.set(tpl.key, set);
    }

    for (const rule of DEFAULT_REMINDER_RULES) {
      for (const step of rule.steps) {
        if (step.channels.length === 0) continue; // paliers internes (alerte gérant) : pas de modèle client.
        const channels = templateChannels.get(step.templateKey);
        expect(
          channels,
          `${rule.name} / ${step.key} : aucun modèle par défaut pour la clé « ${step.templateKey} »`,
        ).toBeDefined();
        for (const channel of step.channels) {
          expect(
            channels?.has(channel),
            `${rule.name} / ${step.key} : pas de modèle « ${step.templateKey} » pour le canal ${channel}`,
          ).toBe(true);
        }
      }
    }
  });

  it("n'exige pas de permission supplémentaire hors de la mise en demeure (RG-M10-02)", () => {
    const stepsWithPermission = DEFAULT_REMINDER_RULES.flatMap((rule) => rule.steps).filter(
      (step) => step.requiresPermission,
    );
    expect(stepsWithPermission.map((s) => s.requiresPermission)).toEqual([
      "receivable:formal_notice",
    ]);
  });
});

describe("DEFAULT_MESSAGE_TEMPLATES", () => {
  it("n'a pas de doublon (clé, canal)", () => {
    const seen = new Set<string>();
    for (const tpl of DEFAULT_MESSAGE_TEMPLATES) {
      const id = `${tpl.key}:${tpl.channel}`;
      expect(seen.has(id), `doublon : ${id}`).toBe(false);
      seen.add(id);
    }
  });

  it("a un corps non vide pour chaque modèle, et un objet pour les emails", () => {
    for (const tpl of DEFAULT_MESSAGE_TEMPLATES) {
      expect(tpl.body.trim().length, tpl.key).toBeGreaterThan(0);
      if (tpl.channel === "EMAIL") {
        expect(tpl.subject?.trim().length ?? 0, `${tpl.key} (email sans objet)`).toBeGreaterThan(0);
      }
    }
  });
});

describe("resolveTemplateCandidates", () => {
  it("ne propose que la clé de base pour un particulier", () => {
    expect(resolveTemplateCandidates("cr_jp3", "INDIVIDUAL")).toEqual(["cr_jp3"]);
  });

  it("propose d'abord la variante `_pro` pour une entreprise (RG-M10-13)", () => {
    expect(resolveTemplateCandidates("cr_jp3", "COMPANY")).toEqual(["cr_jp3_pro", "cr_jp3"]);
  });
});
