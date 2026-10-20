// US-M03-07 / RG-M03-09 — classement des réponses client 1/2/3 à une confirmation ou un rappel.
// Mots-clés exacts uniquement (confiance maximale) : tout autre texte n'est jamais appliqué
// automatiquement, il marque le RDV « à replanifier » pour le réceptionnaire.

export type AppointmentReplyIntent = "CONFIRM" | "RESCHEDULE" | "CANCEL";

const CONFIRM = new Set([
  "1",
  "oui",
  "ok",
  "okay",
  "d'accord",
  "daccord",
  "dac",
  "je confirme",
  "confirme",
  "confirmé",
  "oui merci",
  "ok merci",
]);
const RESCHEDULE = new Set(["2", "deplacer", "déplacer", "reporter", "decaler", "décaler"]);
const CANCEL = new Set(["3", "annuler", "annule", "annulé", "annulez"]);

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[\s.!?,;]+$/g, "")
    .replace(/\s+/g, " ");
}

/** `{ intent, automatic }` : `automatic = true` seulement pour un mot-clé exact. */
export function classifyAppointmentReply(
  text: string,
): { intent: AppointmentReplyIntent; automatic: boolean } | null {
  const value = normalize(text);
  if (!value) return null;
  if (CONFIRM.has(value)) return { intent: "CONFIRM", automatic: true };
  if (CANCEL.has(value)) return { intent: "CANCEL", automatic: true };
  if (RESCHEDULE.has(value)) return { intent: "RESCHEDULE", automatic: true };
  return { intent: "RESCHEDULE", automatic: false };
}
