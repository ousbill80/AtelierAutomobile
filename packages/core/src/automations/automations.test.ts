import { describe, expect, it } from "vitest";
import {
  AUTOMATION_MAX_DEPTH,
  AUTOMATION_TEMPLATES,
  automationMessageKey,
  conflictingSendRules,
  evaluateCondition,
  evaluateConditions,
  getPath,
  guardTrigger,
  interpolateAutomationText,
  nextRetryAt,
  runScheduledFor,
  UNAVAILABLE_TRIGGERS,
} from "./index";

const payload = {
  repairOrder: { status: "READY", totalEstimate: 185000 },
  customer: { type: "COMPANY", tags: ["vip", "flotte"], displayName: "SOTRA Logistique" },
  invoice: { balance: 0 },
  site: { code: "YOP" },
};

describe("RG-M17-23 — conditions", () => {
  it("lit un chemin pointé", () => {
    expect(getPath(payload, "repairOrder.status")).toBe("READY");
    expect(getPath(payload, "repairOrder.missing.x")).toBeUndefined();
  });

  it.each([
    [{ field: "repairOrder.status", op: "eq", value: "READY" }, true],
    [{ field: "repairOrder.status", op: "eq", value: "ready" }, true],
    [{ field: "repairOrder.status", op: "neq", value: "READY" }, false],
    [{ field: "repairOrder.totalEstimate", op: "gt", value: 100000 }, true],
    [{ field: "repairOrder.totalEstimate", op: "gte", value: "185000" }, true],
    [{ field: "repairOrder.totalEstimate", op: "lt", value: 185000 }, false],
    [{ field: "repairOrder.totalEstimate", op: "lte", value: 185000 }, true],
    [{ field: "invoice.balance", op: "gt", value: 0 }, false],
    [{ field: "site.code", op: "in", value: ["COC", "YOP"] }, true],
    [{ field: "site.code", op: "in", value: "COC, YOP" }, true],
    [{ field: "customer.tags", op: "contains", value: "flotte" }, true],
    [{ field: "customer.displayName", op: "contains", value: "sotra" }, true],
    [{ field: "customer.unknown", op: "gt", value: 1 }, false],
    [{ field: "customer.unknown", op: "eq", value: "x" }, false],
  ] as const)("%j → %s", (condition, expected) => {
    expect(evaluateCondition(condition as never, payload)).toBe(expected);
  });

  it("combine en ET et liste les conditions non remplies", () => {
    expect(evaluateConditions([], payload)).toEqual({ matched: true, failed: [] });
    const result = evaluateConditions(
      [
        { field: "repairOrder.status", op: "eq", value: "READY" },
        { field: "customer.type", op: "eq", value: "INDIVIDUAL" },
      ],
      payload,
    );
    expect(result.matched).toBe(false);
    expect(result.failed).toEqual([{ field: "customer.type", op: "eq", value: "INDIVIDUAL" }]);
  });
});

describe("RG-M17-24 — anti-boucle, délai, réessais, idempotence", () => {
  it("une règle ne se déclenche pas sur son propre événement ; profondeur max 3", () => {
    expect(guardTrigger("r1", { repairOrderId: "x" })).toEqual({ allowed: true, depth: 0 });
    expect(guardTrigger("r1", { automation: { ruleId: "r1", depth: 1 } })).toEqual({
      allowed: false,
      reason: "SELF_TRIGGERED",
    });
    expect(guardTrigger("r2", { automation: { ruleId: "r1", depth: 2 } })).toEqual({
      allowed: true,
      depth: 2,
    });
    expect(
      guardTrigger("r2", { automation: { ruleId: "r1", depth: AUTOMATION_MAX_DEPTH } }),
    ).toEqual({ allowed: false, reason: "MAX_DEPTH" });
  });

  it("délai : événement + delayMinutes, jamais dans le passé", () => {
    const at = new Date("2026-10-20T10:00:00Z");
    expect(runScheduledFor(at, 30, at).toISOString()).toBe("2026-10-20T10:30:00.000Z");
    const late = new Date("2026-10-20T12:00:00Z");
    expect(runScheduledFor(at, 30, late).toISOString()).toBe(late.toISOString());
    expect(runScheduledFor(at, 0, at).toISOString()).toBe(at.toISOString());
  });

  it("réessais : 3 tentatives au total", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(nextRetryAt(1, now)?.toISOString()).toBe("2026-10-20T10:05:00.000Z");
    expect(nextRetryAt(2, now)?.toISOString()).toBe("2026-10-20T10:10:00.000Z");
    expect(nextRetryAt(3, now)).toBeNull();
  });

  it("clé d'envoi identique pour deux règles sur le même événement", () => {
    expect(automationMessageKey("c1", "pret_j0", "ev1")).toBe("auto:c1:pret_j0:ev1");
  });

  it("avertit si une autre règle active envoie déjà sur le même déclencheur", () => {
    const rules = [
      {
        id: "a",
        trigger: "payment.received",
        isActive: true,
        actions: [{ type: "send_template" }],
      },
      {
        id: "b",
        trigger: "payment.received",
        isActive: false,
        actions: [{ type: "send_template" }],
      },
      { id: "c", trigger: "quote.viewed", isActive: true, actions: [{ type: "send_template" }] },
    ];
    const send = { trigger: "payment.received", actions: [{ type: "send_template" }] };
    expect(conflictingSendRules(rules, send).map((r) => r.id)).toEqual(["a"]);
    expect(conflictingSendRules(rules, { ...send, id: "a" })).toEqual([]);
    expect(
      conflictingSendRules(rules, {
        trigger: "payment.received",
        actions: [{ type: "create_task" }],
      }),
    ).toEqual([]);
  });
});

describe("RG-M17-25 — modèles fournis", () => {
  it("6 modèles, chacun avec au moins une action", () => {
    expect(AUTOMATION_TEMPLATES).toHaveLength(6);
    for (const template of AUTOMATION_TEMPLATES) expect(template.actions.length).toBeGreaterThan(0);
  });

  it("« OR prêt » réagit au passage à READY avec lien de paiement", () => {
    const tpl = AUTOMATION_TEMPLATES.find((t) => t.key === "ro_ready_message")!;
    expect(evaluateConditions(tpl.conditions, payload).matched).toBe(true);
    expect(tpl.actions[0]).toMatchObject({ type: "send_template", withPaymentLink: true });
  });

  it("le déclencheur avis client n'est pas encore émis", () => {
    expect(UNAVAILABLE_TRIGGERS.has("portal.feedback_received")).toBe(true);
  });

  it("interpole les textes de notification", () => {
    expect(
      interpolateAutomationText("Devis {{devis.numero}} {{x.y}}!", { devis: { numero: "DEV-1" } }),
    ).toBe("Devis DEV-1 !");
  });
});
