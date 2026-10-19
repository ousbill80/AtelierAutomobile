// RG-M03-04 — durée par défaut d'un RDV : celle du type, sauf si des opérations du catalogue
// (ou un devis accepté) sont connues, auquel cas la durée = somme des `standardHours`, arrondie
// au quart d'heure supérieur, avec un minimum égal à la durée du type.
// Exemple : vidange (0,5 h) + plaquettes avant (1 h) + géométrie (0,75 h) = 2,25 h → 135 min.

export const DEFAULT_APPOINTMENT_DURATIONS: Record<string, number> = {
  SERVICE: 90,
  INSPECTION_PREP: 60,
  REPAIR: 120,
  DIAGNOSTIC: 60,
  BODYWORK: 30,
  TIRES: 45,
  OTHER: 60,
};

function roundUpToQuarterHour(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}

export function defaultDuration(
  type: string,
  durationsByType: Record<string, number> = DEFAULT_APPOINTMENT_DURATIONS,
  standardHours?: readonly number[],
): number {
  const typeDefault = durationsByType[type] ?? 60;
  if (!standardHours || standardHours.length === 0) return typeDefault;
  const totalHours = standardHours.reduce((sum, hours) => sum + hours, 0);
  const roundedMinutes = roundUpToQuarterHour(totalHours * 60);
  return Math.max(roundedMinutes, typeDefault);
}
