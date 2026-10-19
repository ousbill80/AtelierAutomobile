import { describe, expect, it } from "vitest";
import {
  defaultChannelConfigs,
  defaultInspectionTemplate,
  defaultLaborOperations,
  defaultMessageTemplates,
  defaultReminderRules,
  defaultSiteBays,
  defaultSiteOpeningHours,
} from "./seed";

describe("onboarding seed (RG-M01-16)", () => {
  it("defaultSiteOpeningHours couvre lun-ven 07:30-18:00, sam 08:00-14:00, dimanche fermé", () => {
    const hours = defaultSiteOpeningHours();
    expect(hours.mon).toEqual([["07:30", "18:00"]]);
    expect(hours.fri).toEqual([["07:30", "18:00"]]);
    expect(hours.sat).toEqual([["08:00", "14:00"]]);
    expect(hours.sun).toEqual([]);
  });

  it("defaultSiteBays retourne 2 ponts LIFT + 1 diagnostic", () => {
    const bays = defaultSiteBays();
    expect(bays.filter((b) => b.type === "LIFT")).toHaveLength(2);
    expect(bays.filter((b) => b.type === "DIAGNOSTIC")).toHaveLength(1);
  });

  it("defaultReminderRules installe les 9 règles de M10 (RG-M10-02)", () => {
    const rules = defaultReminderRules();
    expect(rules.map((r) => `${r.type}:${r.isActive}`)).toEqual([
      "INSPECTION:true",
      "SERVICE:true",
      "RECEIVABLE:true",
      "RECEIVABLE:false",
      "APPOINTMENT:true",
      "QUOTE_FOLLOWUP:true",
      "VEHICLE_READY:true",
      "INSURANCE_EXPIRY:false",
      "SATISFACTION:true",
    ]);

    const inspection = rules.find((r) => r.type === "INSPECTION")!;
    expect(inspection.steps.map((s) => s.offsetDays)).toEqual([-30, -7, 0, 7]);

    const receivable = rules.find((r) => r.type === "RECEIVABLE" && r.isActive)!;
    expect(receivable.steps.map((s) => s.offsetDays)).toEqual([3, 15, 30, 45, 60]);
  });

  it("defaultReminderRules renvoie une copie : la modifier n'altère pas l'appel suivant", () => {
    defaultReminderRules()[0]!.steps.pop();
    expect(defaultReminderRules()[0]!.steps).toHaveLength(4);
  });

  it("chaque templateKey référencé par defaultReminderRules a un message par défaut", () => {
    // Un palier interne (alerte au gérant, `internalOnly`) ne s'adresse pas au client.
    const templateKeys = defaultReminderRules().flatMap((rule) =>
      rule.steps.filter((step) => !step.internalOnly).map((step) => step.templateKey),
    );
    const definedKeys = new Set(defaultMessageTemplates().map((t) => t.key));
    for (const key of templateKeys) {
      expect(definedKeys.has(key)).toBe(true);
    }
  });

  it("chaque palier non interne a un modèle pour chacun de ses canaux", () => {
    const pairs = new Set(defaultMessageTemplates().map((t) => `${t.key}|${t.channel}`));
    for (const rule of defaultReminderRules()) {
      for (const step of rule.steps) {
        for (const channel of step.channels) {
          expect(
            pairs.has(`${step.templateKey}|${channel}`),
            `${step.templateKey}|${channel}`,
          ).toBe(true);
        }
      }
    }
  });

  it("defaultMessageTemplates : Annexe A complète, sans doublon (clé, canal)", () => {
    const templates = defaultMessageTemplates();
    const pairs = templates.map((t) => `${t.key}|${t.channel}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(templates).toHaveLength(97);
    // Variantes entreprise (RG-M10-13) et demande de date de VT (Échéances).
    for (const key of ["cr_jp3_pro", "cr_jp15_pro", "cr_jp30_pro"]) {
      expect(pairs).toEqual(
        expect.arrayContaining([`${key}|WHATSAPP`, `${key}|SMS`, `${key}|EMAIL`]),
      );
    }
    expect(pairs).toEqual(
      expect.arrayContaining(["vt_demande_date|WHATSAPP", "vt_demande_date|SMS"]),
    );
  });

  it("un email a toujours un objet, un WhatsApp/SMS jamais", () => {
    for (const template of defaultMessageTemplates()) {
      if (template.channel === "EMAIL") expect(template.subject, template.key).toBeTruthy();
      else expect(template.subject, template.key).toBeUndefined();
    }
  });

  it("les modèles n'utilisent que des variables {{espace.nom}}", () => {
    for (const template of defaultMessageTemplates()) {
      const text = `${template.subject ?? ""} ${template.body}`;
      for (const match of text.matchAll(/\{\{([^}]*)\}\}/g)) {
        expect(match[1], template.key).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      }
    }
  });

  it("defaultInspectionTemplate s'appelle « Inspection 30 points » et compte 30 items", () => {
    const template = defaultInspectionTemplate();
    expect(template.name).toBe("Inspection 30 points");
    expect(template.items).toHaveLength(30);
  });

  it("defaultLaborOperations a des codes uniques", () => {
    const operations = defaultLaborOperations();
    const codes = new Set(operations.map((o) => o.code));
    expect(codes.size).toBe(operations.length);
  });

  it("defaultChannelConfigs active WhatsApp wa_link et désactive EMAIL console", () => {
    const configs = defaultChannelConfigs();
    const whatsapp = configs.find((c) => c.channel === "WHATSAPP")!;
    const email = configs.find((c) => c.channel === "EMAIL")!;
    expect(whatsapp).toMatchObject({ provider: "wa_link", isActive: true });
    expect(email).toMatchObject({ provider: "console", isActive: false });
  });
});
