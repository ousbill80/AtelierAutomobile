import { describe, expect, it } from "vitest";
import { collectStepIssues, describeStepsChange, validateSteps } from "./steps";
import type { ReminderStep } from "./types";

function step(partial: Partial<ReminderStep> & { key: string }): ReminderStep {
  return {
    label: partial.key,
    offsetDays: 0,
    templateKey: "tpl",
    autoSend: true,
    channels: ["WHATSAPP"],
    ...partial,
  };
}

describe("collectStepIssues", () => {
  it("accepte la frise VT par défaut (J-30, J-7, J0, J+7)", () => {
    const steps = [
      step({ key: "J-30", offsetDays: -30 }),
      step({ key: "J-7", offsetDays: -7 }),
      step({ key: "J0", offsetDays: 0 }),
      step({ key: "J+7", offsetDays: 7 }),
    ];
    expect(collectStepIssues(steps)).toEqual([]);
  });

  it("refuse une règle sans palier", () => {
    expect(collectStepIssues([])).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("au moins un palier") }),
    );
  });

  it("refuse plus de 8 paliers (US-M10-07)", () => {
    const steps = Array.from({ length: 9 }, (_, i) => step({ key: `J+${i}`, offsetDays: i }));
    expect(collectStepIssues(steps).some((issue) => issue.message.includes("8 paliers"))).toBe(
      true,
    );
  });

  it("refuse les clés dupliquées", () => {
    const steps = [step({ key: "J0", offsetDays: 0 }), step({ key: "J0", offsetDays: 5 })];
    expect(collectStepIssues(steps).some((i) => i.message.includes("dupliquée"))).toBe(true);
  });

  it("refuse une clé hors format autorisé", () => {
    const steps = [step({ key: "palier invalide!", offsetDays: 0 })];
    expect(collectStepIssues(steps).length).toBeGreaterThan(0);
  });

  it("refuse un offset hors [-365, 365]", () => {
    const steps = [step({ key: "J-400", offsetDays: -400 })];
    expect(collectStepIssues(steps).some((i) => i.message.includes("décalage"))).toBe(true);
  });

  it("refuse les offsets non strictement croissants dans le même groupe d'ancre", () => {
    const steps = [step({ key: "J+5", offsetDays: 5 }), step({ key: "J+2", offsetDays: 2 })];
    expect(collectStepIssues(steps).some((i) => i.message.includes("ordre croissant"))).toBe(true);
  });

  it("accepte un palier EXPIRE ancré sur validUntil même avec un offset plus faible que les paliers sentAt (suivi de devis)", () => {
    const steps = [
      step({ key: "J+2", offsetDays: 2, anchor: "sentAt" }),
      step({ key: "J+5", offsetDays: 5, anchor: "sentAt" }),
      step({ key: "EXPIRE", offsetDays: -1, anchor: "validUntil" }),
    ];
    expect(collectStepIssues(steps)).toEqual([]);
  });

  it("internalOnly ⇒ channels doit être vide", () => {
    const steps = [
      step({ key: "J+45", offsetDays: 45, internalOnly: true, channels: ["WHATSAPP"] }),
    ];
    expect(collectStepIssues(steps).some((i) => i.message.includes("interne"))).toBe(true);
  });

  it("accepte internalOnly avec channels vide", () => {
    const steps = [step({ key: "J+45", offsetDays: 45, internalOnly: true, channels: [] })];
    expect(collectStepIssues(steps)).toEqual([]);
  });

  it("refuse une heure imposée mal formée", () => {
    const steps = [step({ key: "J-1", offsetDays: -1, sendAt: "17h00" })];
    expect(collectStepIssues(steps).some((i) => i.message.includes("HH:MM"))).toBe(true);
  });

  it("accepte une heure imposée bien formée", () => {
    const steps = [step({ key: "J-1", offsetDays: -1, sendAt: "17:00" })];
    expect(collectStepIssues(steps)).toEqual([]);
  });

  it("refuse un catchUpDays négatif", () => {
    const steps = [step({ key: "J0", offsetDays: 0, catchUpDays: -1 })];
    expect(collectStepIssues(steps).some((i) => i.message.includes("rattrapage"))).toBe(true);
  });
});

describe("validateSteps", () => {
  it("lève une DomainError à la première violation", () => {
    expect(() => validateSteps([])).toThrow();
  });

  it("ne lève rien pour une frise valide", () => {
    expect(() => validateSteps([step({ key: "J0", offsetDays: 0 })])).not.toThrow();
  });
});

describe("describeStepsChange", () => {
  it("détecte les paliers ajoutés, supprimés et modifiés", () => {
    const previous = [step({ key: "J-30", offsetDays: -30 }), step({ key: "J-7", offsetDays: -7 })];
    const next = [
      step({ key: "J-30", offsetDays: -30, autoSend: false }),
      step({ key: "J-3", offsetDays: -3 }),
    ];
    const result = describeStepsChange(previous, next);
    expect(result.added).toEqual(["J-3"]);
    expect(result.removed).toEqual(["J-7"]);
    expect(result.changed).toEqual(["J-30"]);
  });
});
