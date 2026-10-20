import { describe, expect, it } from "vitest";
import { AI_CREDITS_BY_PLAN } from "../ai/features";
import { PLAN_LIMITS } from "../auth/plan";
import {
  assertWithinLimit,
  checkLimit,
  crossedWarningThreshold,
  downgradeImpact,
  planLimitMessage,
  smallestPlanAllowing,
  usageLevel,
} from "./limits";
import { PLAN_CATALOG, parsePlanOverrides, planRank, resolvePlan } from "./plans";

describe("PLAN_CATALOG (RG-M15-19, A12)", () => {
  it("reprend le tableau de M15", () => {
    expect(PLAN_CATALOG.STARTER.quotas).toMatchObject({
      activeMembers: 5,
      activeSites: 1,
      autoMessagesPerMonth: 1_000,
      aiCreditsPerMonth: 500,
      apiRatePerMinute: 60,
      auditRetentionDays: 90,
    });
    expect(PLAN_CATALOG.PRO.quotas).toMatchObject({ activeMembers: 15, activeSites: 3 });
    expect(PLAN_CATALOG.NETWORK.quotas.activeSites).toBeNull();
    expect(PLAN_CATALOG.NETWORK.features.multiSite).toBe(true);
    expect(PLAN_CATALOG.STARTER.features.aiAssistant).toBe(false);
  });

  it("est la source unique de RG-M01-13 et des crédits IA de M17", () => {
    expect(PLAN_LIMITS.STARTER).toEqual({ maxActiveMembers: 5, maxSites: 1 });
    expect(AI_CREDITS_BY_PLAN).toEqual({ STARTER: 500, PRO: 3_000, NETWORK: 10_000 });
  });

  it("ordonne les plans", () => {
    expect(planRank("STARTER")).toBeLessThan(planRank("PRO"));
    expect(planRank("PRO")).toBeLessThan(planRank("NETWORK"));
  });
});

describe("planOverrides", () => {
  it("applique les surcharges valides et ignore le reste", () => {
    expect(
      parsePlanOverrides({
        activeSites: 2,
        activeMembers: null,
        foo: 3,
        apiKeys: -1,
        aiCreditsPerMonth: 1.5,
      }),
    ).toEqual({ activeSites: 2, activeMembers: null });
    expect(parsePlanOverrides({ apiRatePerMinute: null })).toEqual({});
    expect(parsePlanOverrides("x")).toEqual({});
    expect(parsePlanOverrides([1])).toEqual({});
    expect(resolvePlan("STARTER", { activeSites: 2 }).quotas.activeSites).toBe(2);
    expect(resolvePlan("STARTER", null).quotas.activeSites).toBe(1);
  });
});

describe("checkLimit (RG-M15-20)", () => {
  const starter = resolvePlan("STARTER");

  it("autorise sous la limite et refuse au-delà", () => {
    expect(checkLimit(starter, "activeSites", 0).allowed).toBe(true);
    expect(checkLimit(starter, "activeSites", 1).allowed).toBe(false);
    expect(checkLimit(starter, "activeMembers", 4).allowed).toBe(true);
    expect(checkLimit(starter, "activeMembers", 5).allowed).toBe(false);
  });

  it("autorise toujours un incrément nul ou négatif et l'illimité", () => {
    expect(checkLimit(starter, "activeSites", 5, -1).allowed).toBe(true);
    expect(checkLimit(resolvePlan("NETWORK"), "activeSites", 999).allowed).toBe(true);
  });

  it("calcule les niveaux 80 % / 100 %", () => {
    expect(usageLevel(799, 1_000)).toBe("OK");
    expect(usageLevel(800, 1_000)).toBe("WARNING");
    expect(usageLevel(1_000, 1_000)).toBe("REACHED");
    expect(usageLevel(10_000, null)).toBe("OK");
    expect(crossedWarningThreshold(1_000, 799, 800)).toBe(true);
    expect(crossedWarningThreshold(1_000, 800, 801)).toBe(false);
    expect(crossedWarningThreshold(null, 0, 1)).toBe(false);
  });

  it("formule le message de M15 et suggère le bon plan", () => {
    const check = checkLimit(starter, "activeSites", 1);
    expect(planLimitMessage(starter, check)).toBe(
      "Votre offre STARTER permet 1 site. Passez à l'offre PRO.",
    );
    expect(smallestPlanAllowing("activeSites", 4)).toBe("NETWORK");
    expect(smallestPlanAllowing("autoMessagesPerMonth", 50_000)).toBeNull();
    const pro = resolvePlan("PRO");
    expect(planLimitMessage(pro, checkLimit(pro, "activeMembers", 15))).toBe(
      "Votre offre PRO permet 15 utilisateurs actifs. Passez à l'offre NETWORK.",
    );
    const network = resolvePlan("NETWORK");
    expect(planLimitMessage(network, checkLimit(network, "autoMessagesPerMonth", 20_000))).toBe(
      "Votre offre NETWORK permet 20 000 messages automatiques par mois. Contactez l'équipe AtelierOS.",
    );
  });

  it("assertWithinLimit lève PLAN_LIMIT_REACHED", () => {
    expect(() => assertWithinLimit(starter, "activeSites", 1)).toThrowError(
      expect.objectContaining({ code: "PLAN_LIMIT_REACHED" }),
    );
    expect(assertWithinLimit(starter, "activeSites", 0).allowed).toBe(true);
  });

  it("rétrogradation : liste les dépassements sans rien supprimer", () => {
    expect(
      downgradeImpact(starter, {
        activeSites: 3,
        activeMembers: 4,
        autoMessagesPerMonth: 4_000,
      }),
    ).toEqual([{ key: "activeSites", used: 3, limit: 1, excess: 2 }]);
  });
});
