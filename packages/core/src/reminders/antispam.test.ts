import { describe, expect, it } from "vitest";
import {
  antiSpamAllows,
  applyAntiSpamCap,
  isSatisfactionBlocked,
  isTransactionalPriority,
  leastPriorityReminder,
  priorityOf,
} from "./antispam";

describe("priorityOf (RG-M10-16)", () => {
  it("APPOINTMENT et VEHICLE_READY sont hors plafond (priorité 0)", () => {
    expect(priorityOf("APPOINTMENT", "CONFIRM")).toBe(0);
    expect(priorityOf("VEHICLE_READY", "J0")).toBe(0);
  });

  it("RECEIVABLE : PROMISE_BROKEN et paliers ≥ J+30 sont priorité 1", () => {
    expect(priorityOf("RECEIVABLE", "PROMISE_BROKEN")).toBe(1);
    expect(priorityOf("RECEIVABLE", "J+30")).toBe(1);
    expect(priorityOf("RECEIVABLE", "J+45")).toBe(1);
  });

  it("RECEIVABLE : autres paliers sont priorité 3", () => {
    expect(priorityOf("RECEIVABLE", "J+15")).toBe(3);
    expect(priorityOf("RECEIVABLE", "J0")).toBe(3);
  });

  it("INSPECTION : J0 et J+7 sont priorité 2, les autres priorité 4", () => {
    expect(priorityOf("INSPECTION", "J0")).toBe(2);
    expect(priorityOf("INSPECTION", "J+7")).toBe(2);
    expect(priorityOf("INSPECTION", "J-30")).toBe(4);
  });

  it("QUOTE_FOLLOWUP est priorité 4", () => {
    expect(priorityOf("QUOTE_FOLLOWUP", "J+2")).toBe(4);
  });

  it("SERVICE est priorité 5, INSURANCE_EXPIRY priorité 6, SATISFACTION priorité 7", () => {
    expect(priorityOf("SERVICE", "J-15")).toBe(5);
    expect(priorityOf("INSURANCE_EXPIRY", "J-30")).toBe(6);
    expect(priorityOf("SATISFACTION", "J+3")).toBe(7);
  });
});

describe("isTransactionalPriority / leastPriorityReminder", () => {
  it("seule la priorité 0 est transactionnelle", () => {
    expect(isTransactionalPriority(0)).toBe(true);
    expect(isTransactionalPriority(1)).toBe(false);
  });

  it("renvoie la relance la moins prioritaire (chiffre le plus grand)", () => {
    const reminders = [
      { id: "a", priority: 2 as const },
      { id: "b", priority: 5 as const },
      { id: "c", priority: 1 as const },
    ];
    expect(leastPriorityReminder(reminders)?.id).toBe("b");
  });

  it("renvoie null sur une liste vide", () => {
    expect(leastPriorityReminder([])).toBeNull();
  });
});

describe("antiSpamAllows (RG-M10-16)", () => {
  const now = new Date("2026-10-19T10:00:00Z");

  it("les messages transactionnels (priorité 0) ne sont jamais plafonnés", () => {
    const history = Array.from({ length: 10 }, () => ({
      recipientKey: "+2250708000000",
      sentAt: now,
      priority: 3 as const,
    }));
    expect(antiSpamAllows("+2250708000000", 0, history, now)).toBe(true);
  });

  it("refuse un 2e message le même jour (maxPerDay = 1 par défaut)", () => {
    const history = [{ recipientKey: "+2250708000000", sentAt: now, priority: 4 as const }];
    expect(antiSpamAllows("+2250708000000", 4, history, now)).toBe(false);
  });

  it("autorise un autre destinataire même si le plafond du jour est atteint pour un autre", () => {
    const history = [{ recipientKey: "+2250708000000", sentAt: now, priority: 4 as const }];
    expect(antiSpamAllows("+2250709999999", 4, history, now)).toBe(true);
  });

  it("refuse le 4e message de la semaine (maxPerWeek = 3 par défaut, fenêtre glissante)", () => {
    // 3 envois espacés, aucun aujourd'hui (pour ne pas être bloqué par maxPerDay).
    const spreadHistory = [1, 3, 5].map((daysAgo) => ({
      recipientKey: "+2250708000000",
      sentAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
      priority: 4 as const,
    }));
    expect(antiSpamAllows("+2250708000000", 4, spreadHistory, now)).toBe(false);
  });

  it("ignore les envois hors fenêtre de 7 jours glissants", () => {
    const history = [
      {
        recipientKey: "+2250708000000",
        sentAt: new Date("2026-10-01T10:00:00Z"),
        priority: 4 as const,
      },
    ];
    expect(antiSpamAllows("+2250708000000", 4, history, now)).toBe(true);
  });

  it("ignore les envois transactionnels dans le décompte du plafond", () => {
    const history = [{ recipientKey: "+2250708000000", sentAt: now, priority: 0 as const }];
    expect(antiSpamAllows("+2250708000000", 4, history, now)).toBe(true);
  });

  it("respecte des plafonds personnalisés (settings.reminders)", () => {
    const history = [{ recipientKey: "+2250708000000", sentAt: now, priority: 4 as const }];
    expect(antiSpamAllows("+2250708000000", 4, history, now, { maxPerDay: 2 })).toBe(true);
  });
});

describe("applyAntiSpamCap (RG-M10-16)", () => {
  it("reporte (SNOOZED) les 3 premières fois", () => {
    expect(applyAntiSpamCap(0)).toEqual({
      action: "SNOOZED",
      reason: "Plafond anti-spam",
      snoozeCount: 1,
    });
    expect(applyAntiSpamCap(1)).toEqual({
      action: "SNOOZED",
      reason: "Plafond anti-spam",
      snoozeCount: 2,
    });
    expect(applyAntiSpamCap(2)).toEqual({
      action: "SNOOZED",
      reason: "Plafond anti-spam",
      snoozeCount: 3,
    });
  });

  it("passe SKIPPED après 3 reports", () => {
    const result = applyAntiSpamCap(3);
    expect(result.action).toBe("SKIPPED");
  });
});

describe("isSatisfactionBlocked (RG-M10-16)", () => {
  it("bloque si le dossier de recouvrement est ESCALATED ou DISPUTED", () => {
    expect(
      isSatisfactionBlocked({
        collectionCaseStatus: "ESCALATED",
        hasReceivableReminderSameDay: false,
      }),
    ).toBe(true);
    expect(
      isSatisfactionBlocked({
        collectionCaseStatus: "DISPUTED",
        hasReceivableReminderSameDay: false,
      }),
    ).toBe(true);
  });

  it("bloque si une relance de créance part le même jour", () => {
    expect(
      isSatisfactionBlocked({ collectionCaseStatus: null, hasReceivableReminderSameDay: true }),
    ).toBe(true);
  });

  it("autorise sinon", () => {
    expect(
      isSatisfactionBlocked({ collectionCaseStatus: "OPEN", hasReceivableReminderSameDay: false }),
    ).toBe(false);
    expect(
      isSatisfactionBlocked({ collectionCaseStatus: null, hasReceivableReminderSameDay: false }),
    ).toBe(false);
  });
});
