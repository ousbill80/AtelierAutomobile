// PWA — règles des notifications push : contenu envoyé à l'appareil et sort d'un abonnement
// après une tentative. Fonctions pures, sans horloge ni réseau.

/** Une notification n'est poussée que si elle est récente (pas de rafale au déploiement). */
export const PUSH_MAX_AGE_MINUTES = 120;
/** Au-delà de ce nombre d'échecs consécutifs, l'abonnement est abandonné. */
export const PUSH_MAX_FAILURES = 5;

const TITLE_MAX = 80;
const BODY_MAX = 180;

export interface PushableNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

export interface PushContent {
  title: string;
  body: string | null;
  link: string;
  tag: string;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Lien interne sûr : un chemin de l'application, jamais une URL externe. */
export function safeInternalLink(link: string | null | undefined): string {
  if (!link || !link.startsWith("/") || link.startsWith("//")) return "/notifications";
  return link;
}

export function buildPushContent(notification: PushableNotification): PushContent {
  return {
    title: clip(notification.title || "AtelierOS", TITLE_MAX),
    body: notification.body ? clip(notification.body, BODY_MAX) : null,
    link: safeInternalLink(notification.link),
    tag: `notification:${notification.id}`,
  };
}

export type PushAttemptStatus = "sent" | "gone" | "failed";

/** Suite à donner à un abonnement après une tentative d'envoi. */
export function subscriptionAfterAttempt(
  status: PushAttemptStatus,
  failureCount: number,
): { action: "keep"; failureCount: number } | { action: "delete" } {
  if (status === "sent") return { action: "keep", failureCount: 0 };
  if (status === "gone") return { action: "delete" };
  const next = failureCount + 1;
  return next >= PUSH_MAX_FAILURES ? { action: "delete" } : { action: "keep", failureCount: next };
}

/** Badge de la cloche : au-delà de 99, « 99+ ». */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
