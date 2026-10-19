// RG-M11-01 (premier canal disponible) et RG-M11-02 (3, 5 : bascule canal suivant)

export type Channel = "WHATSAPP" | "SMS" | "EMAIL";

export interface ChannelCandidate {
  channel: Channel;
  address: string | null; // null si le client n'a pas d'adresse pour ce canal
  isOptedOut: boolean; // OptOut (canal exact ou global) pour cette adresse
  isAddressInvalid: boolean; // Customer.phoneInvalidAt / emailInvalidAt pour ce numéro/adresse
  isChannelActive: boolean; // ChannelConfig.isActive && status !== "ERROR"
  hasApprovedTemplate?: boolean; // WHATSAPP hors fenêtre 24 h (RG-M11-10) : modèle approuvé requis
}

export interface PickChannelInput {
  candidates: ChannelCandidate[]; // ordre de préférence (repli)
  forcedChannel?: Channel; // envoi manuel ad hoc sur un canal précis (messaging.send)
}

export type PickChannelResult = { channel: Channel; address: string } | { channel: null };

export function pickChannel(input: PickChannelInput): PickChannelResult {
  const list = input.forcedChannel
    ? input.candidates.filter((c) => c.channel === input.forcedChannel)
    : input.candidates;
  for (const candidate of list) {
    if (!candidate.address) continue;
    if (candidate.isOptedOut) continue;
    if (candidate.isAddressInvalid) continue;
    if (!candidate.isChannelActive) continue;
    if (candidate.channel === "WHATSAPP" && candidate.hasApprovedTemplate === false) continue;
    return { channel: candidate.channel, address: candidate.address };
  }
  return { channel: null };
}
