import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPROVAL_MODE,
  initialReminderStatus,
  isDispatchPaused,
  NO_CHANNEL,
} from "./approval";

describe("initialReminderStatus", () => {
  it("exige une validation si aucun canal utilisable (RG-M10-31)", () => {
    expect(
      initialReminderStatus({
        autoSend: true,
        approvalMode: "PER_STEP",
        isCatchUp: false,
        hasChannel: false,
      }),
    ).toBe("NEEDS_APPROVAL");
  });

  it("exige une validation sans canal même en mode PAUSED ou MANUAL_ALL", () => {
    expect(
      initialReminderStatus({
        autoSend: true,
        approvalMode: "PAUSED",
        isCatchUp: false,
        hasChannel: false,
      }),
    ).toBe("NEEDS_APPROVAL");
  });

  it("exige une validation en mode MANUAL_ALL même si autoSend est vrai", () => {
    expect(
      initialReminderStatus({
        autoSend: true,
        approvalMode: "MANUAL_ALL",
        isCatchUp: false,
        hasChannel: true,
      }),
    ).toBe("NEEDS_APPROVAL");
  });

  it("exige une validation pour un rattrapage (RG-M10-06/09.1)", () => {
    expect(
      initialReminderStatus({
        autoSend: true,
        approvalMode: "PER_STEP",
        isCatchUp: true,
        hasChannel: true,
      }),
    ).toBe("NEEDS_APPROVAL");
  });

  it("planifie directement si autoSend est vrai, mode PER_STEP, pas de rattrapage, canal présent", () => {
    expect(
      initialReminderStatus({
        autoSend: true,
        approvalMode: "PER_STEP",
        isCatchUp: false,
        hasChannel: true,
      }),
    ).toBe("PLANNED");
  });

  it("exige une validation si autoSend est faux", () => {
    expect(
      initialReminderStatus({
        autoSend: false,
        approvalMode: "PER_STEP",
        isCatchUp: false,
        hasChannel: true,
      }),
    ).toBe("NEEDS_APPROVAL");
  });

  it("planifie en mode PAUSED (le blocage d'envoi relève d'isDispatchPaused, pas du statut)", () => {
    expect(
      initialReminderStatus({
        autoSend: true,
        approvalMode: "PAUSED",
        isCatchUp: false,
        hasChannel: true,
      }),
    ).toBe("PLANNED");
  });
});

describe("isDispatchPaused", () => {
  it("renvoie true uniquement pour PAUSED", () => {
    expect(isDispatchPaused("PAUSED")).toBe(true);
    expect(isDispatchPaused("PER_STEP")).toBe(false);
    expect(isDispatchPaused("MANUAL_ALL")).toBe(false);
  });
});

describe("constantes", () => {
  it("expose un mode par défaut et un canal nul par défaut", () => {
    expect(DEFAULT_APPROVAL_MODE).toBe("PER_STEP");
    expect(NO_CHANNEL).toBeNull();
  });
});
