// RG-M17-08 — disjoncteur : 5 erreurs en 1 min → fonctions IA « indisponibles » 5 min.
// État immuable, horloge injectée : l'appelant conserve l'état (mémoire du process).

export interface CircuitState {
  failures: number[]; // horodatages (ms) des erreurs récentes
  openUntil: number | null;
}

export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_WINDOW_MS = 60_000;
export const CIRCUIT_OPEN_MS = 5 * 60_000;

export const CLOSED_CIRCUIT: CircuitState = { failures: [], openUntil: null };

export function isCircuitOpen(state: CircuitState, now: Date): boolean {
  return state.openUntil !== null && now.getTime() < state.openUntil;
}

export function recordCircuitFailure(state: CircuitState, now: Date): CircuitState {
  const t = now.getTime();
  const failures = [...state.failures.filter((f) => t - f < CIRCUIT_WINDOW_MS), t];
  if (failures.length >= CIRCUIT_FAILURE_THRESHOLD) {
    return { failures: [], openUntil: t + CIRCUIT_OPEN_MS };
  }
  return { failures, openUntil: isCircuitOpen(state, now) ? state.openUntil : null };
}

export function recordCircuitSuccess(state: CircuitState, now: Date): CircuitState {
  return isCircuitOpen(state, now) ? state : CLOSED_CIRCUIT;
}
