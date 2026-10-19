import { describe, expect, it } from "vitest";
import {
  buildDedupeKey,
  buildGroupKey,
  buildManualDedupeKey,
  buildPromiseBrokenDedupeKey,
  buildRecipientKey,
  buildSequenceKey,
} from "./keys";

describe("buildSequenceKey / buildDedupeKey — RG-M10-05", () => {
  it("compose la clé de séquence puis la clé de dédoublonnage", () => {
    const seqKey = buildSequenceKey({
      type: "INSPECTION",
      entityId: "veh_8k2",
      anchor: new Date("2026-11-02"),
    });
    expect(seqKey).toBe("INSPECTION:veh_8k2:2026-11-02");
    expect(buildDedupeKey(seqKey, "J-30")).toBe("INSPECTION:veh_8k2:2026-11-02:J-30");
  });

  it("promesse rompue et relance manuelle sont hors séquence", () => {
    expect(buildPromiseBrokenDedupeKey("case_3f", new Date("2026-09-10"), "promise_1")).toBe(
      "RECEIVABLE:case_3f:2026-09-10:PROMISE_BROKEN:promise_1",
    );
    expect(buildManualDedupeKey("RECEIVABLE", "cust_1", new Date("2026-10-18T14:05:00Z"))).toBe(
      "RECEIVABLE:cust_1:MANUAL:202610181405",
    );
  });
});

describe("buildRecipientKey — RG-M10-14", () => {
  it("un numéro de téléphone s'utilise tel quel (déjà normalisé E.164)", () => {
    expect(buildRecipientKey({ kind: "phone", e164: "+2250708091011" })).toBe("+2250708091011");
  });

  it("un email est comparé en minuscules", () => {
    expect(buildRecipientKey({ kind: "email", address: "Jean.Marc@Exemple.CI" })).toBe(
      "jean.marc@exemple.ci",
    );
  });
});

describe("buildGroupKey — RG-M10-15", () => {
  it("compose recipientKey:type:stepKey:date", () => {
    const key = buildGroupKey({
      recipientKey: "+2250708091011",
      type: "INSPECTION",
      stepKey: "J-30",
      date: new Date("2026-10-18"),
    });
    expect(key).toBe("+2250708091011:INSPECTION:J-30:2026-10-18");
  });
});
