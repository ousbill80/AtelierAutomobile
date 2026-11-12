// RG-M11-14 : encodage binaire d'un SMS pour les protocoles bas niveau (SMPP).
// Choisit l'alphabet (GSM-7 non compacté, Latin-1 ou UCS-2), puis découpe en segments
// concaténés avec un en-tête UDH 8 bits (05 00 03 ref total n°) quand le texte dépasse un SMS.
// Les limites suivent smsSegments : 160 / 153 (GSM-7, Latin-1), 70 / 67 (UCS-2).

/** Table de base GSM 03.38, dans l'ordre des codes ; l'échappement 0x1B est un trou. */
const GSM7_BASIC_TABLE =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

const GSM7_ESCAPE = 0x1b;

const GSM7_EXTENDED_CODES: Record<string, number> = {
  "^": 0x14,
  "{": 0x28,
  "}": 0x29,
  "\\": 0x2f,
  "[": 0x3c,
  "~": 0x3d,
  "]": 0x3e,
  "|": 0x40,
  "€": 0x65,
};

const GSM7_BASIC_CODES = new Map<string, number>();
[...GSM7_BASIC_TABLE].forEach((char, code) => {
  if (code !== GSM7_ESCAPE) GSM7_BASIC_CODES.set(char, code);
});

/**
 * Alphabet utilisé quand le texte tient en GSM-7 :
 * - `gsm7` : data_coding 0 (alphabet par défaut du SMSC), un septet GSM 03.38 par octet ;
 * - `latin1` : data_coding 3 (ISO-8859-1), pour les SMSC qui lisent l'alphabet par défaut en ASCII.
 * Un texte hors alphabet part toujours en UCS-2 (data_coding 8).
 */
export type SmsDefaultAlphabet = "gsm7" | "latin1";

export interface EncodedSms {
  encoding: "GSM7" | "LATIN1" | "UCS2";
  /** Valeur du champ SMPP data_coding. */
  dataCoding: number;
  /** Charge utile de chaque SMS, en-tête UDH compris quand il y a plusieurs segments. */
  segments: Uint8Array[];
  /** Vrai si les segments portent un en-tête UDH (esm_class 0x40 en SMPP). */
  concatenated: boolean;
}

const SINGLE_LIMIT = { GSM7: 160, LATIN1: 160, UCS2: 140 } as const;
const PART_LIMIT = { GSM7: 153, LATIN1: 153, UCS2: 134 } as const;
const MAX_SEGMENTS = 255;

/** Unités indivisibles : un caractère GSM étendu (2 octets) ou une paire de substitution UCS-2. */
type Unit = number[];

function gsm7Units(text: string): Unit[] | null {
  const units: Unit[] = [];
  for (const char of text) {
    const basic = GSM7_BASIC_CODES.get(char);
    if (basic !== undefined) {
      units.push([basic]);
      continue;
    }
    const extended = GSM7_EXTENDED_CODES[char];
    if (extended === undefined) return null;
    units.push([GSM7_ESCAPE, extended]);
  }
  return units;
}

function latin1Units(text: string): Unit[] | null {
  const units: Unit[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xff) return null;
    units.push([code]);
  }
  return units;
}

function ucs2Units(text: string): Unit[] {
  const units: Unit[] = [];
  for (const char of text) {
    const bytes: number[] = [];
    for (let i = 0; i < char.length; i += 1) {
      const codeUnit = char.charCodeAt(i);
      bytes.push(codeUnit >> 8, codeUnit & 0xff);
    }
    units.push(bytes);
  }
  return units;
}

function pack(units: Unit[], limit: number): number[][] {
  const parts: number[][] = [];
  let current: number[] = [];
  for (const unit of units) {
    if (current.length + unit.length > limit) {
      parts.push(current);
      current = [];
    }
    current.push(...unit);
  }
  if (current.length > 0 || parts.length === 0) parts.push(current);
  return parts;
}

/**
 * @param text corps déjà translitéré si besoin (RG-M11-14) : aucune substitution ici.
 * @param reference numéro de référence de concaténation (0-255), identique pour tous les
 * segments d'un même message ; à dériver de la clé d'idempotence pour rester déterministe.
 */
export function encodeSms(
  text: string,
  options: { defaultAlphabet?: SmsDefaultAlphabet; reference?: number } = {},
): EncodedSms {
  const alphabet = options.defaultAlphabet ?? "gsm7";
  const gsm = gsm7Units(text);
  let encoding: EncodedSms["encoding"];
  let units: Unit[];
  if (gsm && alphabet === "gsm7") {
    encoding = "GSM7";
    units = gsm;
  } else if (gsm && alphabet === "latin1" && latin1Units(text)) {
    encoding = "LATIN1";
    units = latin1Units(text) ?? [];
  } else {
    encoding = "UCS2";
    units = ucs2Units(text);
  }
  const dataCoding = encoding === "GSM7" ? 0 : encoding === "LATIN1" ? 3 : 8;

  const total = units.reduce((sum, unit) => sum + unit.length, 0);
  if (total <= SINGLE_LIMIT[encoding]) {
    return {
      encoding,
      dataCoding,
      segments: [Uint8Array.from(units.flat())],
      concatenated: false,
    };
  }

  const parts = pack(units, PART_LIMIT[encoding]);
  if (parts.length > MAX_SEGMENTS) {
    throw new RangeError(`SMS trop long : ${parts.length} segments (maximum ${MAX_SEGMENTS}).`);
  }
  const reference = (options.reference ?? 0) & 0xff;
  return {
    encoding,
    dataCoding,
    segments: parts.map((bytes, index) =>
      Uint8Array.from([0x05, 0x00, 0x03, reference, parts.length, index + 1, ...bytes]),
    ),
    concatenated: true,
  };
}
