import { describe, expect, it } from "vitest";
import { normalizePlate } from "./plate";

describe("normalizePlate — RG-M02-05 plaque standard", () => {
  it.each(["2547gh01", "2547-GH-01", " 2547  gh 01 ", "2547GH01"])(
    "normalise %s en 2547 GH 01",
    (input) => {
      expect(normalizePlate(input)).toEqual({
        raw: input,
        plateCompact: "2547GH01",
        plate: "2547 GH 01",
        plateType: "STANDARD",
      });
    },
  );

  it("ne corrige jamais les confusions 0/O ou 1/I", () => {
    const result = normalizePlate("25O7GI01");
    expect(result.plateCompact).toBe("25O7GI01");
    expect(result.plateType).not.toBe("STANDARD");
  });
});

describe("normalizePlate — plaques provisoires", () => {
  it("WW 4512 01 est reconnue TEMPORARY", () => {
    expect(normalizePlate("WW 4512 01")).toEqual({
      raw: "WW 4512 01",
      plateCompact: "WW451201",
      plate: "WW 4512 01",
      plateType: "TEMPORARY",
    });
  });

  it("plaque garage W est reconnue TEMPORARY", () => {
    expect(normalizePlate("W 123 45")).toEqual({
      raw: "W 123 45",
      plateCompact: "W12345",
      plate: "W 123 45",
      plateType: "TEMPORARY",
    });
  });
});

describe("normalizePlate — diplomatiques, administratives, étrangères", () => {
  it("préfixe CD → DIPLOMATIC", () => {
    expect(normalizePlate("cd 1234")).toEqual({
      raw: "cd 1234",
      plateCompact: "CD1234",
      plate: "CD 1234",
      plateType: "DIPLOMATIC",
    });
  });

  it("préfixe CMD → DIPLOMATIC", () => {
    const result = normalizePlate("CMD 56");
    expect(result.plateType).toBe("DIPLOMATIC");
  });

  it("plaque étrangère (Burkina) conservée en format libre", () => {
    expect(normalizePlate("11 AB 1234")).toEqual({
      raw: "11 AB 1234",
      plateCompact: "11AB1234",
      plate: "11 AB 1234",
      plateType: "OTHER",
    });
  });
});

describe("normalizePlate — SANS PLAQUE", () => {
  it.each(["SANS PLAQUE", "sans plaque", "  ", ""])("%s → plateType NONE", (input) => {
    expect(normalizePlate(input)).toEqual({
      raw: input,
      plateCompact: "",
      plate: "SANS PLAQUE",
      plateType: "NONE",
    });
  });
});
