export type PlateType =
  "STANDARD" | "TEMPORARY" | "DIPLOMATIC" | "GOVERNMENT" | "FOREIGN" | "OTHER" | "NONE";

export interface NormalizedPlate {
  raw: string;
  /** Forme compacte en majuscules sans séparateur (ex. "2547GH01"), utilisée pour l'unicité et la recherche. */
  plateCompact: string;
  /** Forme affichée. */
  plate: string;
  plateType: PlateType;
}

const STANDARD_PATTERN = /^(\d{1,4})([A-Z]{2})(\d{2})$/;
const TEMPORARY_PATTERN = /^(WW|W)(\d{3,6})$/;
const DIPLOMATIC_PREFIXES = ["CD", "CMD"];

function squashSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * RG-M02-05 — normalise une plaque ivoirienne. Ne corrige jamais les
 * confusions 0/O ou 1/I : ce qui est saisi est conservé tel quel.
 */
export function normalizePlate(input: string): NormalizedPlate {
  const raw = input;
  const trimmed = input.trim();

  if (trimmed === "" || trimmed.toUpperCase() === "SANS PLAQUE") {
    return { raw, plateCompact: "", plate: "SANS PLAQUE", plateType: "NONE" };
  }

  const plateCompact = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const standard = plateCompact.match(STANDARD_PATTERN);
  if (standard) {
    const [, numbers, letters, suffix] = standard;
    return { raw, plateCompact, plate: `${numbers} ${letters} ${suffix}`, plateType: "STANDARD" };
  }

  const temporary = plateCompact.match(TEMPORARY_PATTERN);
  if (temporary?.[2]) {
    const [, prefix, digits] = temporary;
    const suffix = digits.slice(-2);
    const number = digits.slice(0, -2);
    return { raw, plateCompact, plate: `${prefix} ${number} ${suffix}`, plateType: "TEMPORARY" };
  }

  const plateType = DIPLOMATIC_PREFIXES.some((prefix) => plateCompact.startsWith(prefix))
    ? "DIPLOMATIC"
    : "OTHER";

  return { raw, plateCompact, plate: squashSpaces(input), plateType };
}
