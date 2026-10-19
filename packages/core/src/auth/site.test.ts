import { describe, expect, it } from "vitest";
import { canUseAllSitesOption, pickActiveSite } from "./site";

const YOP = { id: "site_yop", name: "Yopougon" };
const COC = { id: "site_coc", name: "Cocody" };
const ABO = { id: "site_abo", name: "Abobo" };

describe("pickActiveSite — RG-M01-10", () => {
  it("reprend le dernier site utilisé s'il est toujours autorisé", () => {
    expect(pickActiveSite({ authorizedSites: [YOP, COC], lastActiveSiteId: YOP.id })).toBe(YOP.id);
  });

  it("retombe sur le premier site autorisé par ordre alphabétique si le dernier n'est plus autorisé", () => {
    expect(
      pickActiveSite({ authorizedSites: [YOP, COC, ABO], lastActiveSiteId: "site_disparu" }),
    ).toBe(ABO.id);
  });

  it("choisit le premier site par ordre alphabétique en l'absence de dernier site", () => {
    expect(pickActiveSite({ authorizedSites: [YOP, COC], lastActiveSiteId: null })).toBe(COC.id);
  });

  it("lève une erreur si aucun site n'est autorisé", () => {
    expect(() => pickActiveSite({ authorizedSites: [], lastActiveSiteId: null })).toThrow(
      "Aucun site autorisé pour cet utilisateur.",
    );
  });
});

describe("canUseAllSitesOption — RG-M01-10", () => {
  it("refuse l'option avec un seul site autorisé", () => {
    expect(canUseAllSitesOption(1)).toBe(false);
  });

  it("autorise l'option dès 2 sites autorisés", () => {
    expect(canUseAllSitesOption(2)).toBe(true);
    expect(canUseAllSitesOption(3)).toBe(true);
  });
});
