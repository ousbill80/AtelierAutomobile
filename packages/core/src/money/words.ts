// RG-M08-04 — montant en lettres sur la facture (« Cent quatre-vingt-cinq mille francs CFA »).
// Orthographe traditionnelle : « et un » de 21 à 71, accord de « cent » et « quatre-vingt »
// seulement en fin de nombre (et devant million/milliard, qui sont des noms), « mille » invariable.
import { DomainError } from "../errors";

const UNITS = [
  "zéro",
  "un",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
  "onze",
  "douze",
  "treize",
  "quatorze",
  "quinze",
  "seize",
] as const;

const TENS: Record<number, string> = {
  2: "vingt",
  3: "trente",
  4: "quarante",
  5: "cinquante",
  6: "soixante",
};

function below100(n: number, final: boolean): string {
  if (n < 17) return UNITS[n]!;
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  const ten = Math.floor(n / 10);
  const unit = n % 10;
  if (ten <= 6) {
    if (unit === 0) return TENS[ten]!;
    if (unit === 1) return `${TENS[ten]} et un`;
    return `${TENS[ten]}-${UNITS[unit]}`;
  }
  if (ten === 7) {
    if (unit === 1) return "soixante et onze";
    return `soixante-${below100(10 + unit, final)}`;
  }
  if (ten === 8) {
    if (unit === 0) return final ? "quatre-vingts" : "quatre-vingt";
    return `quatre-vingt-${UNITS[unit]}`;
  }
  return `quatre-vingt-${below100(10 + unit, final)}`;
}

function below1000(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return below100(rest, final);
  const head = hundreds === 1 ? "cent" : `${UNITS[hundreds]} cent`;
  if (rest === 0) return hundreds > 1 && final ? `${head}s` : head;
  return `${head} ${below100(rest, final)}`;
}

/** Nombre entier en toutes lettres, en minuscules (ex. 1 080 080 → « un million quatre-vingt mille quatre-vingts »). */
export function toFrenchWords(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new DomainError("money.invalid_amount", "Le montant doit être un entier FCFA.", {
      value,
    });
  }
  if (value < 0) return `moins ${toFrenchWords(-value)}`;
  if (value === 0) return UNITS[0];
  const parts: string[] = [];
  const billions = Math.floor(value / 1_000_000_000);
  const millions = Math.floor((value % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const rest = value % 1_000;
  if (billions > 0) {
    // Au-delà de 999 milliards (sans objet en FCFA) on répète le procédé récursivement.
    const head = billions < 1000 ? below1000(billions, true) : toFrenchWords(billions);
    parts.push(`${head} milliard${billions > 1 ? "s" : ""}`);
  }
  if (millions > 0) parts.push(`${below1000(millions, true)} million${millions > 1 ? "s" : ""}`);
  if (thousands > 0) parts.push(thousands === 1 ? "mille" : `${below1000(thousands, false)} mille`);
  if (rest > 0) parts.push(below1000(rest, true));
  return parts.join(" ");
}

/** Mention « montant en lettres » de la facture : « Cent quatre-vingt-cinq mille francs CFA ». */
export function amountInWords(value: number): string {
  const words = toFrenchWords(value);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} francs CFA`;
}
