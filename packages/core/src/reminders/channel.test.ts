import { describe, expect, it } from "vitest";
import { resolveIndividualRecipient, resolveReminderChannels } from "./channel";

describe("resolveIndividualRecipient", () => {
  it("préfère whatsappPhone à phone", () => {
    expect(
      resolveIndividualRecipient({ whatsappPhone: "+2250700000001", phone: "+2250700000002" }),
    ).toEqual({ address: "+2250700000001", kind: "phone" });
  });

  it("retombe sur phone si whatsappPhone absent", () => {
    expect(resolveIndividualRecipient({ phone: "+2250700000002" })).toEqual({
      address: "+2250700000002",
      kind: "phone",
    });
  });

  it("retombe sur phone2 si phone absent", () => {
    expect(resolveIndividualRecipient({ phone2: "+2250700000003" })).toEqual({
      address: "+2250700000003",
      kind: "phone",
    });
  });

  it("retombe sur email en dernier recours", () => {
    expect(resolveIndividualRecipient({ email: "jean@example.com" })).toEqual({
      address: "jean@example.com",
      kind: "email",
    });
  });

  it("renvoie null si rien n'est disponible", () => {
    expect(resolveIndividualRecipient({})).toBeNull();
  });
});

describe("resolveReminderChannels", () => {
  it("place le canal préféré en tête s'il fait partie des canaux du palier", () => {
    const result = resolveReminderChannels({
      preferredChannel: "SMS",
      stepChannels: ["WHATSAPP", "SMS"],
      hasWhatsapp: true,
      phoneE164: "+2250700000001",
      email: null,
    });
    expect(result).toEqual(["SMS", "WHATSAPP"]);
  });

  it("ignore le canal préféré s'il n'est pas dans les canaux du palier", () => {
    const result = resolveReminderChannels({
      preferredChannel: "EMAIL",
      stepChannels: ["WHATSAPP", "SMS"],
      hasWhatsapp: true,
      phoneE164: "+2250700000001",
      email: "jean@example.com",
    });
    expect(result).toEqual(["WHATSAPP", "SMS"]);
  });

  it("retire WhatsApp si hasWhatsapp est false", () => {
    const result = resolveReminderChannels({
      stepChannels: ["WHATSAPP", "SMS"],
      hasWhatsapp: false,
      phoneE164: "+2250700000001",
      email: null,
    });
    expect(result).toEqual(["SMS"]);
  });

  it("garde WhatsApp candidat si hasWhatsapp est inconnu (null)", () => {
    const result = resolveReminderChannels({
      stepChannels: ["WHATSAPP"],
      hasWhatsapp: null,
      phoneE164: "+2250700000001",
      email: null,
    });
    expect(result).toEqual(["WHATSAPP"]);
  });

  it("retire SMS pour une ligne fixe", () => {
    const result = resolveReminderChannels({
      stepChannels: ["SMS", "WHATSAPP"],
      hasWhatsapp: true,
      phoneE164: "+2252112345678",
      email: null,
    });
    expect(result).toEqual(["WHATSAPP"]);
  });

  it("retire SMS si le crédit est épuisé", () => {
    const result = resolveReminderChannels({
      stepChannels: ["SMS"],
      hasWhatsapp: false,
      phoneE164: "+2250700000001",
      email: null,
      smsCreditExhausted: true,
    });
    expect(result).toEqual([]);
  });

  it("retire email si aucune adresse", () => {
    const result = resolveReminderChannels({
      stepChannels: ["EMAIL"],
      hasWhatsapp: false,
      phoneE164: null,
      email: null,
    });
    expect(result).toEqual([]);
  });

  it("retire un canal déjà en OptOut", () => {
    const result = resolveReminderChannels({
      stepChannels: ["WHATSAPP", "SMS"],
      hasWhatsapp: true,
      phoneE164: "+2250700000001",
      email: null,
      optedOutChannels: ["WHATSAPP"],
    });
    expect(result).toEqual(["SMS"]);
  });

  it("renvoie une liste vide si tous les canaux sont indisponibles", () => {
    const result = resolveReminderChannels({
      stepChannels: ["WHATSAPP", "SMS", "EMAIL"],
      hasWhatsapp: false,
      phoneE164: "+2252112345678",
      email: null,
    });
    expect(result).toEqual([]);
  });
});
