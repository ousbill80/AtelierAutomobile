// RG-M04-03 — conditions de la réception (DRAFT → CHECKED_IN).

export type SignatureMode = "SIGNED" | "REMOTE" | "REFUSED";

export interface CheckInRequirementsInput {
  mileageIn: number | null | undefined;
  odometerUnreadable: boolean;
  odometerReason?: string | null;
  fuelLevel: number | null | undefined;
  photoCount: number;
  /** `settings.repairOrders.minCheckInPhotos` (0 possible). */
  minPhotos: number;
  noDamage: boolean;
  damageCount: number;
  complaint: string | null | undefined;
  signature: SignatureMode | null;
}

export type CheckInField =
  "mileageIn" | "fuelLevel" | "photos" | "damages" | "complaint" | "signature";

export interface CheckInIssue {
  field: CheckInField;
  message: string;
}

export function checkInIssues(input: CheckInRequirementsInput): CheckInIssue[] {
  const issues: CheckInIssue[] = [];
  if (input.odometerUnreadable) {
    if (!input.odometerReason?.trim()) {
      issues.push({
        field: "mileageIn",
        message: "Indiquez pourquoi le compteur est illisible.",
      });
    }
  } else if (input.mileageIn == null || !Number.isInteger(input.mileageIn) || input.mileageIn < 0) {
    issues.push({
      field: "mileageIn",
      message: "Saisissez le kilométrage ou cochez « Compteur illisible ».",
    });
  }
  if (
    input.fuelLevel == null ||
    !Number.isInteger(input.fuelLevel) ||
    input.fuelLevel < 0 ||
    input.fuelLevel > 8
  ) {
    issues.push({ field: "fuelLevel", message: "Indiquez le niveau de carburant (0 à 8/8)." });
  }
  if (input.photoCount < input.minPhotos) {
    issues.push({
      field: "photos",
      message: `Prenez au moins ${input.minPhotos} photos (avant, arrière, gauche, droite).`,
    });
  }
  if (input.damageCount === 0 && !input.noDamage) {
    issues.push({
      field: "damages",
      message: "Marquez les dommages sur le schéma ou cochez « Aucun dommage constaté ».",
    });
  }
  if (input.damageCount > 0 && input.noDamage) {
    issues.push({
      field: "damages",
      message: "« Aucun dommage constaté » est coché alors que des dommages sont marqués.",
    });
  }
  if (!input.complaint?.trim()) {
    issues.push({ field: "complaint", message: "Saisissez les doléances du client." });
  }
  if (!input.signature) {
    issues.push({
      field: "signature",
      message:
        "Faites signer le client, ou choisissez « Signature à distance » ou « Refus de signer ».",
    });
  }
  return issues;
}

/** Libellés des accessoires (US-M04-03), clés de `checkIn.items`. */
export const CHECK_IN_ITEM_KEYS = [
  "spare_wheel",
  "jack",
  "wheel_wrench",
  "triangle",
  "vest",
  "extinguisher",
  "radio_front",
  "mats",
  "hubcaps",
  "antenna",
  "registration_card",
  "insurance_certificate",
  "tax_sticker",
] as const;
export type CheckInItemKey = (typeof CHECK_IN_ITEM_KEYS)[number];

export const WARNING_LIGHTS = [
  "engine",
  "abs",
  "airbag",
  "oil",
  "battery",
  "temp",
  "brake",
] as const;
export type WarningLight = (typeof WARNING_LIGHTS)[number];
