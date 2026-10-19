// RG-M11-14 : encodage et segmentation SMS (GSM 03.38 vs UCS-2)

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

const GSM7_EXTENDED = "^{}\\[~]|€";

const GSM7_BASIC_SET = new Set(GSM7_BASIC);
const GSM7_EXTENDED_SET = new Set(GSM7_EXTENDED);

export const TRANSLITERATION_MAP: Record<string, string> = {
  ê: "e",
  â: "a",
  î: "i",
  ô: "o",
  û: "u",
  ç: "c",
  ë: "e",
  ï: "i",
  œ: "oe",
  "’": "'",
  "«": '"',
  "»": '"',
  "…": "...",
};

export function transliterate(text: string): string {
  let result = "";
  for (const char of text) {
    result += TRANSLITERATION_MAP[char] ?? char;
  }
  return result;
}

export function nonGsmChars(text: string): string[] {
  const found = new Set<string>();
  for (const char of text) {
    if (!GSM7_BASIC_SET.has(char) && !GSM7_EXTENDED_SET.has(char)) {
      found.add(char);
    }
  }
  return [...found];
}

export function isGsm7(text: string): boolean {
  return nonGsmChars(text).length === 0;
}

export interface SmsSegmentsResult {
  encoding: "GSM7" | "UCS2";
  chars: number; // longueur après transliteration éventuelle, en unités GSM-7 (extension comptée 2)
  segments: number;
  nonGsmChars: string[];
}

const GSM7_SINGLE_LIMIT = 160;
const GSM7_CONCAT_LIMIT = 153;
const UCS2_SINGLE_LIMIT = 70;
const UCS2_CONCAT_LIMIT = 67;

/**
 * @param text corps déjà translitéré si `settings.messaging.smsTransliterate` est actif (RG-M11-14) :
 * cette fonction ne translitère pas elle-même, elle mesure le texte fourni.
 */
export function smsSegments(text: string): SmsSegmentsResult {
  const nonGsm = nonGsmChars(text);
  if (nonGsm.length === 0) {
    let units = 0;
    for (const char of text) {
      units += GSM7_EXTENDED_SET.has(char) ? 2 : 1;
    }
    const segments = units <= GSM7_SINGLE_LIMIT ? 1 : Math.ceil(units / GSM7_CONCAT_LIMIT);
    return { encoding: "GSM7", chars: units, segments, nonGsmChars: [] };
  }
  const units = [...text].length;
  const segments = units <= UCS2_SINGLE_LIMIT ? 1 : Math.ceil(units / UCS2_CONCAT_LIMIT);
  return { encoding: "UCS2", chars: units, segments, nonGsmChars: nonGsm };
}
