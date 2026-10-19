import { describe, expect, it } from "vitest";
import {
  assertValidSuppressionScope,
  buildAnchorChangedSuppression,
  buildAppointmentSuppressions,
  buildOwnerChangedSuppression,
  buildReplyPauseSuppression,
  buildStopSequenceSuppression,
  isSuppressed,
  isValidStopEvent,
  liftSuppressionsForSequence,
  validateStopOn,
} from "./suppression";

describe("isValidStopEvent / validateStopOn (RG-M10-23)", () => {
  it("accepte les événements de la liste blanche", () => {
    expect(isValidStopEvent("appointment.created")).toBe(true);
    expect(isValidStopEvent("payment.received")).toBe(true);
  });

  it("rejette un événement inconnu", () => {
    expect(isValidStopEvent("foo.bar")).toBe(false);
  });

  it("validateStopOn ne lève rien pour une liste valide", () => {
    expect(() => validateStopOn(["appointment.created", "payment.received"])).not.toThrow();
  });

  it("validateStopOn lève une DomainError pour une valeur hors liste blanche", () => {
    expect(() => validateStopOn(["appointment.created", "vehicle.magically_fixed"])).toThrow();
  });
});

describe("isSuppressed (RG-M10-21)", () => {
  const now = new Date("2026-10-19T10:00:00Z");

  it("couvre par sequenceKey exacte", () => {
    const target = {
      sequenceKey: "INSPECTION:veh_1:2026-11-02",
      customerId: "c1",
      type: "INSPECTION" as const,
    };
    expect(
      isSuppressed(target, [{ sequenceKey: "INSPECTION:veh_1:2026-11-02", until: null }], now),
    ).toBe(true);
  });

  it("couvre par (customerId, type)", () => {
    const target = { sequenceKey: "X", customerId: "c1", type: "RECEIVABLE" as const };
    expect(isSuppressed(target, [{ customerId: "c1", type: "RECEIVABLE", until: null }], now)).toBe(
      true,
    );
  });

  it("couvre par (vehicleId, type)", () => {
    const target = {
      sequenceKey: "X",
      customerId: "c1",
      vehicleId: "v1",
      type: "SERVICE" as const,
    };
    expect(isSuppressed(target, [{ vehicleId: "v1", type: "SERVICE", until: null }], now)).toBe(
      true,
    );
  });

  it("ne couvre pas un type différent même avec le même client/véhicule", () => {
    const target = {
      sequenceKey: "X",
      customerId: "c1",
      vehicleId: "v1",
      type: "SERVICE" as const,
    };
    expect(isSuppressed(target, [{ vehicleId: "v1", type: "INSPECTION", until: null }], now)).toBe(
      false,
    );
  });

  it("ignore une suppression expirée (until dépassé)", () => {
    const target = {
      sequenceKey: "INSPECTION:veh_1:2026-11-02",
      customerId: "c1",
      type: "INSPECTION" as const,
    };
    const suppressions = [
      { sequenceKey: target.sequenceKey, until: new Date("2026-10-18T00:00:00Z") },
    ];
    expect(isSuppressed(target, suppressions, now)).toBe(false);
  });

  it("reste active tant que until n'est pas dépassé", () => {
    const target = {
      sequenceKey: "INSPECTION:veh_1:2026-11-02",
      customerId: "c1",
      type: "INSPECTION" as const,
    };
    const suppressions = [
      { sequenceKey: target.sequenceKey, until: new Date("2026-10-20T00:00:00Z") },
    ];
    expect(isSuppressed(target, suppressions, now)).toBe(true);
  });

  it("renvoie false sans suppression correspondante", () => {
    const target = { sequenceKey: "X", customerId: "c1", type: "INSPECTION" as const };
    expect(isSuppressed(target, [], now)).toBe(false);
  });
});

describe("assertValidSuppressionScope (RG-M10-21)", () => {
  it("accepte une portée par sequenceKey", () => {
    expect(() => assertValidSuppressionScope({ sequenceKey: "X" })).not.toThrow();
  });

  it("accepte une portée par (customerId, type) ou (vehicleId, type)", () => {
    expect(() =>
      assertValidSuppressionScope({ customerId: "c1", type: "INSPECTION" }),
    ).not.toThrow();
    expect(() => assertValidSuppressionScope({ vehicleId: "v1", type: "SERVICE" })).not.toThrow();
  });

  it("rejette une portée incomplète (type seul, ou rien)", () => {
    expect(() => assertValidSuppressionScope({ type: "INSPECTION" })).toThrow();
    expect(() => assertValidSuppressionScope({})).toThrow();
  });
});

describe("constructeurs de suppression (RG-M10-22)", () => {
  it("appointment.created / repair_order.created : INSPECTION/SERVICE/QUOTE_FOLLOWUP jusqu'à startsAt + 1 j", () => {
    const startsAt = new Date("2026-10-24T09:00:00Z");
    const result = buildAppointmentSuppressions({
      vehicleId: "v1",
      startsAt,
      source: "appointment",
    });
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.type).sort()).toEqual(["INSPECTION", "QUOTE_FOLLOWUP", "SERVICE"]);
    for (const r of result) {
      expect(r.vehicleId).toBe("v1");
      expect(r.until?.toISOString()).toBe("2026-10-25T09:00:00.000Z");
    }
  });

  it("vehicle.inspection_updated / vehicle.service_recorded : suppression permanente de l'ancienne séquence", () => {
    const result = buildAnchorChangedSuppression("INSPECTION:veh_1:2026-11-02");
    expect(result).toEqual({ sequenceKey: "INSPECTION:veh_1:2026-11-02", until: null });
  });

  it("vehicle.owner_changed : suppression permanente (véhicule, type) pour l'ancien propriétaire", () => {
    expect(buildOwnerChangedSuppression("v1", "INSPECTION")).toEqual({
      vehicleId: "v1",
      type: "INSPECTION",
      until: null,
    });
  });

  it("Arrêter la séquence : suppression permanente par sequenceKey", () => {
    expect(buildStopSequenceSuppression("RECEIVABLE:case_1")).toEqual({
      sequenceKey: "RECEIVABLE:case_1",
      until: null,
    });
  });

  it("réponse entrante : pause 48 h par défaut", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    const result = buildReplyPauseSuppression("X", now);
    expect(result.until?.toISOString()).toBe("2026-10-21T10:00:00.000Z");
  });

  it("réponse entrante : durée de pause personnalisable (settings.reminders.pauseOnReplyHours)", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    const result = buildReplyPauseSuppression("X", now, 24);
    expect(result.until?.toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });
});

describe("liftSuppressionsForSequence (RG-M10-22 — annulation/NO_SHOW)", () => {
  it("retire les suppressions de la séquence concernée, laisse les autres intactes", () => {
    const suppressions = [
      { sequenceKey: "A", until: null },
      { sequenceKey: "B", until: null },
    ];
    expect(liftSuppressionsForSequence(suppressions, "A")).toEqual([
      { sequenceKey: "B", until: null },
    ]);
  });
});
