// RG-M11-05 : déclencheurs de repli vers le canal suivant

export type FallbackSituation =
  | "PERMANENT_ERROR" // numéro non WhatsApp, numéro invalide, modèle non approuvé, adresse email rejetée
  | "TEMPORARY_EXHAUSTED" // retries épuisés (RG-M11-07)
  | "WHATSAPP_UNDELIVERED_TIMEOUT" // SENT sans DELIVERED après fallbackAfterMinutes
  | "SMS_NO_ACK" // pas d'accusé de livraison SMS
  | "DELIVERED_OR_READ";

export interface FallbackDecisionInput {
  situation: FallbackSituation;
  /** Un repli a déjà été déclenché pour ce message (le repli sur timeout ne se fait qu'une fois). */
  alreadyFallenBack?: boolean;
}

export interface FallbackDecisionResult {
  shouldFallback: boolean;
  immediate: boolean;
}

export function fallbackDecision(input: FallbackDecisionInput): FallbackDecisionResult {
  switch (input.situation) {
    case "PERMANENT_ERROR":
    case "TEMPORARY_EXHAUSTED":
      return { shouldFallback: true, immediate: true };
    case "WHATSAPP_UNDELIVERED_TIMEOUT":
      return { shouldFallback: !input.alreadyFallenBack, immediate: false };
    case "SMS_NO_ACK":
    case "DELIVERED_OR_READ":
      return { shouldFallback: false, immediate: false };
    default:
      return { shouldFallback: false, immediate: false };
  }
}

const DEFAULT_FALLBACK_AFTER_MINUTES = 360;
const FAST_FALLBACK_REMINDER_TYPES = new Set(["VEHICLE_READY", "APPOINTMENT"]);

/** RG-M11-05 : délai avant repli WhatsApp → SMS si non délivré (360 min, 30 pour véhicule prêt / RDV). */
export function whatsappFallbackDelayMinutes(
  reminderType: string | null | undefined,
  organizationDefaultMinutes: number = DEFAULT_FALLBACK_AFTER_MINUTES,
): number {
  if (reminderType && FAST_FALLBACK_REMINDER_TYPES.has(reminderType)) {
    return 30;
  }
  return organizationDefaultMinutes;
}
