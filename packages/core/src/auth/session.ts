// RG-M01-06 : session web = expiration après 7 jours d'inactivité, durée absolue 30 jours.
// Session PIN d'atelier = 12 h, limitée aux routes (tech).

export const SESSION_INACTIVITY_DAYS = 7;
export const SESSION_ABSOLUTE_DAYS = 30;
export const PIN_SESSION_DURATION_HOURS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface SessionRecord {
  createdAt: Date;
  lastActiveAt: Date;
  isPinSession: boolean;
}

/** Expiration absolue à l'ouverture de session (stockée en base, indépendante de l'activité). */
export function computeSessionAbsoluteExpiry(now: Date, isPinSession: boolean): Date {
  const durationMs = isPinSession
    ? PIN_SESSION_DURATION_HOURS * HOUR_MS
    : SESSION_ABSOLUTE_DAYS * DAY_MS;
  return new Date(now.getTime() + durationMs);
}

/** Vrai si la session est périmée : durée absolue dépassée, ou inactivité (sessions web uniquement). */
export function isSessionExpired(session: SessionRecord, now: Date): boolean {
  const absoluteDurationMs = session.isPinSession
    ? PIN_SESSION_DURATION_HOURS * HOUR_MS
    : SESSION_ABSOLUTE_DAYS * DAY_MS;
  if (now.getTime() - session.createdAt.getTime() > absoluteDurationMs) {
    return true;
  }

  if (!session.isPinSession) {
    const inactivityLimitMs = SESSION_INACTIVITY_DAYS * DAY_MS;
    if (now.getTime() - session.lastActiveAt.getTime() > inactivityLimitMs) {
      return true;
    }
  }

  return false;
}
