import { describe, expect, it } from "vitest";
import { pickStep, stepsToSupersede, type PickStepHistoryEntry } from "./pickStep";

// Palier VT par défaut (RG-M10-02) : J-30, J-7, J0, J+7.
const VT_STEPS = [
  { key: "J-30", offsetDays: -30 },
  { key: "J-7", offsetDays: -7 },
  { key: "J0", offsetDays: 0 },
  { key: "J+7", offsetDays: 7 },
];

describe("pickStep — RG-M10-06", () => {
  it("M. Kouassi : VT au 02/11, aujourd'hui 18/10 → J-30 créé en rattrapage", () => {
    const result = pickStep({
      steps: VT_STEPS,
      anchor: new Date("2026-11-02"),
      today: new Date("2026-10-18"),
      history: [],
      minGapDays: 3,
      defaultCatchUpDays: 7,
    });
    expect(result?.step.key).toBe("J-30");
    expect(result?.catchUp).toBe(true);
    expect(result?.notBefore).toBeNull();
  });

  it("Mme Yao : VT expirée le 12/10, aujourd'hui 18/10 → J0 hors fenêtre de rattrapage, rien", () => {
    const result = pickStep({
      steps: VT_STEPS,
      anchor: new Date("2026-10-12"),
      today: new Date("2026-10-18"),
      history: [],
      minGapDays: 3,
      defaultCatchUpDays: 7,
    });
    expect(result).toBeNull();
  });

  it("Mme Yao : le lendemain 19/10 → J+7 (cible exacte, pas un rattrapage)", () => {
    const result = pickStep({
      steps: VT_STEPS,
      anchor: new Date("2026-10-12"),
      today: new Date("2026-10-19"),
      history: [],
      minGapDays: 3,
      defaultCatchUpDays: 7,
    });
    expect(result?.step.key).toBe("J+7");
    expect(result?.catchUp).toBe(false);
  });

  it("jamais de palier déjà créé pour ce stepKey", () => {
    const history: PickStepHistoryEntry[] = [
      { stepKey: "J-30", status: "SENT", sentAt: new Date("2026-10-03") },
    ];
    const result = pickStep({
      steps: VT_STEPS,
      anchor: new Date("2026-11-02"),
      today: new Date("2026-10-18"),
      history,
      minGapDays: 3,
      defaultCatchUpDays: 7,
    });
    expect(result).toBeNull();
  });

  it("jamais de palier inférieur ou égal à un palier déjà envoyé", () => {
    const history: PickStepHistoryEntry[] = [
      { stepKey: "J+7", status: "SENT", sentAt: new Date("2026-10-01") },
    ];
    const result = pickStep({
      steps: VT_STEPS,
      anchor: new Date("2026-10-18"),
      today: new Date("2026-10-18"),
      history,
      minGapDays: 3,
      defaultCatchUpDays: 7,
    });
    expect(result).toBeNull();
  });

  it("minGapDays : notBefore repousse l'envoi si le dernier envoi est trop récent", () => {
    const history: PickStepHistoryEntry[] = [
      { stepKey: "J-30", status: "SENT", sentAt: new Date("2026-10-25") },
    ];
    const result = pickStep({
      steps: VT_STEPS,
      anchor: new Date("2026-11-02"),
      today: new Date("2026-10-27"),
      history,
      minGapDays: 3,
      defaultCatchUpDays: 7,
    });
    expect(result?.step.key).toBe("J-7");
    expect(result?.notBefore?.toISOString().slice(0, 10)).toBe("2026-10-28");
  });

  it("dernier palier : catchUpDays borne le rattrapage au-delà duquel on abandonne", () => {
    const result = pickStep({
      steps: VT_STEPS,
      anchor: new Date("2026-10-12"),
      today: new Date("2026-10-27"), // J+7 cible 19/10 + 7 j = 26/10, 27/10 est hors fenêtre
      history: [],
      minGapDays: 3,
      defaultCatchUpDays: 7,
    });
    expect(result).toBeNull();
  });
});

describe("stepsToSupersede — RG-M10-07", () => {
  it("remplace les paliers antérieurs encore non envoyés", () => {
    const history = [
      { stepKey: "J-30", status: "PLANNED" },
      { stepKey: "J-7", status: "NEEDS_APPROVAL" },
      { stepKey: "J0", status: "SENT" },
    ];
    const result = stepsToSupersede(VT_STEPS, "J+7", history);
    expect(result.map((r) => r.stepKey)).toEqual(["J-30", "J-7"]);
  });

  it("ne remplace rien pour un stepKey inconnu", () => {
    const history = [{ stepKey: "J-30", status: "PLANNED" }];
    expect(stepsToSupersede(VT_STEPS, "UNKNOWN", history)).toEqual([]);
  });
});
