// M06 §14 — `Organization.settings.atelier`. `qcRequired` et `qcChecklist` restent ceux de
// M04 (`settings.repairOrders`, source unique) : `settings.atelier.qcRequired` les surcharge
// seulement s'il est renseigné.

export interface WorkshopSettings {
  qcRequired: boolean | null;
  sharedTablets: boolean;
  keepBayUntilDelivery: boolean;
  photoRequiredOnUrgent: boolean;
}

export const DEFAULT_WORKSHOP_SETTINGS: WorkshopSettings = {
  qcRequired: null,
  sharedTablets: false,
  keepBayUntilDelivery: false,
  photoRequiredOnUrgent: true,
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function workshopSettingsFrom(settings: unknown): WorkshopSettings {
  const a = obj(obj(settings).atelier);
  const d = DEFAULT_WORKSHOP_SETTINGS;
  const bool = (key: keyof WorkshopSettings, fallback: boolean) =>
    typeof a[key] === "boolean" ? (a[key] as boolean) : fallback;
  return {
    qcRequired: typeof a.qcRequired === "boolean" ? a.qcRequired : d.qcRequired,
    sharedTablets: bool("sharedTablets", d.sharedTablets),
    keepBayUntilDelivery: bool("keepBayUntilDelivery", d.keepBayUntilDelivery),
    photoRequiredOnUrgent: bool("photoRequiredOnUrgent", d.photoRequiredOnUrgent),
  };
}
