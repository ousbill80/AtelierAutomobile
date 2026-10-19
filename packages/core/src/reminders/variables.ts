// M10 §7 — petits formateurs purs utilisés par l'aperçu des relances (routeur `reminders`) et le
// rendu des gabarits (Annexe A : `{{client.salutation}}`, `{{vt.joursRestants}}`, etc.). Logique
// métier pure, testée, conformément à CLAUDE.md (jamais calculé directement dans le routeur).

import { formatFCFA } from "../money";
import { formatDate } from "../calendar";

export type Civility = "M" | "MME" | "MLLE";

export interface SalutationInput {
  type: "INDIVIDUAL" | "COMPANY";
  civility?: Civility | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  displayName: string;
}

const CIVILITY_LABEL: Record<Civility, string> = {
  M: "M.",
  MME: "Mme",
  MLLE: "Mlle",
};

/**
 * `{{client.salutation}}` — vouvoiement (Annexe A) : "M. Koné" / "Mme Bamba" pour un particulier
 * avec civilité connue ; nom affiché sinon (particulier sans civilité ou entreprise).
 */
export function customerSalutation(customer: SalutationInput): string {
  if (customer.type === "COMPANY") {
    return customer.companyName?.trim() || customer.displayName;
  }
  if (customer.civility && customer.lastName?.trim()) {
    return `${CIVILITY_LABEL[customer.civility]} ${customer.lastName.trim()}`;
  }
  return customer.displayName;
}

/**
 * Compte à rebours jusqu'à une échéance (VT §7.2) : "J-15" (futur), "Aujourd'hui" (jour J),
 * "Expirée depuis 6 j" (passé). `anchor`/`today` comparés en jours civils (minuit, même fuseau).
 */
export function describeDueCountdown(anchor: Date, today: Date): string {
  const days = Math.round((anchor.getTime() - today.getTime()) / 86_400_000);
  if (days > 0) return `J-${days}`;
  if (days === 0) return "Aujourd'hui";
  const overdue = Math.abs(days);
  return `Expirée depuis ${overdue} j`;
}

/** Nombre de jours de retard (positif) d'une échéance passée ; 0 si non échue. */
export function lateDays(dueDate: Date, today: Date): number {
  const days = Math.round((today.getTime() - dueDate.getTime()) / 86_400_000);
  return days > 0 ? days : 0;
}

export interface ReceivableSummaryInput {
  invoiceCount: number;
  totalAmount: number;
  oldestDueDate: Date;
  today: Date;
}

/** `{{creance.resume}}` — "4 factures — 412 000 FCFA, retard 38 j" (carte §7.1). */
export function receivablesSummary(input: ReceivableSummaryInput): string {
  const { invoiceCount, totalAmount, oldestDueDate, today } = input;
  const invoiceWord = invoiceCount === 1 ? "facture" : "factures";
  const retard = lateDays(oldestDueDate, today);
  const retardSuffix = retard > 0 ? `, retard ${retard} j` : "";
  return `${invoiceCount} ${invoiceWord} — ${formatFCFA(totalAmount)}${retardSuffix}`;
}

export interface VehicleDueLine {
  label: string; // "Toyota Hilux 3315 KL 01"
  dueDate: Date;
}

/**
 * `{{vehicules.liste}}` — une ligne par véhicule (Annexe A `vt_multi`) :
 * "• Toyota Hilux 3315 KL 01 : expire le 05/11/2026".
 */
export function formatVehicleDueList(
  vehicles: readonly VehicleDueLine[],
  timeZone: string,
): string {
  return vehicles
    .map((v) => `• ${v.label} : expire le ${formatDate(v.dueDate, timeZone)}`)
    .join("\n");
}
