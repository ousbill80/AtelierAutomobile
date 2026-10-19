// RG-M10-13 (choix du modèle) et RG-M10-15 (regroupement d'envoi).

const MAX_VEHICLES_LISTED = 10;

export interface GroupableReminder {
  vehicleId: string | null;
  type: "INSPECTION" | "SERVICE" | string;
}

/** VT et révision du même véhicule dues le même jour : un seul message `vt_rev_combo`. */
export function detectCombo(reminders: readonly GroupableReminder[]): boolean {
  const typesByVehicle = new Map<string, Set<string>>();
  for (const r of reminders) {
    if (!r.vehicleId || (r.type !== "INSPECTION" && r.type !== "SERVICE")) continue;
    const set = typesByVehicle.get(r.vehicleId) ?? new Set<string>();
    set.add(r.type);
    typesByVehicle.set(r.vehicleId, set);
  }
  for (const set of typesByVehicle.values()) {
    if (set.has("INSPECTION") && set.has("SERVICE")) return true;
  }
  return false;
}

export interface GroupTemplateKeyInput {
  type: "INSPECTION" | "SERVICE" | string;
  stepTemplateKey: string;
  vehicleCount: number;
  isCombo: boolean;
}

/** RG-M10-15 : 1 véhicule → modèle du palier ; ≥ 2 véhicules → `vt_multi`/`rev_multi`. */
export function resolveGroupTemplateKey(input: GroupTemplateKeyInput): string {
  if (input.isCombo) return "vt_rev_combo";
  if (input.vehicleCount >= 2) {
    if (input.type === "INSPECTION") return "vt_multi";
    if (input.type === "SERVICE") return "rev_multi";
  }
  return input.stepTemplateKey;
}

/** RG-M10-13 : `{key}_pro` avant `{key}` pour un client `COMPANY`, sinon `{key}` seul. */
export function templateKeyCandidates(key: string, isCompany: boolean): string[] {
  return isCompany ? [`${key}_pro`, key] : [key];
}

/** RG-M10-15 : au-delà de 10 véhicules, la liste est tronquée. */
export function formatVehicleList(plates: readonly string[]): string {
  if (plates.length <= MAX_VEHICLES_LISTED) return plates.join(", ");
  const shown = plates.slice(0, MAX_VEHICLES_LISTED);
  const rest = plates.length - MAX_VEHICLES_LISTED;
  return `${shown.join(", ")} … et ${rest} autre${rest > 1 ? "s" : ""} véhicule${rest > 1 ? "s" : ""}, détail sur demande`;
}
