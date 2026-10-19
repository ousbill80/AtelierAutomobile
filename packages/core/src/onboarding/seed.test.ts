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

  it("defaultReminderRules couvre VT, révision, créances, RDV, devis, véhicule prêt", () => {
    const rules = defaultReminderRules();
    const types = rules.map((r) => r.type);
    expect(types).toEqual([
      "INSPECTION",
      "SERVICE",
      "RECEIVABLE",
      "APPOINTMENT",
      "QUOTE_FOLLOWUP",
      "VEHICLE_READY",
    ]);

    const inspection = rules.find((r) => r.type === "INSPECTION")!;
    expect(inspection.steps.map((s) => s.offsetDays)).toEqual([-30, -7, 0]);

    const receivable = rules.find((r) => r.type === "RECEIVABLE")!;
    expect(receivable.steps.map((s) => s.offsetDays)).toEqual([3, 15, 30, 45]);
  });

  it("chaque templateKey référencé par defaultReminderRules a un message par défaut", () => {
    const templateKeys = defaultReminderRules().flatMap((rule) =>
      rule.steps.map((step) => step.templateKey),
    );
    const definedKeys = new Set(defaultMessageTemplates().map((t) => t.key));
    for (const key of templateKeys) {
      expect(definedKeys.has(key)).toBe(true);
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
