// Libellés français et petits utilitaires partagés par les écrans du module M10 (relances) :
// /relances, /relances/echeances, /parametres/relances et les blocs « Relances » des fiches
// client/véhicule. Regroupés ici pour éviter de dupliquer ces constantes dans chaque fichier.

export const REMINDER_TYPE_LABELS: Record<string, string> = {
  INSPECTION: "Visite technique",
  SERVICE: "Révision",
  RECEIVABLE: "Créance",
  APPOINTMENT: "Rendez-vous",
  QUOTE_FOLLOWUP: "Suivi de devis",
  VEHICLE_READY: "Véhicule prêt",
  INSURANCE_EXPIRY: "Assurance",
  SATISFACTION: "Satisfaction",
  RECOMMENDED_WORK: "Travaux recommandés",
  CUSTOM: "Personnalisée",
};

export const REMINDER_CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "Email",
};

// Pas de `Record<string, string>` ici (contrairement aux autres libellés de ce fichier) : la
// page /relances dérive son type `Tab` des clés de cet objet (`keyof typeof`), qui doit donc
// rester un littéral.
export const REMINDER_TAB_LABELS = {
  TO_APPROVE: "À valider",
  PLANNED_TODAY: "Planifiées aujourd'hui",
  SENT_TODAY: "Envoyées aujourd'hui",
  FAILED: "Échecs",
  TO_CALL: "À appeler",
  EXPIRED: "Expirées",
} as const;

export const REMINDER_STOP_EVENT_LABELS: Record<string, string> = {
  "appointment.created": "RDV créé",
  "appointment.cancelled": "RDV annulé",
  "appointment.updated": "RDV modifié",
  "repair_order.created": "OR créé",
  "vehicle.inspection_updated": "VT mise à jour",
  "vehicle.service_recorded": "Révision enregistrée",
  "vehicle.owner_changed": "Changement de propriétaire",
  "vehicle.insurance_updated": "Assurance mise à jour",
  "payment.received": "Paiement reçu",
  "collection.promised": "Promesse de paiement",
  "collection.disputed": "Créance contestée",
  "collection.paused": "Relance de créance en pause",
  "quote.accepted": "Devis accepté",
  "quote.declined": "Devis refusé",
  "quote.expired": "Devis expiré",
  "repair_order.status_changed": "Statut de l'OR changé",
  "message.inbound_received": "Message reçu du client",
  "customer.updated": "Client mis à jour",
};

export const DUE_DATES_FILTER_LABELS: Record<string, string> = {
  ALL: "Tout",
  UPCOMING: "À venir",
  EXPIRED: "Expirées",
  MISSING_DATA: "Données manquantes",
};

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("fr-FR");
}

/** Dérive un statut d'échéance simple côté client (RG-M02-12/§5) à partir d'une date. */
export function computeDueStatus(date: Date | string | null | undefined): {
  status: "UNKNOWN" | "OK" | "DUE_SOON" | "EXPIRED";
  daysRemaining: number | null;
} {
  if (!date) return { status: "UNKNOWN", daysRemaining: null };
  const d = typeof date === "string" ? new Date(date) : date;
  const days = Math.floor((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { status: "EXPIRED", daysRemaining: days };
  if (days <= 30) return { status: "DUE_SOON", daysRemaining: days };
  return { status: "OK", daysRemaining: days };
}
