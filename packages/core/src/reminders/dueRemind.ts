// Relance d'échéance depuis l'écran Échéances (VT, révision, assurance) : l'utilisateur choisit
// des véhicules et des canaux. Chaque véhicule a son propre message, même quand le client en a
// plusieurs. Fonctions pures, sans horloge.
import { checkManualReminder } from "./manual";
import { REMINDER_CHANNELS, type ReminderChannel } from "./bulk";

export type DueRemindBlockReason =
  "NO_DATE" | "DO_NOT_REMIND" | "NO_CONSENT" | "NO_CONTACT" | "ALREADY_PENDING" | "RECENTLY_SENT";

export interface DueRemindEligibilityInput {
  dueDate: Date | null;
  doNotRemind: boolean;
  remindersConsent: boolean;
  addresses: Partial<Record<ReminderChannel, string | null>>;
  /** Dernière relance envoyée pour ce véhicule et ce type d'échéance. */
  lastSentAt: Date | null;
  /** Une relance de ce véhicule et de ce type attend déjà son envoi. */
  hasPendingDue: boolean;
  now: Date;
}

export type DueRemindEligibility =
  | { eligible: true; reachable: ReminderChannel[] }
  | { eligible: false; reason: DueRemindBlockReason; nextAllowedAt?: Date };

export function dueRemindEligibility(input: DueRemindEligibilityInput): DueRemindEligibility {
  if (!input.dueDate) return { eligible: false, reason: "NO_DATE" };
  if (input.doNotRemind) return { eligible: false, reason: "DO_NOT_REMIND" };
  if (!input.remindersConsent) return { eligible: false, reason: "NO_CONSENT" };
  const reachable = REMINDER_CHANNELS.filter((channel) => !!input.addresses[channel]);
  if (reachable.length === 0) return { eligible: false, reason: "NO_CONTACT" };
  const check = checkManualReminder({
    now: input.now,
    lastSentAt: input.lastSentAt,
    hasPendingDue: input.hasPendingDue,
  });
  if (!check.allowed) {
    return check.reason === "RECENTLY_SENT"
      ? { eligible: false, reason: "RECENTLY_SENT", nextAllowedAt: check.nextAllowedAt }
      : { eligible: false, reason: "ALREADY_PENDING" };
  }
  return { eligible: true, reachable };
}

export interface DueVehicleLike {
  vehicleId: string;
  customerId: string;
  eligible: boolean;
  reachable: readonly ReminderChannel[];
}

export interface DueCustomerGroup<V extends DueVehicleLike> {
  customerId: string;
  vehicles: V[];
}

/** Regroupe les véhicules par client, dans l'ordre de première apparition. */
export function groupDueByCustomer<V extends DueVehicleLike>(
  vehicles: readonly V[],
): DueCustomerGroup<V>[] {
  const groups = new Map<string, DueCustomerGroup<V>>();
  for (const vehicle of vehicles) {
    const group = groups.get(vehicle.customerId) ?? {
      customerId: vehicle.customerId,
      vehicles: [],
    };
    group.vehicles.push(vehicle);
    groups.set(vehicle.customerId, group);
  }
  return [...groups.values()];
}

/**
 * Nombre de messages : un par véhicule et par canal joignable (chaque véhicule a son propre
 * message, même quand le client en a plusieurs).
 */
export function countDueMessages(
  groups: readonly DueCustomerGroup<DueVehicleLike>[],
  selected: ReadonlySet<string>,
  channels: ReadonlySet<ReminderChannel>,
): { customers: number; vehicles: number; messages: number } {
  let customers = 0;
  let vehicles = 0;
  let messages = 0;
  for (const group of groups) {
    let customerMessages = 0;
    for (const vehicle of group.vehicles) {
      if (!vehicle.eligible || !selected.has(vehicle.vehicleId)) continue;
      const sent = [...channels].filter((c) => vehicle.reachable.includes(c)).length;
      // Véhicule injoignable sur les canaux choisis : il ne sera pas relancé.
      if (sent === 0) continue;
      vehicles += 1;
      customerMessages += sent;
    }
    if (customerMessages === 0) continue;
    customers += 1;
    messages += customerMessages;
  }
  return { customers, vehicles, messages };
}
