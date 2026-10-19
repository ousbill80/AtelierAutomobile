// RG-M07-02 — compatibilités normalisées "MARQUE|MODELE|ANNEE_DEBUT-ANNEE_FIN".
// Ex. "TOYOTA|COROLLA|2014-2019", "TOYOTA|*|*" (universel marque), "TOYOTA|HILUX|2016".
import { DomainError } from "../errors";

export interface CompatibilityEntry {
  make: string;
  model: string; // "*" = tous modèles
  yearFrom: number | null;
  yearTo: number | null;
}

export interface VehicleLike {
  make?: string | null;
  model?: string | null;
  year?: number | null;
}

function norm(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function parseCompatibility(raw: string): CompatibilityEntry | null {
  const parts = raw.split("|").map((p) => p.trim());
  if (parts.length < 1 || !parts[0]) return null;
  const [make, model = "*", years = "*"] = parts;
  let yearFrom: number | null = null;
  let yearTo: number | null = null;
  if (years && years !== "*") {
    const m = /^(\d{4})?\s*-\s*(\d{4})?$/.exec(years) ?? /^(\d{4})$/.exec(years);
    if (!m) return null;
    if (m.length === 2) {
      yearFrom = Number(m[1]);
      yearTo = Number(m[1]);
    } else {
      yearFrom = m[1] ? Number(m[1]) : null;
      yearTo = m[2] ? Number(m[2]) : null;
    }
  }
  return { make: norm(make!), model: model ? norm(model) : "*", yearFrom, yearTo };
}

/** Construit une chaîne normalisée (validation à la saisie). */
export function formatCompatibility(entry: {
  make: string;
  model?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
}): string {
  const make = norm(entry.make);
  if (!make || make.includes("|")) {
    throw new DomainError("stock.invalid_compatibility", "Marque invalide pour la compatibilité.");
  }
  const model = entry.model && entry.model.trim() ? norm(entry.model) : "*";
  const { yearFrom = null, yearTo = null } = entry;
  if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
    throw new DomainError(
      "stock.invalid_compatibility",
      "L'année de début doit précéder l'année de fin.",
    );
  }
  const years =
    yearFrom == null && yearTo == null
      ? "*"
      : yearFrom === yearTo
        ? String(yearFrom)
        : `${yearFrom ?? ""}-${yearTo ?? ""}`;
  return `${make}|${model}|${years}`;
}

/** Correspondance : marque égale (casse ignorée), modèle égal ou `*`, année dans l'intervalle
 *  (année du véhicule inconnue = correspond). */
export function matchCompatibility(entries: readonly string[], vehicle: VehicleLike): boolean {
  if (!vehicle.make) return false;
  const make = norm(vehicle.make);
  const model = vehicle.model ? norm(vehicle.model) : null;
  return entries.some((raw) => {
    const e = parseCompatibility(raw);
    if (!e || e.make !== make) return false;
    if (e.model !== "*" && e.model !== model) return false;
    if (vehicle.year == null) return true;
    if (e.yearFrom != null && vehicle.year < e.yearFrom) return false;
    if (e.yearTo != null && vehicle.year > e.yearTo) return false;
    return true;
  });
}
