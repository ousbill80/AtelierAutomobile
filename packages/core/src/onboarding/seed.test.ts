import { describe, expect, it } from "vitest";
import {
  defaultChannelConfigs,
  defaultInspectionTemplate,
  defaultLaborOperations,
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

  // Les règles de relance et modèles de message par défaut (RG-M10-02) sont couverts par
  // packages/core/src/reminders/defaults.test.ts.

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
