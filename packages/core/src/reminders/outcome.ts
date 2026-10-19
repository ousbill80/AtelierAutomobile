// RG-M10-27 — règle du dernier contact : un résultat plus fort remplace un plus faible.
// L'attribution monétaire (PAID/PARTIALLY_PAID, fenêtre de 14 j) relève d'une règle unique
// possédée par M12 (`04-arbitrages-coherence.md` A10, via `core/receivables/attribution` +
// `PaymentAttribution`, M09) : non dupliquée ici. Ce module ne compare que des résultats déjà
// attribués à une relance (événements propres à M10 : RDV créé, réponse entrante, etc.).

export type ReminderOutcomeLike =
  | "PAID"
  | "PARTIALLY_PAID"
  | "PROMISED"
  | "APPOINTMENT_BOOKED"
  | "QUOTE_ACCEPTED"
  | "VEHICLE_PICKED_UP"
  | "VISITED"
  | "REPLIED"
  | "OPTED_OUT"
  | "NO_RESPONSE";

// Ordre explicite du PRD : PAID > PARTIALLY_PAID > PROMISED > APPOINTMENT_BOOKED > VISITED >
// REPLIED > NO_RESPONSE. QUOTE_ACCEPTED/VEHICLE_PICKED_UP (conversions spécifiques à leur
// type, non comparées au reste du PRD) sont rangés au niveau d'APPOINTMENT_BOOKED ;
// OPTED_OUT au niveau de REPLIED (tous deux une réaction du destinataire) — ces deux choix
// ne sont pas tranchés explicitement par le PRD.
const STRENGTH: Record<ReminderOutcomeLike, number> = {
  PAID: 8,
  PARTIALLY_PAID: 7,
  PROMISED: 6,
  APPOINTMENT_BOOKED: 5,
  QUOTE_ACCEPTED: 5,
  VEHICLE_PICKED_UP: 5,
  VISITED: 4,
  REPLIED: 3,
  OPTED_OUT: 3,
  NO_RESPONSE: 1,
};

/** Résultat le plus fort entre `current` (déjà enregistré, éventuellement absent) et `incoming`. */
export function strongerOutcome(
  current: ReminderOutcomeLike | null,
  incoming: ReminderOutcomeLike,
): ReminderOutcomeLike {
  if (!current) return incoming;
  return STRENGTH[incoming] > STRENGTH[current] ? incoming : current;
}
