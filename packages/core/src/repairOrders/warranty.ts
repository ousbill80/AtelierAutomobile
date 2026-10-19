// RG-M04-11 — garantie sur travaux, figée à la livraison, « premier atteint ».
import type { LineType } from "./types";

export interface WarrantySettings {
  laborMonths: number;
  laborKm: number;
  partMonths: number;
  partKm: number;
  /** MO de montage d'une pièce fournie par le client. */
  customerSuppliedLaborMonths: number;
}

export const DEFAULT_WARRANTY_SETTINGS: WarrantySettings = {
  laborMonths: 3,
  laborKm: 5_000,
  partMonths: 6,
  partKm: 10_000,
  customerSuppliedLaborMonths: 1,
};

export interface WarrantyLineInput {
  type: LineType;
  isCustomerSupplied: boolean;
  /** Valeurs saisies sur la ligne (sous-traitance, garantie fabricant) : prioritaires. */
  warrantyMonths?: number | null;
  warrantyKm?: number | null;
}

export interface WarrantyTerms {
  warrantyMonths: number | null;
  warrantyKm: number | null;
  warrantyUntilDate: Date | null;
  warrantyUntilMileage: number | null;
}

const NONE: WarrantyTerms = {
  warrantyMonths: null,
  warrantyKm: null,
  warrantyUntilDate: null,
  warrantyUntilMileage: null,
};

/** Ajoute des mois calendaires à une date `@db.Date` (fin de mois bornée : 31/01 + 1 → 28/02). */
export function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

function baseTerms(
  line: WarrantyLineInput,
  settings: WarrantySettings,
): { months: number | null; km: number | null } {
  if (line.warrantyMonths != null || line.warrantyKm != null) {
    return { months: line.warrantyMonths ?? null, km: line.warrantyKm ?? null };
  }
  switch (line.type) {
    case "LABOR":
      return line.isCustomerSupplied
        ? { months: settings.customerSuppliedLaborMonths, km: null }
        : { months: settings.laborMonths, km: settings.laborKm };
    case "PART":
      return line.isCustomerSupplied
        ? { months: null, km: null }
        : { months: settings.partMonths, km: settings.partKm };
    default:
      // SUBCONTRACT : selon le sous-traitant (saisi sur la ligne) ; FEE/CONSUMABLE : aucune.
      return { months: null, km: null };
  }
}

/** Garantie d'une ligne à la livraison : `deliveredOn` (jour civil) et `mileageIn` de l'OR. */
export function warrantyFor(
  line: WarrantyLineInput,
  deliveredOn: Date,
  mileageIn: number | null,
  settings: WarrantySettings = DEFAULT_WARRANTY_SETTINGS,
): WarrantyTerms {
  if (line.type === "PART" && line.isCustomerSupplied) return NONE;
  const { months, km } = baseTerms(line, settings);
  if (!months && !km) return NONE;
  return {
    warrantyMonths: months,
    warrantyKm: km,
    warrantyUntilDate: months ? addMonthsUtc(deliveredOn, months) : null,
    warrantyUntilMileage: km && mileageIn != null ? mileageIn + km : null,
  };
}

/** Vrai si la ligne est encore couverte à `date` / `mileage` (le premier seuil atteint met fin). */
export function isUnderWarranty(
  line: Pick<WarrantyTerms, "warrantyUntilDate" | "warrantyUntilMileage">,
  date: Date,
  mileage: number | null,
): boolean {
  if (!line.warrantyUntilDate && line.warrantyUntilMileage == null) return false;
  if (line.warrantyUntilDate && date.getTime() > line.warrantyUntilDate.getTime()) return false;
  if (line.warrantyUntilMileage != null && mileage != null && mileage > line.warrantyUntilMileage) {
    return false;
  }
  return true;
}
