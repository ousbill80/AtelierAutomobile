import { describe, expect, it } from "vitest";
import {
  detectCombo,
  formatVehicleList,
  resolveGroupTemplateKey,
  templateKeyCandidates,
} from "./grouping";

describe("detectCombo — RG-M10-15", () => {
  it("VT et révision du même véhicule le même jour : combo détecté", () => {
    expect(
      detectCombo([
        { vehicleId: "veh_1", type: "INSPECTION" },
        { vehicleId: "veh_1", type: "SERVICE" },
      ]),
    ).toBe(true);
  });

  it("deux véhicules différents : pas de combo", () => {
    expect(
      detectCombo([
        { vehicleId: "veh_1", type: "INSPECTION" },
        { vehicleId: "veh_2", type: "SERVICE" },
      ]),
    ).toBe(false);
  });

  it("un seul type pour le véhicule : pas de combo", () => {
    expect(detectCombo([{ vehicleId: "veh_1", type: "INSPECTION" }])).toBe(false);
  });
});

describe("resolveGroupTemplateKey — RG-M10-13/15", () => {
  it("1 véhicule : modèle du palier", () => {
    expect(
      resolveGroupTemplateKey({
        type: "INSPECTION",
        stepTemplateKey: "vt_j30",
        vehicleCount: 1,
        isCombo: false,
      }),
    ).toBe("vt_j30");
  });

  it("≥ 2 véhicules VT : vt_multi", () => {
    expect(
      resolveGroupTemplateKey({
        type: "INSPECTION",
        stepTemplateKey: "vt_j30",
        vehicleCount: 3,
        isCombo: false,
      }),
    ).toBe("vt_multi");
  });

  it("≥ 2 véhicules révision : rev_multi", () => {
    expect(
      resolveGroupTemplateKey({
        type: "SERVICE",
        stepTemplateKey: "rev_j0",
        vehicleCount: 2,
        isCombo: false,
      }),
    ).toBe("rev_multi");
  });

  it("combo prioritaire sur le regroupement multi-véhicules", () => {
    expect(
      resolveGroupTemplateKey({
        type: "INSPECTION",
        stepTemplateKey: "vt_j0",
        vehicleCount: 1,
        isCombo: true,
      }),
    ).toBe("vt_rev_combo");
  });
});

describe("templateKeyCandidates — RG-M10-13", () => {
  it("client entreprise : suffixe _pro essayé avant la clé simple", () => {
    expect(templateKeyCandidates("vt_j30", true)).toEqual(["vt_j30_pro", "vt_j30"]);
  });

  it("client particulier : clé simple uniquement", () => {
    expect(templateKeyCandidates("vt_j30", false)).toEqual(["vt_j30"]);
  });
});

describe("formatVehicleList — RG-M10-15", () => {
  it("liste complète sous 10 véhicules", () => {
    expect(formatVehicleList(["AA 1", "AA 2"])).toBe("AA 1, AA 2");
  });

  it("tronque au-delà de 10 véhicules", () => {
    const plates = Array.from({ length: 12 }, (_, i) => `AA ${i}`);
    expect(formatVehicleList(plates)).toBe(
      "AA 0, AA 1, AA 2, AA 3, AA 4, AA 5, AA 6, AA 7, AA 8, AA 9 … et 2 autres véhicules, détail sur demande",
    );
  });
});
