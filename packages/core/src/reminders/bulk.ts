// Relance des créances depuis l'écran Créances (un client ou tous ceux à relancer) : choix des
// canaux par l'utilisateur, éligibilité de chaque dossier. Fonctions pures, sans horloge.
import { checkManualReminder } from "./manual";

export type ReminderChannel = "WHATSAPP" | "SMS" | "EMAIL";
export const REMINDER_CHANNELS: readonly ReminderChannel[] = ["WHATSAPP", "SMS", "EMAIL"];

/**
 * Mode d'un canal pour un envoi automatique :
 * - `auto` : fournisseur réel actif (le message part vraiment) ;
 * - `test` : fournisseur `console` (simulation, rien ne quitte le serveur) ;
 * - `manual_only` : WhatsApp en mode lien (`wa_link`), envoi humain un par un ;
 * - `off` : aucun fournisseur actif.
 */
export type ChannelMode = "auto" | "test" | "manual_only" | "off";

export interface ChannelConfigLike {
  channel: string;
  provider: string;
  isActive: boolean;
  status?: string | null;
}

export function channelModes(
  configs: readonly ChannelConfigLike[],
): Record<ReminderChannel, ChannelMode> {
  const result = {} as Record<ReminderChannel, ChannelMode>;
  for (const channel of REMINDER_CHANNELS) {
    const active = configs.filter(
      (c) => c.channel === channel && c.isActive && c.status !== "ERROR",
    );
    if (active.some((c) => c.provider !== "console" && c.provider !== "wa_link")) {
      result[channel] = "auto";
    } else if (active.some((c) => c.provider === "console")) {
      result[channel] = "test";
    } else if (active.some((c) => c.provider === "wa_link")) {
      result[channel] = "manual_only";
    } else {
      result[channel] = "off";
    }
  }
  return result;
}

export function canSendAutomatically(mode: ChannelMode): boolean {
  return mode === "auto" || mode === "test";
}

export type RemindBlockReason =
  | "CASE_DISPUTED"
  | "CASE_PAUSED"
  | "CASE_CLOSED"
  | "NOTHING_OVERDUE"
  | "DO_NOT_REMIND"
  | "NO_CONTACT"
  | "ALREADY_PENDING"
  | "RECENTLY_SENT";

export interface RemindEligibilityInput {
  caseStatus: string;
  overdueDue: number;
  doNotRemind: boolean;
  /** Adresse utilisable par canal (téléphone mobile pour WhatsApp/SMS, email). */
  addresses: Partial<Record<ReminderChannel, string | null>>;
  lastSentAt: Date | null;
  hasPendingDue: boolean;
  now: Date;
}

export type RemindEligibility =
  | { eligible: true; reachable: ReminderChannel[] }
  | { eligible: false; reason: RemindBlockReason; nextAllowedAt?: Date };

export function remindEligibility(input: RemindEligibilityInput): RemindEligibility {
  if (input.caseStatus === "DISPUTED") return { eligible: false, reason: "CASE_DISPUTED" };
  if (input.caseStatus === "PAUSED") return { eligible: false, reason: "CASE_PAUSED" };
  if (!["OPEN", "PROMISED", "ESCALATED"].includes(input.caseStatus)) {
    return { eligible: false, reason: "CASE_CLOSED" };
  }
  if (input.overdueDue <= 0) return { eligible: false, reason: "NOTHING_OVERDUE" };
  if (input.doNotRemind) return { eligible: false, reason: "DO_NOT_REMIND" };
  const reachable = REMINDER_CHANNELS.filter((channel) => !!input.addresses[channel]);
  if (reachable.length === 0) return { eligible: false, reason: "NO_CONTACT" };
  const check = checkManualReminder({
    now: input.now,
    lastSentAt: input.lastSentAt,
    hasPendingDue: input.hasPendingDue,
  });
  if (!check.allowed) {
    return check.reason === "RECENTLY_SENT"
      ? { eligible: false, reason: "RECENTLY_SENT", nextAllowedAt: check.nextAllowedAt }
      : { eligible: false, reason: "ALREADY_PENDING" };
  }
  return { eligible: true, reachable };
}

/** Canaux réellement utilisés : demandés ∩ joignables ∩ envoyables automatiquement. */
export function channelsToSend(
  requested: readonly ReminderChannel[],
  reachable: readonly ReminderChannel[],
  modes: Record<ReminderChannel, ChannelMode>,
): ReminderChannel[] {
  return REMINDER_CHANNELS.filter(
    (channel) =>
      requested.includes(channel) &&
      reachable.includes(channel) &&
      canSendAutomatically(modes[channel]),
  );
}
