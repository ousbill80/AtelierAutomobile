import { describe, expect, it } from "vitest";
import {
  revalidateAppointment,
  revalidateBeforeSend,
  revalidateClient,
  revalidateInspection,
  revalidateQuoteFollowup,
  revalidateReceivable,
  revalidateService,
  revalidateVehicleReady,
  type RevalidateClientInput,
} from "./revalidate";

function okClient(overrides: Partial<RevalidateClientInput> = {}): RevalidateClientInput {
  return {
    deletedAt: null,
    remindersConsent: true,
    doNotRemind: false,
    isOptedOut: false,
    hasActiveSuppression: false,
    isTransactional: false,
    ...overrides,
  };
}

describe("revalidateClient (RG-M10-24.1)", () => {
  it("ok si rien à signaler", () => {
    expect(revalidateClient(okClient())).toEqual({ ok: true });
  });

  it("annule si le client est supprimé", () => {
    const result = revalidateClient(okClient({ deletedAt: new Date("2026-10-01") }));
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });

  it("annule si doNotRemind (non transactionnel)", () => {
    const result = revalidateClient(okClient({ doNotRemind: true }));
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });

  it("annule si le consentement est retiré (non transactionnel)", () => {
    const result = revalidateClient(okClient({ remindersConsent: false }));
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });

  it("annule si l'adresse est en OptOut (non transactionnel)", () => {
    const result = revalidateClient(okClient({ isOptedOut: true }));
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });

  it("annule si une suppression est active", () => {
    const result = revalidateClient(okClient({ hasActiveSuppression: true }));
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });

  it("un type transactionnel ignore doNotRemind/consentement/OptOut", () => {
    const result = revalidateClient(
      okClient({
        isTransactional: true,
        doNotRemind: true,
        remindersConsent: false,
        isOptedOut: true,
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("un type transactionnel reste bloqué par une suppression active ou un client supprimé", () => {
    expect(
      revalidateClient(okClient({ isTransactional: true, hasActiveSuppression: true })).ok,
    ).toBe(false);
    expect(
      revalidateClient(okClient({ isTransactional: true, deletedAt: new Date("2026-01-01") })).ok,
    ).toBe(false);
  });
});

describe("revalidateInspection (RG-M10-24.2)", () => {
  const anchor = new Date("2026-11-02");

  it("ok si l'ancre, le propriétaire et l'absence de RDV/OR sont inchangés", () => {
    expect(
      revalidateInspection({
        plannedInspectionExpiryDate: anchor,
        currentInspectionExpiryDate: anchor,
        vehicleStillOwnedByCustomer: true,
        hasOpenAppointmentOrRepairOrderSinceAnchor: false,
      }),
    ).toEqual({ ok: true });
  });

  it("annule si la date de VT a changé depuis la planification", () => {
    const result = revalidateInspection({
      plannedInspectionExpiryDate: anchor,
      currentInspectionExpiryDate: new Date("2026-12-01"),
      vehicleStillOwnedByCustomer: true,
      hasOpenAppointmentOrRepairOrderSinceAnchor: false,
    });
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });

  it("annule si le véhicule a changé de propriétaire", () => {
    const result = revalidateInspection({
      plannedInspectionExpiryDate: anchor,
      currentInspectionExpiryDate: anchor,
      vehicleStillOwnedByCustomer: false,
      hasOpenAppointmentOrRepairOrderSinceAnchor: false,
    });
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });

  it("annule si un RDV ou un OR est déjà ouvert depuis la planification", () => {
    const result = revalidateInspection({
      plannedInspectionExpiryDate: anchor,
      currentInspectionExpiryDate: anchor,
      vehicleStillOwnedByCustomer: true,
      hasOpenAppointmentOrRepairOrderSinceAnchor: true,
    });
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });
});

describe("revalidateService (RG-M10-24.3)", () => {
  it("ok si l'échéance recalculée est identique à ± 3 j", () => {
    expect(
      revalidateService({
        plannedServiceDueDate: new Date("2026-11-02"),
        currentServiceDueDate: new Date("2026-11-04"),
      }),
    ).toEqual({ ok: true });
  });

  it("annule si l'échéance recalculée dépasse la tolérance de 3 j", () => {
    const result = revalidateService({
      plannedServiceDueDate: new Date("2026-11-02"),
      currentServiceDueDate: new Date("2026-11-10"),
    });
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });

  it("annule si l'échéance recalculée est introuvable", () => {
    const result = revalidateService({
      plannedServiceDueDate: new Date("2026-11-02"),
      currentServiceDueDate: null,
    });
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });
});

describe("revalidateReceivable (RG-M10-24.4)", () => {
  const now = new Date("2026-10-19T10:00:00Z");
  function base() {
    return {
      currentBalance: 185_000,
      minAmount: 2000,
      caseStatus: "OPEN" as const,
      hasPendingPaymentWithinTwoHours: false,
      hasUnallocatedPaymentOrCredit: false,
      dataFreshnessOk: true,
      now,
    };
  }

  it("ok si le solde reste dû et le dossier ouvert", () => {
    expect(revalidateReceivable(base())).toEqual({ ok: true });
  });

  it("annule si la facture est déjà réglée (solde sous le seuil)", () => {
    const result = revalidateReceivable({ ...base(), currentBalance: 0 });
    expect(result).toMatchObject({
      ok: false,
      outcome: "CANCELLED",
      reason: expect.stringContaining("réglée"),
    });
  });

  it("annule si le dossier n'est plus OPEN/ESCALATED (ex. DISPUTED, PROMISED, CLOSED)", () => {
    expect(revalidateReceivable({ ...base(), caseStatus: "DISPUTED" })).toMatchObject({
      ok: false,
      outcome: "CANCELLED",
    });
    expect(revalidateReceivable({ ...base(), caseStatus: "CLOSED" })).toMatchObject({
      ok: false,
      outcome: "CANCELLED",
    });
  });

  it("accepte ESCALATED comme statut valide", () => {
    expect(revalidateReceivable({ ...base(), caseStatus: "ESCALATED" })).toEqual({ ok: true });
  });

  it("annule si un paiement non affecté ou un avoir couvre le retard", () => {
    const result = revalidateReceivable({ ...base(), hasUnallocatedPaymentOrCredit: true });
    expect(result).toMatchObject({
      ok: false,
      outcome: "CANCELLED",
      reason: expect.stringContaining("non affecté"),
    });
  });

  it("replanifie (+2h) si un paiement est en attente, sans annuler", () => {
    const result = revalidateReceivable({ ...base(), hasPendingPaymentWithinTwoHours: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("RESCHEDULED");
      if (result.outcome === "RESCHEDULED") {
        expect(result.retryAt.getTime()).toBe(now.getTime() + 2 * 60 * 60 * 1000);
      }
    }
  });

  it("annule si les données sont trop anciennes en mode Relances seules", () => {
    const result = revalidateReceivable({ ...base(), dataFreshnessOk: false });
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });
});

describe("revalidateAppointment (RG-M10-24.5)", () => {
  const startsAt = new Date("2026-10-20T09:00:00Z");

  it("ok si le RDV est toujours BOOKED/CONFIRMED à l'heure prévue", () => {
    expect(
      revalidateAppointment({
        status: "BOOKED",
        plannedStartsAt: startsAt,
        currentStartsAt: startsAt,
      }),
    ).toEqual({ ok: true });
  });

  it("annule si le RDV est annulé ou passé en NO_SHOW", () => {
    expect(
      revalidateAppointment({
        status: "CANCELLED",
        plannedStartsAt: startsAt,
        currentStartsAt: startsAt,
      }),
    ).toMatchObject({ ok: false, outcome: "CANCELLED" });
    expect(
      revalidateAppointment({
        status: "NO_SHOW",
        plannedStartsAt: startsAt,
        currentStartsAt: startsAt,
      }),
    ).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });

  it("annule si l'horaire a changé depuis la planification", () => {
    const result = revalidateAppointment({
      status: "CONFIRMED",
      plannedStartsAt: startsAt,
      currentStartsAt: new Date("2026-10-21T09:00:00Z"),
    });
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });
});

describe("revalidateQuoteFollowup (RG-M10-24.6)", () => {
  it("ok si le devis est toujours SENT ou VIEWED", () => {
    expect(revalidateQuoteFollowup({ status: "SENT" })).toEqual({ ok: true });
    expect(revalidateQuoteFollowup({ status: "VIEWED" })).toEqual({ ok: true });
  });

  it("annule si le devis a été accepté, refusé ou a expiré", () => {
    expect(revalidateQuoteFollowup({ status: "ACCEPTED" })).toMatchObject({
      ok: false,
      outcome: "CANCELLED",
    });
    expect(revalidateQuoteFollowup({ status: "DECLINED" })).toMatchObject({
      ok: false,
      outcome: "CANCELLED",
    });
    expect(revalidateQuoteFollowup({ status: "EXPIRED" })).toMatchObject({
      ok: false,
      outcome: "CANCELLED",
    });
  });
});

describe("revalidateVehicleReady (RG-M10-24.7)", () => {
  it("ok si l'OR est toujours READY", () => {
    expect(revalidateVehicleReady({ repairOrderStatus: "READY" })).toEqual({ ok: true });
  });

  it("annule si l'OR n'est plus READY (ex. déjà facturé/récupéré)", () => {
    expect(revalidateVehicleReady({ repairOrderStatus: "INVOICED" })).toMatchObject({
      ok: false,
      outcome: "CANCELLED",
    });
  });
});

describe("revalidateBeforeSend (dispatcher)", () => {
  it("renvoie l'échec client sans évaluer le motif du type", () => {
    const result = revalidateBeforeSend(okClient({ deletedAt: new Date("2026-01-01") }), {
      type: "VEHICLE_READY",
      data: { repairOrderStatus: "READY" },
    });
    expect(result).toMatchObject({
      ok: false,
      outcome: "CANCELLED",
      reason: expect.stringContaining("supprimé"),
    });
  });

  it("délègue au motif spécifique du type quand le client est ok", () => {
    const result = revalidateBeforeSend(okClient(), {
      type: "QUOTE_FOLLOWUP",
      data: { status: "ACCEPTED" },
    });
    expect(result).toMatchObject({ ok: false, outcome: "CANCELLED" });
  });

  it("INSURANCE_EXPIRY et SATISFACTION n'ont pas de motif spécifique au-delà du client", () => {
    expect(revalidateBeforeSend(okClient(), { type: "INSURANCE_EXPIRY" })).toEqual({ ok: true });
    expect(revalidateBeforeSend(okClient(), { type: "SATISFACTION" })).toEqual({ ok: true });
  });
});
