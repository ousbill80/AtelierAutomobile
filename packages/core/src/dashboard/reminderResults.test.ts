import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock";
import {
  computeReminderResults,
  computeReturnRate,
  weeklySends,
  type ReminderFactLike,
} from "./reminderResults";

const at = (s: string) => new Date(s);
const FROM = at("2026-10-01T00:00:00Z");
const TO = at("2026-11-01T00:00:00Z");

function fact(partial: Partial<ReminderFactLike>): ReminderFactLike {
  return {
    type: "INSPECTION",
    status: "SENT",
    sentAt: at("2026-10-03T09:00:00Z"),
    messageStatus: "SENT",
    outcome: null,
    outcomeAt: null,
    attributedAmount: null,
    attributedRevenue: null,
    customerId: "c1",
    vehicleId: "v1",
    dueDate: at("2026-10-20T00:00:00Z"),
    ...partial,
  };
}

describe("résultats des relances", () => {
  it("compte envoyés / délivrés / lus / échecs sur la période", () => {
    const r = computeReminderResults(
      [
        fact({ messageStatus: "DELIVERED" }),
        fact({ messageStatus: "READ", type: "SERVICE" }),
        fact({ messageStatus: "SENT" }),
        fact({ sentAt: at("2026-09-30T23:59:59Z") }), // hors période
        fact({ status: "FAILED", sentAt: null, outcomeAt: at("2026-10-05T00:00:00Z") }),
      ],
      FROM,
      TO,
    );
    expect(r).toMatchObject({ sent: 3, delivered: 2, read: 1, failed: 1 });
    expect(r.sentByType).toEqual({ INSPECTION: 2, SERVICE: 1 });
  });

  it("US-M12-06 : relance créance payée → montant récupéré ; CA des retours séparé", () => {
    const r = computeReminderResults(
      [
        fact({
          type: "RECEIVABLE",
          outcome: "PAID",
          outcomeAt: at("2026-10-06T10:00:00Z"),
          attributedAmount: 185_000,
          customerId: "c1",
        }),
        fact({
          type: "RECEIVABLE",
          outcome: "PARTIALLY_PAID",
          outcomeAt: at("2026-10-08T10:00:00Z"),
          attributedAmount: 600_000,
          customerId: "c2",
        }),
        fact({
          outcome: "APPOINTMENT_BOOKED",
          outcomeAt: at("2026-10-10T00:00:00Z"),
          attributedRevenue: 45_000,
          customerId: "c3",
        }),
        fact({ outcome: "VISITED", outcomeAt: at("2026-10-11T00:00:00Z"), customerId: "c3" }),
        fact({
          type: "RECEIVABLE",
          outcome: "PAID",
          outcomeAt: at("2026-11-02T00:00:00Z"),
          attributedAmount: 1,
        }),
      ],
      FROM,
      TO,
    );
    expect(r.recoveredAmount).toBe(785_000);
    expect(r.generatedRevenue).toBe(45_000);
    expect(r.returnedCustomers).toBe(1);
  });

  it("envois par semaine (lundi)", () => {
    const weeks = weeklySends(
      [
        fact({ sentAt: at("2026-10-05T09:00:00Z") }), // lundi
        fact({ sentAt: at("2026-10-11T09:00:00Z"), type: "SERVICE" }), // dimanche même semaine
        fact({ sentAt: at("2026-10-12T09:00:00Z") }),
      ],
      FROM,
      TO,
    );
    expect(weeks).toEqual([
      { weekStart: "2026-10-05", byType: { INSPECTION: 1, SERVICE: 1 }, total: 2 },
      { weekStart: "2026-10-12", byType: { INSPECTION: 1 }, total: 1 },
    ]);
  });
});

describe("taux de retour VT / révision (RG-M12-24)", () => {
  const now = fixedClock(at("2026-11-25T00:00:00Z")).now();

  it("retour entre la 1re relance et dueDate + 30 j ; échéances en cours exclues", () => {
    const rate = computeReturnRate(
      [
        // v1 : J-30 et J0 envoyés, retour 5 j après échéance → retour
        fact({
          vehicleId: "v1",
          sentAt: at("2026-09-20T09:00:00Z"),
          dueDate: at("2026-10-05T00:00:00Z"),
        }),
        fact({
          vehicleId: "v1",
          dueDate: at("2026-10-05T00:00:00Z"),
          outcome: "APPOINTMENT_BOOKED",
          outcomeAt: at("2026-10-10T00:00:00Z"),
        }),
        // v2 : jamais revenu, délai de grâce écoulé → non-retour
        fact({ vehicleId: "v2", dueDate: at("2026-10-10T00:00:00Z") }),
        // v3 : échéance le 30/10, grâce jusqu'au 29/11 → en cours
        fact({ vehicleId: "v3", dueDate: at("2026-10-30T00:00:00Z") }),
        // v4 : relance non envoyée → hors cohorte
        fact({ vehicleId: "v4", status: "PLANNED", sentAt: null }),
        // v5 : retour après le délai de grâce → non-retour
        fact({
          vehicleId: "v5",
          dueDate: at("2026-10-01T00:00:00Z"),
          outcome: "VISITED",
          outcomeAt: at("2026-11-05T00:00:00Z"),
        }),
      ],
      "INSPECTION",
      FROM,
      TO,
      now,
    );
    expect(rate).toEqual({ cohort: 4, returned: 1, pending: 1, rate: 1 / 3 });
  });

  it("cohorte vide → taux null", () => {
    expect(computeReturnRate([], "SERVICE", FROM, TO, now).rate).toBeNull();
  });
});
