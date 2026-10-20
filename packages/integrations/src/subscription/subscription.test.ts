import { describe, expect, it, vi } from "vitest";
import { FakeSubscriptionProvider } from "./fake";
import { ManualSubscriptionProvider } from "./manual";
import type { PlanChangeRequest } from "./provider";
import { resolveSubscriptionProvider } from "./registry";

const request: PlanChangeRequest = {
  organizationId: "org_1",
  organizationName: "Garage A",
  currentPlan: "STARTER",
  targetPlan: "PRO",
  requestedBy: { name: "Konan" },
  idempotencyKey: "org_1:PRO:1",
};

describe("abonnement (M15 US-M15-07)", () => {
  it("manual : transmet la demande, plan inchangé (PENDING)", async () => {
    const notify = vi.fn(async () => {});
    const result = await new ManualSubscriptionProvider(notify).requestPlanChange(request);
    expect(result).toEqual({ status: "PENDING", reference: "manual:org_1:PRO:1" });
    expect(notify).toHaveBeenCalledWith(request);
  });

  it("fake : applique immédiatement, idempotent", async () => {
    const provider = new FakeSubscriptionProvider();
    expect((await provider.requestPlanChange(request)).status).toBe("APPLIED");
    await provider.requestPlanChange(request);
    expect(provider.requests).toHaveLength(1);
  });

  it("registre : manual par défaut, fake interdit en production, inconnu refusé", () => {
    expect(resolveSubscriptionProvider().name).toBe("manual");
    expect(resolveSubscriptionProvider({ provider: "fake" }).name).toBe("fake");
    expect(() =>
      resolveSubscriptionProvider({ provider: "fake", allowSimulator: false }),
    ).toThrow();
    expect(() => resolveSubscriptionProvider({ provider: "stripe" })).toThrow();
  });
});
