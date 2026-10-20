// M14 §4.4 — suivi d'OR : contenu visible (RG-M14-17), version pour le temps réel (RG-M14-18).

/** RG-M14-17 : photos partagées avec le client (réception, dégâts, inspection, travaux). */
export const PORTAL_PHOTO_KINDS = [
  "photo_checkin",
  "photo_damage",
  "photo_inspection",
  "photo_work",
] as const;

/**
 * Empreinte de l'état visible d'un OR : le flux SSE n'envoie un événement `update` que quand elle
 * change (statut, promesse, photos, remarques, devis, facture).
 */
export function trackingVersion(input: {
  status: string;
  updatedAt: Date;
  promisedAt: Date | null;
  photoCount: number;
  noteCount: number;
  quoteStates: readonly string[];
  invoiceStates: readonly string[];
}): string {
  return [
    input.status,
    input.updatedAt.getTime(),
    input.promisedAt?.getTime() ?? "-",
    input.photoCount,
    input.noteCount,
    input.quoteStates.join(","),
    input.invoiceStates.join(","),
  ].join("|");
}

/** RG-M14-18 : SSE avec repli polling 30 s ; connexion coupée après 10 min d'onglet inactif. */
export const TRACKING_POLL_INTERVAL_MS = 30_000;
export const TRACKING_IDLE_DISCONNECT_MS = 10 * 60_000;
/** Contrôle côté serveur de l'empreinte pendant une connexion SSE. */
export const TRACKING_SERVER_CHECK_MS = 5_000;
/** Durée maximale d'une connexion SSE (le navigateur se reconnecte s'il est encore actif). */
export const TRACKING_STREAM_MAX_MS = 10 * 60_000;

/** RG-M14-17 : résultat d'inspection sans la mesure si `showMeasurements = false`. */
export function publicMeasurement(
  measurement: string | null | undefined,
  showMeasurements: boolean,
): string | null {
  return showMeasurements && measurement ? measurement : null;
}

/** Statuts de devis montrés dans l'espace OR (un brouillon n'est jamais visible). */
export const PORTAL_VISIBLE_QUOTE_STATUSES = [
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "CONVERTED",
] as const;

/** Statuts de facture montrés au client (jamais un brouillon). */
export const PORTAL_VISIBLE_INVOICE_STATUSES = [
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "DISPUTED",
  "WRITTEN_OFF",
] as const;

/** Devis « en attente de votre accord » : envoyé ou consulté, non décidé. */
export function isQuoteAwaitingDecision(status: string): boolean {
  return status === "SENT" || status === "VIEWED";
}
