// RG-M04-19 — statuts publics (portail, messages) et frise de suivi (US-M04-16).
import type { RepairOrderStatus } from "./types";

export type PublicStep =
  | "RECEIVED"
  | "DIAGNOSING"
  | "AWAITING_APPROVAL"
  | "IN_REPAIR"
  | "WAITING_PARTS"
  | "QUALITY_CHECK"
  | "READY"
  | "DELIVERED";

export const PUBLIC_STATUS_LABELS: Record<PublicStep, string> = {
  RECEIVED: "Reçu",
  DIAGNOSING: "Diagnostic en cours",
  AWAITING_APPROVAL: "En attente de votre accord",
  IN_REPAIR: "En réparation",
  WAITING_PARTS: "En attente de pièces",
  QUALITY_CHECK: "Contrôle final",
  READY: "Prêt",
  DELIVERED: "Restitué",
};

export function publicStep(status: RepairOrderStatus): PublicStep | null {
  switch (status) {
    case "CHECKED_IN":
      return "RECEIVED";
    case "DIAGNOSING":
      return "DIAGNOSING";
    case "AWAITING_APPROVAL":
      return "AWAITING_APPROVAL";
    case "APPROVED":
    case "IN_PROGRESS":
      return "IN_REPAIR";
    case "WAITING_PARTS":
      return "WAITING_PARTS";
    case "QUALITY_CHECK":
      return "QUALITY_CHECK";
    case "READY":
      return "READY";
    case "DELIVERED":
    case "INVOICED":
      return "DELIVERED";
    default:
      return null;
  }
}

/** Frise publique : Reçu → Diagnostic → Accord → Réparation → Contrôle → Prêt. */
export const PUBLIC_TIMELINE: readonly PublicStep[] = [
  "RECEIVED",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "IN_REPAIR",
  "QUALITY_CHECK",
  "READY",
];

/** Index de l'étape courante dans la frise (attente pièces = réparation ; restitué = fin). */
export function timelineIndex(status: RepairOrderStatus): number {
  const step = publicStep(status);
  if (!step) return -1;
  if (step === "WAITING_PARTS") return PUBLIC_TIMELINE.indexOf("IN_REPAIR");
  if (step === "DELIVERED") return PUBLIC_TIMELINE.length;
  return PUBLIC_TIMELINE.indexOf(step);
}
