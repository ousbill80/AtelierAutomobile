// RG-M02-01 — nom affiché. INDIVIDUAL : nom puis prénoms, majuscule initiale à chaque mot,
// particules conservées ("N'Guessan", "Kouadio-Konan"). COMPANY : displayName = companyName.

function titleCaseWord(word: string): string {
  let result = "";
  let capitalizeNext = true;
  for (const char of word) {
    if (capitalizeNext && /[a-zà-ÿ]/i.test(char)) {
      result += char.toUpperCase();
      capitalizeNext = false;
    } else {
      result += char.toLowerCase();
    }
    if (char === "-" || char === "'" || char === " ") {
      capitalizeNext = true;
    }
  }
  return result;
}

/** Majuscule initiale à chaque mot, en conservant les particules autour de "-" et "'". */
export function titleCaseName(input: string): string {
  return input.trim().split(/\s+/).filter(Boolean).map(titleCaseWord).join(" ");
}

export type DisplayNameInput =
  | { type: "INDIVIDUAL"; lastName: string; firstName?: string | null }
  | { type: "COMPANY"; companyName: string };

export function computeDisplayName(input: DisplayNameInput): string {
  if (input.type === "COMPANY") {
    return input.companyName.trim();
  }
  const full = [input.lastName, input.firstName].filter(Boolean).join(" ").trim();
  return titleCaseName(full);
}
