import { describe, expect, it } from "vitest";
import { deliveryState, isUnconfirmed } from "./delivery";

const base = {
  status: "SENT",
  provider: "orange_sms",
  sentAt: new Date("2026-11-02T08:00:00Z"),
  deliveredAt: null,
  readAt: null,
};

describe("deliveryState", () => {
  it.each([
    [{ status: "QUEUED", sentAt: null }, "pending"],
    [{ status: "SENDING", sentAt: null }, "pending"],
    [{}, "sent"],
    [{ status: "DELIVERED", deliveredAt: new Date() }, "delivered"],
    [{ status: "READ", deliveredAt: new Date(), readAt: new Date() }, "read"],
    // L'horodatage fait foi même si le statut est en retard (webhooks dans le désordre).
    [{ readAt: new Date() }, "read"],
    [{ status: "FAILED" }, "failed"],
    [{ provider: "wa_link" }, "manual"],
    [{ provider: "console" }, "simulated"],
  ] as const)("%o → %s", (patch, expected) => {
    expect(deliveryState({ ...base, ...patch })).toBe(expected);
  });
});

describe("isUnconfirmed", () => {
  const now = new Date("2026-11-02T11:00:00Z");
  it("envoyé il y a 3 h sans accusé : à vérifier", () => {
    expect(isUnconfirmed(base, now)).toBe(true);
  });
  it("envoyé il y a 1 h : pas encore", () => {
    expect(isUnconfirmed({ ...base, sentAt: new Date("2026-11-02T10:00:00Z") }, now)).toBe(false);
  });
  it("reçu, simulé ou à la main : jamais « non confirmé »", () => {
    expect(isUnconfirmed({ ...base, deliveredAt: new Date() }, now)).toBe(false);
    expect(isUnconfirmed({ ...base, provider: "console" }, now)).toBe(false);
    expect(isUnconfirmed({ ...base, provider: "wa_link" }, now)).toBe(false);
  });
});
