// Types partagés du module planning (M03). Indépendants de Prisma : les routeurs
// convertissent les enregistrements en ces formes minimales avant d'appeler `core`.

export type AppointmentType =
  "SERVICE" | "INSPECTION_PREP" | "REPAIR" | "DIAGNOSTIC" | "BODYWORK" | "TIRES" | "OTHER";

export const APPOINTMENT_TYPES: readonly AppointmentType[] = [
  "SERVICE",
  "INSPECTION_PREP",
  "REPAIR",
  "DIAGNOSTIC",
  "BODYWORK",
  "TIRES",
  "OTHER",
];

export type AppointmentStatus =
  "BOOKED" | "CONFIRMED" | "ARRIVED" | "NO_SHOW" | "CANCELLED" | "COMPLETED";

export type AppointmentSource = "STAFF" | "PHONE" | "WHATSAPP" | "PORTAL" | "REMINDER";

export type BayType = "LIFT" | "DIAGNOSTIC" | "BODYWORK" | "PAINT" | "WASH" | "OTHER";

export type HalfDay = "AM" | "PM";

/** Intervalle d'instants UTC, demi-ouvert `[start, end)`. */
export interface TimeRange {
  start: Date;
  end: Date;
}

export interface BayLike {
  id: string;
  type: BayType;
  isActive: boolean;
}

/** Forme minimale d'un RDV existant pour les contrôles de conflit et de capacité. */
export interface AppointmentLike {
  id: string;
  bayId: string | null;
  mechanicId: string | null;
  vehicleId?: string | null;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  overbooked?: boolean;
  /** Nom du client, uniquement pour composer les messages d'erreur (« Pont 2 occupé … (Bamba Aminata) »). */
  customerName?: string;
}

/** `ResourceBlock` : pont (`bayId`), mécanicien (`membershipId`) ou site entier (les deux nuls). */
export interface BlockLike {
  id: string;
  bayId: string | null;
  membershipId: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string;
}

/** OR en cours occupant un pont (RG-M03-02) : bloque jusqu'à `promisedAt` ou la fin de journée. */
export interface OccupyingOrderLike {
  id: string;
  number: string;
  bayId: string | null;
  promisedAt: Date | null;
  /** Minutes de travail restantes estimées (charge de la demi-journée, RG-M03-05). */
  remainingMinutes?: number;
}

export interface MechanicLike {
  membershipId: string;
  skills?: readonly string[];
}
