import { DomainError } from "../errors";
import { roundHalfUp } from "../money/round";
import { convertLegacyNumber } from "../phone";

// ═══════════════════════════════════════════════════════════════
// RG-M13-10 — Téléphone
// ═══════════════════════════════════════════════════════════════

export interface ImportPhoneResult {
  phone: string | null;
  phone2: string | null;
  warnings: string[];
  errors: string[];
}

function stripSeparators(value: string): string {
  return value.replace(/[\s.\-()\u00A0\u202F]/g, "");
}

interface SinglePhoneResult {
  e164?: string;
  warning?: string;
  error?: string;
}

function normalizeSingleImportPhone(raw: string): SinglePhoneResult {
  const stripped = stripSeparators(raw);

  if (stripped.startsWith("+") && !stripped.startsWith("+225")) {
    // RG-M13-10 — autre pays : le "+" et les chiffres sont conservés tels quels.
    if (/^\+\d{6,15}$/.test(stripped)) {
      return { e164: stripped };
    }
    return { error: `Numéro de téléphone invalide : « ${raw} ».` };
  }

  let digits = stripped.replace(/\D/g, "");
  if (digits.startsWith("00225")) {
    digits = digits.slice(5);
  } else if (digits.startsWith("225") && digits.length === 13) {
    digits = digits.slice(3);
  }

  if (digits.length === 10) {
    return { e164: `+225${digits}` };
  }

  if (digits.length === 8) {
    const converted = convertLegacyNumber(digits);
    if (converted) {
      return {
        e164: `+225${converted}`,
        warning: `Numéro à 8 chiffres converti : « ${raw} » → +225 ${converted}.`,
      };
    }
    return {
      warning: `Numéro à 8 chiffres non reconnu par la table ARTCI, à vérifier : « ${raw} ».`,
    };
  }

  return { error: `Numéro de téléphone invalide : « ${raw} » (${digits.length} chiffres).` };
}

/**
 * RG-M13-10 — normalise une cellule téléphone, qui peut contenir deux numéros
 * séparés par `/` ou `,` (le premier devient `phone`, le second `phone2`).
 */
export function normalizeImportPhone(raw: string): ImportPhoneResult {
  const parts = raw
    .split(/[/,]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");

  const warnings: string[] = [];
  const errors: string[] = [];
  const values: (string | null)[] = [];

  for (const part of parts.slice(0, 2)) {
    const result = normalizeSingleImportPhone(part);
    if (result.warning) warnings.push(result.warning);
    if (result.error) errors.push(result.error);
    values.push(result.e164 ?? null);
  }

  return {
    phone: values[0] ?? null,
    phone2: values[1] ?? null,
    warnings,
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════
// RG-M13-11 — Dates
// ═══════════════════════════════════════════════════════════════

export interface DateNormalizationResult {
  date: Date | null;
  error?: string;
}

const MONTH_NAMES: Record<string, number> = {
  janv: 0,
  janvier: 0,
  fevr: 1,
  fev: 1,
  fevrier: 1,
  mars: 2,
  avr: 3,
  avril: 3,
  mai: 4,
  juin: 5,
  juil: 6,
  juillet: 6,
  aout: 7,
  sept: 8,
  septembre: 8,
  oct: 9,
  octobre: 9,
  nov: 10,
  novembre: 10,
  dec: 11,
  decembre: 11,
};

const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_YEAR = 1990;
const MAX_YEARS_AHEAD = 3;

function fromExcelSerial(serial: number): Date {
  return new Date(EXCEL_EPOCH_UTC_MS + serial * MS_PER_DAY);
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseTextMonthDate(trimmed: string): Date | null {
  const match = stripAccents(trimmed)
    .toLowerCase()
    .match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/);
  if (!match) return null;

  const [, dayStr, monthWord, yearStr] = match;
  const month = MONTH_NAMES[monthWord!];
  if (month === undefined) return null;

  const day = Number.parseInt(dayStr!, 10);
  const year = Number.parseInt(yearStr!, 10);
  return new Date(Date.UTC(year, month, day));
}

function isValidCalendarDate(date: Date, year: number, month: number, day: number): boolean {
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
  );
}

export interface DateNormalizationOptions {
  /** Format américain (mm/jj) explicitement choisi par l'utilisateur (RG-M13-11). */
  americanFormat?: boolean;
}

/**
 * RG-M13-11 — normalise une date de fichier d'import. `now` est l'horloge
 * injectée par l'appelant (jamais `new Date()` dans `core`, cf. CLAUDE.md).
 */
export function normalizeImportDate(
  raw: string | number,
  now: Date,
  options: DateNormalizationOptions = {},
): DateNormalizationResult {
  let date: Date | null = null;

  if (typeof raw === "number") {
    date = fromExcelSerial(raw);
  } else {
    const trimmed = raw.trim();

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const slashMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);

    if (isoMatch) {
      const [, yearStr, monthStr, dayStr] = isoMatch;
      const year = Number.parseInt(yearStr!, 10);
      const month = Number.parseInt(monthStr!, 10) - 1;
      const day = Number.parseInt(dayStr!, 10);
      const candidate = new Date(Date.UTC(year, month, day));
      date = isValidCalendarDate(candidate, year, month, day) ? candidate : null;
    } else if (slashMatch) {
      const [, firstStr, secondStr, yearStr] = slashMatch;
      const first = Number.parseInt(firstStr!, 10);
      const second = Number.parseInt(secondStr!, 10);
      const day = options.americanFormat ? second : first;
      const month = (options.americanFormat ? first : second) - 1;
      const yearDigits = yearStr!;
      const year =
        yearDigits.length === 2
          ? (Number.parseInt(yearDigits, 10) < 50 ? 2000 : 1900) + Number.parseInt(yearDigits, 10)
          : Number.parseInt(yearDigits, 10);
      const candidate = new Date(Date.UTC(year, month, day));
      date = isValidCalendarDate(candidate, year, month, day) ? candidate : null;
    } else {
      date = parseTextMonthDate(trimmed);
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return { date: null, error: `Date invalide : « ${raw} ».` };
  }

  const minDate = Date.UTC(MIN_YEAR, 0, 1);
  const maxDate = Date.UTC(
    now.getUTCFullYear() + MAX_YEARS_AHEAD,
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  if (date.getTime() < minDate || date.getTime() > maxDate) {
    return {
      date: null,
      error: `Date hors plage autorisée (${MIN_YEAR} à aujourd'hui + 3 ans) : « ${raw} ».`,
    };
  }

  return { date };
}

// ═══════════════════════════════════════════════════════════════
// RG-M13-12 — Montants
// ═══════════════════════════════════════════════════════════════

export interface AmountNormalizationResult {
  amount: number;
  warning?: string;
}

const CURRENCY_TOKEN_PATTERN = /\s*(FCFA|F\s*CFA|XOF|F)\s*/gi;
const WHITESPACE_PATTERN = /[\s\u00A0\u202F]/g;
const GROUPING_SEPARATOR_PATTERN = /[.,](\d{3})(?!\d)/g;
const TRAILING_DECIMAL_PATTERN = /[.,](\d{1,2})$/;

/** RG-M13-12 — normalise un montant FCFA saisi librement en entier. */
export function normalizeImportAmount(raw: string): AmountNormalizationResult {
  let input = raw.trim();
  if (input === "") {
    throw new DomainError("import.amount.empty", "Montant vide.");
  }

  let negative = false;
  const parenMatch = input.match(/^\((.*)\)$/);
  if (parenMatch) {
    negative = true;
    input = parenMatch[1]!.trim();
  }

  input = input.replace(CURRENCY_TOKEN_PATTERN, "");
  input = input.replace(WHITESPACE_PATTERN, "");

  if (input.startsWith("-")) {
    negative = true;
    input = input.slice(1);
  }

  input = input.replace(GROUPING_SEPARATOR_PATTERN, "$1");

  const decimalMatch = input.match(TRAILING_DECIMAL_PATTERN);
  let integerPart = input;
  let decimalDigits: string | undefined;
  if (decimalMatch) {
    integerPart = input.slice(0, input.length - decimalMatch[0].length);
    decimalDigits = decimalMatch[1];
  }

  if (integerPart === "" || !/^\d+$/.test(integerPart)) {
    throw new DomainError("import.amount.invalid_format", `Montant invalide : « ${raw} ».`, {
      input: raw,
    });
  }

  let amount = Number.parseInt(integerPart, 10);
  let warning: string | undefined;

  if (decimalDigits && /[1-9]/.test(decimalDigits)) {
    const fraction = Number.parseInt(decimalDigits, 10) / 10 ** decimalDigits.length;
    amount = roundHalfUp(amount + fraction);
    warning = `Montant avec décimales non nulles arrondi à l'entier le plus proche : « ${raw} » → ${amount}.`;
  }

  return { amount: negative ? -amount : amount, warning };
}

// ═══════════════════════════════════════════════════════════════
// RG-M13-14 — Textes
// ═══════════════════════════════════════════════════════════════

/** Trim + espaces multiples réduits. */
export function normalizeImportText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(^|[\s'-])([a-zàâäéèêëïîôöùûüç])/g,
      (_match, sep: string, letter: string) => sep + letter.toUpperCase(),
    );
}

/**
 * RG-M13-14 — met un nom en Casse Titre, sauf si la cellule contient déjà des
 * minuscules (dans ce cas la casse d'origine est respectée).
 */
export function normalizeImportName(value: string): string {
  const trimmed = normalizeImportText(value);
  if (/[a-zàâäéèêëïîôöùûüç]/.test(trimmed)) {
    return trimmed;
  }
  return titleCase(trimmed);
}

export interface EmailNormalizationResult {
  email: string | null;
  error?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** RG-M13-14 — email en minuscules et validé. */
export function normalizeImportEmail(value: string): EmailNormalizationResult {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return { email: null };
  if (!EMAIL_PATTERN.test(trimmed)) {
    return { email: null, error: `Email invalide : « ${value} ».` };
  }
  return { email: trimmed };
}

// ═══════════════════════════════════════════════════════════════
// RG-M13-15 — Énumérations
// ═══════════════════════════════════════════════════════════════

export type ImportPaymentMethod =
  | "CASH"
  | "WAVE"
  | "ORANGE_MONEY"
  | "MTN_MOMO"
  | "MOOV_MONEY"
  | "BANK_TRANSFER"
  | "CHEQUE"
  | "CARD"
  | "OTHER";

/** RG-M13-15 — reconnaît le mode de paiement à partir d'un texte libre. */
export function normalizeImportPaymentMethod(value: string): ImportPaymentMethod {
  const v = stripAccents(value).toLowerCase();
  if (/espece|cash/.test(v)) return "CASH";
  if (/wave/.test(v)) return "WAVE";
  if (/\bom\b|orange/.test(v)) return "ORANGE_MONEY";
  if (/mtn|momo/.test(v)) return "MTN_MOMO";
  if (/moov|flooz/.test(v)) return "MOOV_MONEY";
  if (/virement|\bvir\b/.test(v)) return "BANK_TRANSFER";
  if (/cheque|chq/.test(v)) return "CHEQUE";
  if (/\bcb\b|carte/.test(v)) return "CARD";
  return "OTHER";
}

export type ImportFuelType = "PETROL" | "DIESEL" | "OTHER";

/** RG-M13-15 — reconnaît le type de carburant à partir d'un texte libre. */
export function normalizeImportFuelType(value: string): ImportFuelType {
  const v = stripAccents(value).toLowerCase();
  if (/essence|\bess\b/.test(v)) return "PETROL";
  if (/gasoil|gazole|diesel/.test(v)) return "DIESEL";
  return "OTHER";
}
