import { describe, expect, it } from "vitest";
import { pickChannel, type ChannelCandidate } from "./channel";

function candidate(
  overrides: Partial<ChannelCandidate> & { channel: ChannelCandidate["channel"] },
): ChannelCandidate {
  return {
    address: "+2250747218890",
    isOptedOut: false,
    isAddressInvalid: false,
    isChannelActive: true,
    ...overrides,
  };
}

describe("pickChannel", () => {
  it("choisit le premier canal disponible dans l'ordre de préférence", () => {
    const result = pickChannel({
      candidates: [candidate({ channel: "WHATSAPP" }), candidate({ channel: "SMS" })],
    });
    expect(result).toEqual({ channel: "WHATSAPP", address: "+2250747218890" });
  });

  it("passe au canal suivant si le client est désinscrit (OptOut) de WhatsApp", () => {
    const result = pickChannel({
      candidates: [
        candidate({ channel: "WHATSAPP", isOptedOut: true }),
        candidate({ channel: "SMS" }),
      ],
    });
    expect(result).toEqual({ channel: "SMS", address: "+2250747218890" });
  });

  it("passe au canal suivant si l'adresse est invalide", () => {
    const result = pickChannel({
      candidates: [
        candidate({ channel: "WHATSAPP", isAddressInvalid: true }),
        candidate({ channel: "SMS" }),
      ],
    });
    expect(result).toEqual({ channel: "SMS", address: "+2250747218890" });
  });

  it("passe au canal suivant si le canal est inactif ou en erreur", () => {
    const result = pickChannel({
      candidates: [
        candidate({ channel: "WHATSAPP", isChannelActive: false }),
        candidate({ channel: "SMS" }),
      ],
    });
    expect(result).toEqual({ channel: "SMS", address: "+2250747218890" });
  });

  it("ignore un canal WhatsApp sans modèle approuvé hors fenêtre 24 h", () => {
    const result = pickChannel({
      candidates: [
        candidate({ channel: "WHATSAPP", hasApprovedTemplate: false }),
        candidate({ channel: "SMS" }),
      ],
    });
    expect(result).toEqual({ channel: "SMS", address: "+2250747218890" });
  });

  it("force un canal précis (envoi manuel) même s'il n'est pas en tête de liste", () => {
    const result = pickChannel({
      candidates: [candidate({ channel: "WHATSAPP" }), candidate({ channel: "EMAIL" })],
      forcedChannel: "EMAIL",
    });
    expect(result).toEqual({ channel: "EMAIL", address: "+2250747218890" });
  });

  it("renvoie null si aucun canal n'est disponible", () => {
    const result = pickChannel({
      candidates: [
        candidate({ channel: "WHATSAPP", isOptedOut: true }),
        candidate({ channel: "SMS", address: null }),
      ],
    });
    expect(result).toEqual({ channel: null });
  });
});
