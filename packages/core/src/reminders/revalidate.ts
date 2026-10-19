import { addHours, differenceInCalendarDays } from "date-fns";

/**
 * RG-M10-24 — résultat de la revérification juste avant l'envoi : `ok`, ou annulation définitive
 * (`CANCELLED`, motif lisible), ou replanification (`RESCHEDULED`, ex. paiement en cours).
 */
export type RevalidateOutcome =
  | { ok: true }
  | { ok: false; outcome: "CANCELLED"; reason: string }
  | { ok: false; outcome: "RESCHEDULED"; reason: string; retryAt: Date };

const OK: RevalidateOutcome = { ok: true };

function cancelled(reason: string): RevalidateOutcome {
  return { ok: false, outcome: "CANCELLED", reason };
}

function rescheduled(reason: string, retryAt: Date): RevalidateOutcome {
  return { ok: false, outcome: "RESCHEDULED", reason, retryAt };
}

// ───────────────────────── RG-M10-24.1 — client ─────────────────────────

export interface RevalidateClientInput {
  deletedAt: Date | null;
  remindersConsent: boolean;
  doNotRemind: boolean;
  isOptedOut: boolean;
  hasActiveSuppression: boolean;
  /** `true` pour `APPOINTMENT`/`VEHICLE_READY` : exemptés de consentement/`doNotRemind`/`OptOut`. */
  isTransactional: boolean;
}

/** RG-M10-24.1 — non supprimé, consentement, pas `doNotRemind`, hors `OptOut`, pas de suppression active. */
export function revalidateClient(input: RevalidateClientInput): RevalidateOutcome {
  if (input.deletedAt) return cancelled("Client supprimé");
  if (!input.isTransactional) {
    if (input.doNotRemind) return cancelled("Le client a demandé à ne plus être relancé");
    if (!input.remindersConsent) return cancelled("Consentement aux relances retiré");
    if (input.isOptedOut) return cancelled("Adresse en liste d'exclusion (STOP)");
  }
  if (input.hasActiveSuppression) return cancelled("Suppression active sur cette séquence");
  return OK;
}

// ───────────────────────── RG-M10-24.2 — INSPECTION ─────────────────────────

export interface RevalidateInspectionInput {
  plannedInspectionExpiryDate: Date;
  currentInspectionExpiryDate: Date | null;
  vehicleStillOwnedByCustomer: boolean;
  hasOpenAppointmentOrRepairOrderSinceAnchor: boolean;
}

/**
 * RG-M10-24.2 — `inspectionExpiryDate` toujours égale à l'ancre ; véhicule toujours rattaché au
 * client ; aucun RDV/OR ouvert depuis la planification.
 */
export function revalidateInspection(input: RevalidateInspectionInput): RevalidateOutcome {
  if (
    !input.currentInspectionExpiryDate ||
    input.currentInspectionExpiryDate.getTime() !== input.plannedInspectionExpiryDate.getTime()
  ) {
    return cancelled("Date de visite technique mise à jour depuis la planification");
  }
  if (!input.vehicleStillOwnedByCustomer) {
    return cancelled("Véhicule non rattaché au client (changement de propriétaire)");
  }
  if (input.hasOpenAppointmentOrRepairOrderSinceAnchor) {
    return cancelled("Un rendez-vous ou un ordre de réparation est déjà ouvert");
  }
  return OK;
}

// ───────────────────────── RG-M10-24.3 — SERVICE ─────────────────────────

export interface RevalidateServiceInput {
  plannedServiceDueDate: Date;
  currentServiceDueDate: Date | null;
  /** RG-M10-24.3 : ± 3 j par défaut. */
  toleranceDays?: number;
}

/** RG-M10-24.3 — échéance recalculée identique à ± 3 j ; sinon annulation (nouvelle séquence). */
export function revalidateService(input: RevalidateServiceInput): RevalidateOutcome {
  const toleranceDays = input.toleranceDays ?? 3;
  if (!input.currentServiceDueDate) {
    return cancelled("Échéance de révision introuvable");
  }
  const diffDays = Math.abs(
    differenceInCalendarDays(input.currentServiceDueDate, input.plannedServiceDueDate),
  );
  if (diffDays > toleranceDays) {
    return cancelled("Échéance de révision recalculée : nouvelle séquence");
  }
  return OK;
}

// ───────────────────────── RG-M10-24.4 — RECEIVABLE ─────────────────────────

export type CollectionCaseStatus =
  "OPEN" | "ESCALATED" | "DISPUTED" | "PROMISED" | "PAUSED" | "CLOSED";

export interface RevalidateReceivableInput {
  /** Recalculé maintenant depuis `Invoice.balance`, jamais la valeur en cache. */
  currentBalance: number;
  minAmount: number;
  caseStatus: CollectionCaseStatus;
  /** Paiement `PENDING` (lien ouvert) initié dans les 2 dernières heures. */
  hasPendingPaymentWithinTwoHours: boolean;
  hasUnallocatedPaymentOrCredit: boolean;
  /** `false` en `REMINDERS_ONLY` quand les données sont trop anciennes (RG-M10-29). */
  dataFreshnessOk: boolean;
  now: Date;
}

/**
 * RG-M10-24.4 — solde en retard recalculé ≥ `minAmount` ; dossier `OPEN`/`ESCALATED` ; pas de
 * paiement non affecté ni d'avoir couvrant le retard ; pas de paiement `PENDING` dans les 2
 * dernières heures (sinon replanifiée +2 h, pas annulée) ; fraîcheur des données en `REMINDERS_ONLY`.
 */
export function revalidateReceivable(input: RevalidateReceivableInput): RevalidateOutcome {
  if (input.currentBalance < input.minAmount) {
    return cancelled("Facture déjà réglée ou solde sous le seuil");
  }
  if (input.caseStatus !== "OPEN" && input.caseStatus !== "ESCALATED") {
    return cancelled(`Dossier de recouvrement au statut ${input.caseStatus}`);
  }
  if (!input.dataFreshnessOk) {
    return cancelled("Données de créances trop anciennes (mode Relances seules)");
  }
  if (input.hasUnallocatedPaymentOrCredit) {
    return cancelled("Paiement non affecté à rapprocher");
  }
  if (input.hasPendingPaymentWithinTwoHours) {
    return rescheduled("Paiement en cours (lien de paiement ouvert)", addHours(input.now, 2));
  }
  return OK;
}

// ───────────────────────── RG-M10-24.5 — APPOINTMENT ─────────────────────────

export type AppointmentStatus = "BOOKED" | "CONFIRMED" | "CANCELLED" | "NO_SHOW" | "COMPLETED";

export interface RevalidateAppointmentInput {
  status: AppointmentStatus;
  plannedStartsAt: Date;
  currentStartsAt: Date | null;
}

/** RG-M10-24.5 — RDV toujours `BOOKED`/`CONFIRMED` et `startsAt` inchangé. */
export function revalidateAppointment(input: RevalidateAppointmentInput): RevalidateOutcome {
  if (input.status !== "BOOKED" && input.status !== "CONFIRMED") {
    return cancelled("Rendez-vous annulé ou déjà passé");
  }
  if (
    !input.currentStartsAt ||
    input.currentStartsAt.getTime() !== input.plannedStartsAt.getTime()
  ) {
    return cancelled("Horaire du rendez-vous modifié depuis la planification");
  }
  return OK;
}

// ───────────────────────── RG-M10-24.6 — QUOTE_FOLLOWUP ─────────────────────────

export type QuoteStatus = "DRAFT" | "SENT" | "VIEWED" | "ACCEPTED" | "DECLINED" | "EXPIRED";

/** RG-M10-24.6 — devis toujours `SENT`/`VIEWED`. */
export function revalidateQuoteFollowup(input: { status: QuoteStatus }): RevalidateOutcome {
  if (input.status !== "SENT" && input.status !== "VIEWED") {
    return cancelled("Le devis n'est plus en attente de réponse");
  }
  return OK;
}

// ───────────────────────── RG-M10-24.7 — VEHICLE_READY ─────────────────────────

/** RG-M10-24.7 — OR toujours `READY`. */
export function revalidateVehicleReady(input: { repairOrderStatus: string }): RevalidateOutcome {
  if (input.repairOrderStatus !== "READY") {
    return cancelled("L'ordre de réparation n'est plus au statut « Prêt »");
  }
  return OK;
}

// ───────────────────────── Dispatcher ─────────────────────────

export type RevalidateTypeInput =
  | { type: "INSPECTION"; data: RevalidateInspectionInput }
  | { type: "SERVICE"; data: RevalidateServiceInput }
  | { type: "RECEIVABLE"; data: RevalidateReceivableInput }
  | { type: "APPOINTMENT"; data: RevalidateAppointmentInput }
  | { type: "QUOTE_FOLLOWUP"; data: { status: QuoteStatus } }
  | { type: "VEHICLE_READY"; data: { repairOrderStatus: string } }
  | { type: "INSURANCE_EXPIRY" }
  | { type: "SATISFACTION" };

/**
 * RG-M10-24 — revérification complète juste avant l'envoi : motif 1 (client) toujours vérifié,
 * puis le motif spécifique au type (2-7). `INSURANCE_EXPIRY`/`SATISFACTION` n'ont pas de motif
 * dédié au-delà du client. Le motif 8 (fenêtre d'envoi / plafonds anti-spam) est géré par
 * `nextSendSlot` et `antiSpamAllows`, pas ici.
 */
export function revalidateBeforeSend(
  client: RevalidateClientInput,
  typeInput: RevalidateTypeInput,
): RevalidateOutcome {
  const clientCheck = revalidateClient(client);
  if (!clientCheck.ok) return clientCheck;

  switch (typeInput.type) {
    case "INSPECTION":
      return revalidateInspection(typeInput.data);
    case "SERVICE":
      return revalidateService(typeInput.data);
    case "RECEIVABLE":
      return revalidateReceivable(typeInput.data);
    case "APPOINTMENT":
      return revalidateAppointment(typeInput.data);
    case "QUOTE_FOLLOWUP":
      return revalidateQuoteFollowup(typeInput.data);
    case "VEHICLE_READY":
      return revalidateVehicleReady(typeInput.data);
    default:
      return OK;
  }
}
