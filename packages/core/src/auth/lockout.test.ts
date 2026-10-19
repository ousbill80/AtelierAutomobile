import { describe, expect, it } from "vitest";
import {
  INITIAL_LOCKOUT_STATE,
  isLocked,
  LOCKOUT_DURATION_MINUTES,
  RECIDIVE_LOCKOUT_DURATION_MINUTES,
  recordFailedLogin,
  recordSuccessfulLogin,
} from "./lockout";

describe("recordFailedLogin — RG-M01-05", () => {
  it("n'enclenche pas de verrou avant le 5e échec", () => {
    let state = INITIAL_LOCKOUT_STATE;
    const now = new Date("2026-10-18T10:00:00Z");
    for (let i = 0; i < 4; i++) {
      state = recordFailedLogin(state, now);
    }
    expect(state.failedLoginCount).toBe(4);
    expect(state.lockedUntil).toBeNull();
    expect(isLocked(state, now)).toBe(false);
  });

  it("verrouille 15 minutes au 5e échec consécutif", () => {
    let state = INITIAL_LOCKOUT_STATE;
    const now = new Date("2026-10-18T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      state = recordFailedLogin(state, now);
    }
    expect(state.failedLoginCount).toBe(0);
    expect(state.lockCount).toBe(1);
    expect(state.lockedUntil).toEqual(new Date(now.getTime() + LOCKOUT_DURATION_MINUTES * 60_000));
    expect(isLocked(state, now)).toBe(true);
    expect(isLocked(state, new Date(now.getTime() + 16 * 60_000))).toBe(false);
  });

  it("un nouvel échec après déverrouillage sans succès intermédiaire verrouille 1 h (récidive)", () => {
    let state = INITIAL_LOCKOUT_STATE;
    const firstAttempt = new Date("2026-10-18T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      state = recordFailedLogin(state, firstAttempt);
    }
    const afterUnlock = new Date(firstAttempt.getTime() + 20 * 60_000);
    state = recordFailedLogin(state, afterUnlock);
    expect(state.lockCount).toBe(2);
    expect(state.lockedUntil).toEqual(
      new Date(afterUnlock.getTime() + RECIDIVE_LOCKOUT_DURATION_MINUTES * 60_000),
    );
  });

  it("une connexion réussie remet le compteur et la récidive à zéro", () => {
    let state = INITIAL_LOCKOUT_STATE;
    const now = new Date("2026-10-18T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      state = recordFailedLogin(state, now);
    }
    state = recordSuccessfulLogin();
    expect(state).toEqual(INITIAL_LOCKOUT_STATE);
  });
});
