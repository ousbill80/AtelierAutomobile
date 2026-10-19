// RG-M11-19 : mots-clés de désinscription / réactivation

const STOP_PHRASES = [
  "STOP",
  "ARRET",
  "ARRETER",
  "DESABONNER",
  "DESINSCRIRE",
  "STOP RAPPEL",
  "UNSUBSCRIBE",
];

const START_PHRASES = ["START", "REPRENDRE"];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ") // ponctuation → espace
    .trim()
    .replace(/\s+/g, " ");
}

function matchesKeyword(text: string, phrases: string[]): boolean {
  const normalized = normalize(text);
  if (normalized === "") return false;
  if (normalized.split(" ").length > 3) return false;
  return phrases.includes(normalized);
}

/** « Stop, j'ai déjà payé » (> 3 mots) n'est pas une désinscription automatique (RG-M11-19). */
export function isStopKeyword(text: string): boolean {
  return matchesKeyword(text, STOP_PHRASES);
}

export function isStartKeyword(text: string): boolean {
  return matchesKeyword(text, START_PHRASES);
}
