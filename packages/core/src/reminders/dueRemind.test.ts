import { describe, expect, it } from "vitest";
import { countDueMessages, dueRemindEligibility, groupDueByCustomer } from "./dueRemind";

const now = new Date("2026-11-03T10:00:00Z");
const base = {
  dueDate: new Date("2026-11-20T00:00:00Z"),
  doNotRemind: false,
  remindersConsent: true,
  addresses: { WHATSAPP: "+2250701454504", SMS: "+2250701454504", EMAIL: null },
  lastSentAt: null,
  hasPendingDue: false,
  now,
};

describe("dueRemindEligibility", () => {
  it("véhicule avec échéance et téléphone : relançable par WhatsApp et SMS", () => {
    expect(dueRemindEligibility(base)).toEqual({ eligible: true, reachable: ["WHATSAPP", "SMS"] });
  });

  it("refuse sans date d'échéance, client « ne plus relancer » ou sans consentement", () => {
    expect(dueRemindEligibility({ ...base, dueDate: null })).toMatchObject({ reason: "NO_DATE" });
    expect(dueRemindEligibility({ ...base, doNotRemind: true })).toMatchObject({
      reason: "DO_NOT_REMIND",
    });
    expect(dueRemindEligibility({ ...base, remindersConsent: false })).toMatchObject({
      reason: "NO_CONSENT",
    });
  });

  it("refuse sans aucun contact", () => {
    expect(
      dueRemindEligibility({ ...base, addresses: { WHATSAPP: null, SMS: null, EMAIL: null } }),
    ).toMatchObject({ reason: "NO_CONTACT" });
  });

  it("anti-doublon : relance en attente ou envoyée il y a moins de 20 h", () => {
    expect(dueRemindEligibility({ ...base, hasPendingDue: true })).toMatchObject({
      reason: "ALREADY_PENDING",
    });
    const recent = dueRemindEligibility({
      ...base,
      lastSentAt: new Date("2026-11-03T02:00:00Z"),
    });
    expect(recent).toMatchObject({ eligible: false, reason: "RECENTLY_SENT" });
    expect(
      dueRemindEligibility({ ...base, lastSentAt: new Date("2026-11-02T10:00:00Z") }).eligible,
    ).toBe(true);
  });
});

describe("groupDueByCustomer / countDueMessages", () => {
  const vehicles = [
    { vehicleId: "v1", customerId: "c1", eligible: true, reachable: ["WHATSAPP", "SMS"] as const },
    { vehicleId: "v2", customerId: "c2", eligible: true, reachable: ["EMAIL"] as const },
    { vehicleId: "v3", customerId: "c1", eligible: true, reachable: ["WHATSAPP", "SMS"] as const },
    { vehicleId: "v4", customerId: "c3", eligible: false, reachable: [] as const },
  ];

  it("regroupe les véhicules d'un même client", () => {
    const groups = groupDueByCustomer(vehicles);
    expect(groups.map((g) => [g.customerId, g.vehicles.map((v) => v.vehicleId)])).toEqual([
      ["c1", ["v1", "v3"]],
      ["c2", ["v2"]],
      ["c3", ["v4"]],
    ]);
  });

  it("chaque véhicule a son propre message, même pour un client qui en a plusieurs", () => {
    const groups = groupDueByCustomer(vehicles);
    expect(
      countDueMessages(groups, new Set(["v1", "v2", "v3", "v4"]), new Set(["WHATSAPP"])),
    ).toEqual({ customers: 1, vehicles: 2, messages: 2 });
    expect(
      countDueMessages(groups, new Set(["v1", "v2", "v3"]), new Set(["WHATSAPP", "SMS", "EMAIL"])),
    ).toEqual({ customers: 2, vehicles: 3, messages: 5 });
  });

  it("rien de sélectionné : aucun message", () => {
    expect(countDueMessages(groupDueByCustomer(vehicles), new Set(), new Set(["SMS"]))).toEqual({
      customers: 0,
      vehicles: 0,
      messages: 0,
    });
  });
});
