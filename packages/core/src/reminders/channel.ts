import { classifyPhoneCI } from "../phone";
import type { ReminderChannel } from "./types";

// ───────────────────────── RG-M10-11 — destinataire ─────────────────────────

export interface IndividualRecipientInput {
  whatsappPhone?: string | null;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
}

export interface ResolvedRecipient {
  address: string;
  kind: "phone" | "email";
}

/** RG-M10-11 — `INDIVIDUAL` : `whatsappPhone ?? phone`, sinon `phone2`, sinon `email`. */
export function resolveIndividualRecipient(
  input: IndividualRecipientInput,
): ResolvedRecipient | null {
  const phone = input.whatsappPhone ?? input.phone;
  if (phone) return { address: phone, kind: "phone" };
  if (input.phone2) return { address: input.phone2, kind: "phone" };
  if (input.email) return { address: input.email, kind: "email" };
  return null;
}

// ───────────────────────── RG-M10-12 — ordre des canaux ─────────────────────────

export interface ResolveChannelsInput {
  preferredChannel?: ReminderChannel | null;
  stepChannels: readonly ReminderChannel[];
  /** `null` = inconnu (détecté au premier envoi) : le canal WhatsApp reste candidat. */
  hasWhatsapp: boolean | null;
  phoneE164: string | null;
  email: string | null;
  /** Canaux déjà en `OptOut` pour cette adresse. */
  optedOutChannels?: readonly ReminderChannel[];
  smsCreditExhausted?: boolean;
}

/**
 * RG-M10-12 — ordonne les canaux candidats : `preferredChannel` d'abord s'il fait partie de
 * `step.channels`, puis l'ordre de `step.channels`, en retirant WhatsApp (pas de numéro, ou
 * `hasWhatsapp === false`), SMS (pas de numéro, numéro fixe, crédit épuisé), email (pas
 * d'adresse), et tout canal déjà en liste d'exclusion (`OptOut`) pour cette adresse.
 */
export function resolveReminderChannels(input: ResolveChannelsInput): ReminderChannel[] {
  const optedOut = input.optedOutChannels ?? [];
  const ordered =
    input.preferredChannel && input.stepChannels.includes(input.preferredChannel)
      ? [input.preferredChannel, ...input.stepChannels.filter((c) => c !== input.preferredChannel)]
      : [...input.stepChannels];

  return ordered.filter((channel) => {
    if (optedOut.includes(channel)) return false;

    if (channel === "WHATSAPP") {
      if (input.hasWhatsapp === false) return false;
      if (!input.phoneE164) return false;
      return true;
    }

    if (channel === "SMS") {
      if (!input.phoneE164) return false;
      if (classifyPhoneCI(input.phoneE164) === "FIXED") return false;
      if (input.smsCreditExhausted) return false;
      return true;
    }

    // EMAIL
    return Boolean(input.email);
  });
}
