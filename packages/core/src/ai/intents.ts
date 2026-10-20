// RG-M17-11 — intentions des messages entrants, et repli par mots-clés
// (`fallback-intents`, RG-M17-08) quand l'IA est désactivée, hors quota ou indisponible.
import { isStopKeyword } from "../messaging/keywords";

export const MESSAGE_INTENTS = [
  "BOOK_APPOINTMENT",
  "RESCHEDULE",
  "CANCEL_APPOINTMENT",
  "CONFIRM",
  "PAYMENT_DONE",
  "PAYMENT_PROMISE",
  "ASK_PRICE",
  "ASK_STATUS",
  "ASK_BALANCE",
  "COMPLAINT",
  "OPT_OUT",
  "THANKS",
  "OTHER",
] as const;
export type MessageIntent = (typeof MESSAGE_INTENTS)[number];

export type DayPeriod = "MORNING" | "AFTERNOON" | "EVENING";
export type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export interface IntentEntities {
  date?: string; // yyyy-MM-dd
  period?: DayPeriod;
  amount?: number;
  promisedDate?: string;
  vehiclePlate?: string;
}

export interface IntentClassification {
  intent: MessageIntent;
  confidence: number;
  entities: IntentEntities;
  sentiment: Sentiment;
  needsHuman: boolean;
}

/** RG-M17-11 / §11 — confiance < 0,6 → `OTHER` + `needsHuman`. */
export const MIN_INTENT_CONFIDENCE = 0.6;

export function normalizeClassification(result: IntentClassification): IntentClassification {
  if (result.confidence < MIN_INTENT_CONFIDENCE && result.intent !== "OTHER") {
    return { ...result, intent: "OTHER", needsHuman: true };
  }
  if (result.intent === "COMPLAINT" || result.sentiment === "NEGATIVE") {
    return { ...result, needsHuman: true };
  }
  return result;
}

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'");
}

const RULES: ReadonlyArray<readonly [MessageIntent, RegExp]> = [
  ["CANCEL_APPOINTMENT", /\b(annul\w*|je (ne )?viens pas|pas venir)\b/],
  ["RESCHEDULE", /\b(report\w*|decal\w*|reprogramm\w*|change[rz]? (la )?date|autre jour)\b/],
  [
    "PAYMENT_DONE",
    /\b(j'?ai paye|deja paye|paiement (effectue|fait)|c'?est paye|j'?ai regle|envoye l'?argent)\b/,
  ],
  [
    "PAYMENT_PROMISE",
    /\b(je (vais|vai) payer|paierai|payerai|je paye (le|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|fin)|apres la paie|fin du mois)\b/,
  ],
  [
    "COMPLAINT",
    /\b(pas content|mecontent|plainte|arnaque|inadmissible|honte|mal (fait|repare)|toujours le meme probleme|deçu|decu)\b/,
  ],
  ["ASK_BALANCE", /\b(combien je (vous )?dois|mon solde|reste a payer|ma dette)\b/],
  ["ASK_PRICE", /\b(prix|combien (ca|ça|sa) (coute|fait)|tarif|cout|devis)\b/],
  ["ASK_STATUS", /\b(c'?est pret|est pret|prete?|ou en est|avance|fini|termine|status|statut)\b/],
  [
    "BOOK_APPOINTMENT",
    /\b(rdv|rendez[- ]?vous|passer|venir|disponible|creneau|samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi|demain|matin|apres[- ]?midi)\b/,
  ],
  ["CONFIRM", /^\s*(1|oui|ok|d'?accord|dac|c'?est bon|confirme|parfait)\s*[.!]*\s*$/],
  ["THANKS", /\b(merci|thanks|remerci\w*)\b/],
];

/**
 * Repli sans IA (RG-M17-08) : règles par mots-clés. Le mot exact « STOP » est traité par M11 ;
 * ici « stop » seul est classé `OPT_OUT` (suggestion), « stop je viens demain » ne l'est pas.
 */
export function classifyIntentByKeywords(text: string): IntentClassification {
  const value = fold(text);
  const base: IntentClassification = {
    intent: "OTHER",
    confidence: 0.5,
    entities: {},
    sentiment: "NEUTRAL",
    needsHuman: true,
  };
  if (!value.trim()) return base;
  if (isStopKeyword(text) || /^\s*(desabonn\w*|ne plus (m'?)?envoyer)/.test(value)) {
    return { ...base, intent: "OPT_OUT", confidence: 0.95, needsHuman: false };
  }
  for (const [intent, re] of RULES) {
    if (re.test(value)) {
      const negative = intent === "COMPLAINT";
      return {
        intent,
        confidence: 0.7,
        entities: extractPeriod(value),
        sentiment: negative ? "NEGATIVE" : intent === "THANKS" ? "POSITIVE" : "NEUTRAL",
        needsHuman: negative,
      };
    }
  }
  return base;
}

function extractPeriod(value: string): IntentEntities {
  if (/\bmatin|matinee\b/.test(value)) return { period: "MORNING" };
  if (/apres[- ]?midi|aprem/.test(value)) return { period: "AFTERNOON" };
  if (/\bsoir\b/.test(value)) return { period: "EVENING" };
  return {};
}

/** Libellé court affiché dans la boîte de réception (badge, §7). */
export const INTENT_BADGE: Record<
  MessageIntent,
  { label: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" }
> = {
  BOOK_APPOINTMENT: { label: "Veut un RDV", tone: "info" },
  RESCHEDULE: { label: "Veut décaler", tone: "warn" },
  CANCEL_APPOINTMENT: { label: "Annule", tone: "warn" },
  CONFIRM: { label: "Confirme", tone: "ok" },
  PAYMENT_DONE: { label: "Dit avoir payé", tone: "ok" },
  PAYMENT_PROMISE: { label: "Promesse de paiement", tone: "info" },
  ASK_PRICE: { label: "Demande un prix", tone: "info" },
  ASK_STATUS: { label: "Demande l'avancement", tone: "info" },
  ASK_BALANCE: { label: "Demande son solde", tone: "info" },
  COMPLAINT: { label: "Réclamation", tone: "danger" },
  OPT_OUT: { label: "Veut se désinscrire", tone: "danger" },
  THANKS: { label: "Remerciement", tone: "ok" },
  OTHER: { label: "À lire", tone: "neutral" },
};
