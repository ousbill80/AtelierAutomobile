// RG-M17-16 — meilleur moment et meilleur canal d'envoi (déterministe + statistiques, sans IA).
// Par client, à partir de ses messages sortants des 12 derniers mois : taux de lecture par
// créneau de 2 h et par canal. Le décalage d'une relance reste dans la fenêtre d'envoi de la
// règle, ne la retarde jamais de plus de 12 h et ne l'avance jamais.
import { isWithinSendWindow } from "../messaging/sendWindow";
import { localDateKey, localMinutes, zonedInstant } from "../planning/time";

export type SendChannel = "WHATSAPP" | "SMS" | "EMAIL";

export interface OutboundStat {
  channel: SendChannel;
  sentAt: Date;
  /** Lu (accusé de lecture) ou relance au résultat positif (RDV, paiement, promesse). */
  positive: boolean;
}

export interface SendPreference {
  /** Heure locale de début du créneau de 2 h préféré, ou null si pas assez de données. */
  bestHour: number | null;
  bestChannel: SendChannel | null;
}

export const MIN_MESSAGES_FOR_SLOT = 5;
export const MIN_SENDS_FOR_CHANNEL = 3;
export const SLOT_LIFT = 1.5;
export const MAX_SHIFT_HOURS = 12;

/**
 * Créneau préféré : si ≥ 5 messages et qu'un créneau de 2 h (glissant, à l'heure pleine) a un
 * taux positif ≥ 1,5 × la moyenne du client ; canal préféré : meilleur taux avec ≥ 3 envois.
 */
export function learnSendPreference(
  stats: readonly OutboundStat[],
  timeZone: string,
  now: Date,
): SendPreference {
  const since = now.getTime() - 365 * 24 * 60 * 60 * 1000;
  const recent = stats.filter((s) => s.sentAt.getTime() >= since);
  let bestHour: number | null = null;
  if (recent.length >= MIN_MESSAGES_FOR_SLOT) {
    const average = recent.filter((s) => s.positive).length / recent.length;
    const hours = recent.map((s) => Math.floor(localMinutes(s.sentAt, timeZone) / 60));
    // Meilleur taux ; à taux égal, le créneau qui couvre le plus de lectures, puis le plus tôt.
    let best = { rate: 0, positives: 0 };
    for (let h = 0; h < 24; h++) {
      const inSlot = recent.filter((_, i) => hours[i] === h || hours[i] === (h + 1) % 24);
      if (!inSlot.length) continue;
      const positives = inSlot.filter((s) => s.positive).length;
      const rate = positives / inSlot.length;
      if (average === 0 || rate < SLOT_LIFT * average) continue;
      if (rate > best.rate || (rate === best.rate && positives > best.positives)) {
        best = { rate, positives };
        bestHour = h;
      }
    }
  }
  let bestChannel: SendChannel | null = null;
  let bestChannelRate = -1;
  for (const channel of ["WHATSAPP", "SMS", "EMAIL"] as const) {
    const sends = recent.filter((s) => s.channel === channel);
    if (sends.length < MIN_SENDS_FOR_CHANNEL) continue;
    const rate = sends.filter((s) => s.positive).length / sends.length;
    if (rate > bestChannelRate && rate > 0) {
      bestChannelRate = rate;
      bestChannel = channel;
    }
  }
  return { bestHour, bestChannel };
}

export interface OptimizeSendTimeInput {
  scheduledFor: Date;
  bestHour: number;
  timeZone: string;
  sendWindow: { from: string; to: string };
}

/**
 * Heure optimisée le même jour local à `bestHour:00`, ou `null` si le décalage avancerait
 * l'envoi, dépasserait 12 h ou sortirait de la fenêtre d'envoi de la règle.
 */
export function optimizeSendTime(input: OptimizeSendTimeInput): Date | null {
  const day = localDateKey(input.scheduledFor, input.timeZone);
  const candidate = zonedInstant(day, input.bestHour * 60, input.timeZone);
  const delay = candidate.getTime() - input.scheduledFor.getTime();
  if (delay <= 0 || delay > MAX_SHIFT_HOURS * 60 * 60 * 1000) return null;
  if (!isWithinSendWindow(candidate, input.timeZone, input.sendWindow)) return null;
  return candidate;
}

export interface ChannelPreferenceInput {
  /** Canaux du palier, dans l'ordre de la règle M10. */
  stepChannels: readonly SendChannel[];
  /** Choix manuel (`Customer.preferredChannel`) : toujours prioritaire. */
  preferredChannel: SendChannel | null;
  /** Canal appris (`Customer.bestChannel`, RG-M17-16), utilisé si aucun choix manuel. */
  bestChannel: SendChannel | null;
  /** `false` = numéro connu comme non WhatsApp : WhatsApp n'est jamais avancé. */
  hasWhatsapp: boolean | null;
  /** `settings.ai` : optimisation activée (sinon le canal appris est ignoré). */
  useLearned: boolean;
}

/**
 * RG-M17-16 — ordre des canaux à essayer : le canal préféré (manuel, sinon appris) passe en
 * tête s'il fait partie des canaux du palier ; les autres gardent l'ordre de la règle, en repli.
 * L'éligibilité réelle (OptOut, numéro fixe, adresse invalide, canal actif) reste vérifiée
 * juste avant l'envoi par `pickChannel` sur la liste ainsi ordonnée.
 */
export function orderChannelsByPreference(input: ChannelPreferenceInput): SendChannel[] {
  const channels = [...input.stepChannels];
  const preferred = input.preferredChannel ?? (input.useLearned ? input.bestChannel : null);
  if (!preferred || !channels.includes(preferred)) return channels;
  if (preferred === "WHATSAPP" && input.hasWhatsapp === false) return channels;
  return [preferred, ...channels.filter((c) => c !== preferred)];
}
