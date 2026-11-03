import { describe, expect, it } from "vitest";
import { channelModes, channelsToSend, remindEligibility } from "./bulk";

describe("channelModes", () => {
  it("classe chaque canal selon ses fournisseurs actifs", () => {
    expect(
      channelModes([
        { channel: "EMAIL", provider: "resend", isActive: true },
        { channel: "EMAIL", provider: "console", isActive: false },
        { channel: "SMS", provider: "console", isActive: true },
        { channel: "SMS", provider: "twilio", isActive: false },
        { channel: "WHATSAPP", provider: "wa_link", isActive: true },
        { channel: "WHATSAPP", provider: "whatsapp_cloud", isActive: false },
      ]),
    ).toEqual({ EMAIL: "auto", SMS: "test", WHATSAPP: "manual_only" });
  });

  it("un fournisseur en erreur ne compte pas ; aucun fournisseur → off", () => {
    expect(
      channelModes([{ channel: "SMS", provider: "orange_sms", isActive: true, status: "ERROR" }]),
    ).toEqual({ EMAIL: "off", SMS: "off", WHATSAPP: "off" });
  });

  it("un fournisseur réel l'emporte sur console et wa_link", () => {
    expect(
      channelModes([
        { channel: "WHATSAPP", provider: "wa_link", isActive: true },
        { channel: "WHATSAPP", provider: "whatsapp_cloud", isActive: true },
      ]).WHATSAPP,
    ).toBe("auto");
  });
});

describe("remindEligibility", () => {
  const now = new Date("2026-11-02T10:00:00Z");
  const base = {
    caseStatus: "OPEN",
    overdueDue: 179_360,
    doNotRemind: false,
    addresses: { SMS: "+2250501020662", WHATSAPP: "+2250501020662", EMAIL: "a@b.ci" },
    lastSentAt: null,
    hasPendingDue: false,
    now,
  };

  it("éligible : canaux joignables", () => {
    expect(remindEligibility(base)).toEqual({
      eligible: true,
      reachable: ["WHATSAPP", "SMS", "EMAIL"],
    });
    expect(remindEligibility({ ...base, addresses: { EMAIL: "a@b.ci" } })).toEqual({
      eligible: true,
      reachable: ["EMAIL"],
    });
  });

  it.each([
    [{ caseStatus: "DISPUTED" }, "CASE_DISPUTED"],
    [{ caseStatus: "PAUSED" }, "CASE_PAUSED"],
    [{ caseStatus: "CLOSED_PAID" }, "CASE_CLOSED"],
    [{ overdueDue: 0 }, "NOTHING_OVERDUE"],
    [{ doNotRemind: true }, "DO_NOT_REMIND"],
    [{ addresses: {} }, "NO_CONTACT"],
    [{ hasPendingDue: true }, "ALREADY_PENDING"],
  ] as const)("%o → %s", (patch, reason) => {
    expect(remindEligibility({ ...base, ...patch })).toMatchObject({ eligible: false, reason });
  });

  it("relancé il y a 2 h : bloqué avec l'heure de déblocage", () => {
    expect(remindEligibility({ ...base, lastSentAt: new Date("2026-11-02T08:00:00Z") })).toEqual({
      eligible: false,
      reason: "RECENTLY_SENT",
      nextAllowedAt: new Date("2026-11-03T04:00:00Z"),
    });
  });
});

describe("channelsToSend", () => {
  const modes = { WHATSAPP: "manual_only", SMS: "test", EMAIL: "auto" } as const;
  it("garde seulement les canaux demandés, joignables et envoyables", () => {
    expect(
      channelsToSend(["WHATSAPP", "SMS", "EMAIL"], ["WHATSAPP", "SMS", "EMAIL"], modes),
    ).toEqual(["SMS", "EMAIL"]);
    expect(channelsToSend(["EMAIL"], ["SMS"], modes)).toEqual([]);
  });
});
