// RG-M01-05 — verrouillage de compte après échecs de connexion consécutifs.
// La limitation par IP (20 tentatives / 15 min toutes identités confondues) est un
// compteur glissant générique géré côté infra (Redis), hors périmètre de ce module.

export const LOCKOUT_FAILURE_THRESHOLD = 5;
export const LOCKOUT_DURATION_MINUTES = 15;
export const RECIDIVE_LOCKOUT_DURATION_MINUTES = 60;

export interface LockoutState {
  failedLoginCount: number;
  lockCount: number;
  lockedUntil: Date | null;
}

export const INITIAL_LOCKOUT_STATE: LockoutState = {
  failedLoginCount: 0,
  lockCount: 0,
  lockedUntil: null,
};

/** Vrai si le compte est actuellement verrouillé à l'instant `now`. */
export function isLocked(state: Pick<LockoutState, "lockedUntil">, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * RG-M01-05 — à appeler après un échec de connexion (compte non verrouillé).
 * Au 5e échec consécutif : verrou 15 min. Une récidive (un seul nouvel échec après
 * déverrouillage, sans connexion réussie entre-temps) verrouille immédiatement 1 h.
 */
export function recordFailedLogin(state: LockoutState, now: Date): LockoutState {
  if (state.lockCount >= 1) {
    return {
      failedLoginCount: 0,
      lockCount: state.lockCount + 1,
      lockedUntil: new Date(now.getTime() + RECIDIVE_LOCKOUT_DURATION_MINUTES * 60_000),
    };
  }

  const failedLoginCount = state.failedLoginCount + 1;
  if (failedLoginCount < LOCKOUT_FAILURE_THRESHOLD) {
    return { ...state, failedLoginCount };
  }

  return {
    failedLoginCount: 0,
    lockCount: 1,
    lockedUntil: new Date(now.getTime() + LOCKOUT_DURATION_MINUTES * 60_000),
  };
}

/** RG-M01-05 — une connexion réussie remet le compteur d'échecs et la récidive à zéro. */
export function recordSuccessfulLogin(): LockoutState {
  return { ...INITIAL_LOCKOUT_STATE };
}
