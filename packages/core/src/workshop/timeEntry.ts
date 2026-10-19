// M06 RG-M06-05/06/07 — pointage d'une tâche : durée, pause, reprise, arrêt. États dérivés
// (RUNNING / PAUSED / STOPPED), jamais stockés (§5).

export interface TimeEntryLike {
  startedAt: Date;
  endedAt: Date | null;
  pauseMinutes: number;
  pausedAt: Date | null;
}

export type TimeEntryState = "RUNNING" | "PAUSED" | "STOPPED";

export type PauseReason = "parts" | "lunch" | "approval" | "other";
export const PAUSE_REASONS: readonly PauseReason[] = ["parts", "lunch", "approval", "other"];

export function timeEntryState(entry: Pick<TimeEntryLike, "endedAt" | "pausedAt">): TimeEntryState {
  if (entry.endedAt) return "STOPPED";
  return entry.pausedAt ? "PAUSED" : "RUNNING";
}

const MINUTE = 60_000;

/**
 * RG-M06-05 : `(endedAt − startedAt) − pauseMinutes`, arrondi à la minute inférieure, jamais
 * négatif. Une entrée ouverte compte jusqu'à `now`, moins la pause en cours.
 */
export function computeDurationMinutes(entry: TimeEntryLike, now: Date): number {
  const end = entry.endedAt ?? now;
  let ms = end.getTime() - entry.startedAt.getTime() - entry.pauseMinutes * MINUTE;
  if (!entry.endedAt && entry.pausedAt) {
    ms -= Math.max(0, now.getTime() - entry.pausedAt.getTime());
  }
  return Math.max(0, Math.floor(ms / MINUTE));
}

export type EntryPatch = Partial<Pick<TimeEntryLike, "endedAt" | "pauseMinutes" | "pausedAt">> & {
  pauseReason?: string | null;
};

/** RG-M06-07 `pause` : sans effet sur une entrée déjà en pause ou close. */
export function pauseEntry(entry: TimeEntryLike, at: Date, reason: PauseReason): EntryPatch | null {
  if (timeEntryState(entry) !== "RUNNING") return null;
  const pausedAt = at.getTime() < entry.startedAt.getTime() ? entry.startedAt : at;
  return { pausedAt, pauseReason: reason };
}

/** RG-M06-07 `resume` : `pauseMinutes += floor((at − pausedAt) / 60 s)`. */
export function resumeEntry(entry: TimeEntryLike, at: Date): EntryPatch | null {
  if (timeEntryState(entry) !== "PAUSED" || !entry.pausedAt) return null;
  const paused = Math.max(0, Math.floor((at.getTime() - entry.pausedAt.getTime()) / MINUTE));
  return { pauseMinutes: entry.pauseMinutes + paused, pausedAt: null, pauseReason: null };
}

/**
 * RG-M06-07 `stop` : une entrée en pause est close à `pausedAt` (le temps de pause terminal
 * n'est pas compté — la pause en cours n'est donc pas ajoutée à `pauseMinutes`, sinon elle
 * serait déduite deux fois). Une entrée close reste inchangée.
 */
export function stopEntry(entry: TimeEntryLike, at: Date): EntryPatch | null {
  const state = timeEntryState(entry);
  if (state === "STOPPED") return null;
  if (state === "PAUSED" && entry.pausedAt) {
    return { endedAt: entry.pausedAt, pausedAt: null };
  }
  const endedAt = at.getTime() < entry.startedAt.getTime() ? entry.startedAt : at;
  return { endedAt };
}

/** Durée d'une entrée en heures décimales (affichage, indicateurs). */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export interface OpenEntryRef extends TimeEntryLike {
  id: string;
}

export interface OverlapPlan {
  /** Entrées actives à mettre en pause au démarrage (RG-M06-06). */
  pause: { id: string; at: Date }[];
  /** Entrées closes qui chevauchent le nouveau départ : fin ramenée au départ (RG-M06-14). */
  truncate: { id: string; endedAt: Date }[];
  /** Si une entrée plus récente existe : la nouvelle entrée est close à son début. */
  incomingEndedAt: Date | null;
  needsReview: boolean;
}

/**
 * RG-M06-06 + RG-M06-14 — démarrage d'une entrée à `startedAt` pour un mécanicien ayant déjà
 * des entrées (ouvertes ou récentes) :
 * - entrée active démarrée avant → mise en pause à `startedAt` (une seule tâche active) ;
 * - entrée close après `startedAt` (chevauchement, synchro tardive) → close à `startedAt`,
 *   `needsReview` ;
 * - entrée démarrée après `startedAt` (la tablette synchronise un départ plus ancien) → la
 *   nouvelle entrée, plus ancienne, est close au début de la suivante, `needsReview`.
 */
export function planStartOverlap(existing: readonly OpenEntryRef[], startedAt: Date): OverlapPlan {
  const plan: OverlapPlan = { pause: [], truncate: [], incomingEndedAt: null, needsReview: false };
  const t = startedAt.getTime();
  for (const e of existing) {
    const s = e.startedAt.getTime();
    if (s > t) {
      if (!plan.incomingEndedAt || s < plan.incomingEndedAt.getTime()) {
        plan.incomingEndedAt = e.startedAt;
      }
      plan.needsReview = true;
      continue;
    }
    const state = timeEntryState(e);
    if (state === "RUNNING") plan.pause.push({ id: e.id, at: startedAt });
    else if (state === "STOPPED" && e.endedAt && e.endedAt.getTime() > t) {
      plan.truncate.push({ id: e.id, endedAt: startedAt });
      plan.needsReview = true;
    } else if (state === "PAUSED" && e.pausedAt && e.pausedAt.getTime() > t) {
      // Pause postérieure au nouveau départ : la plus ancienne est close au départ suivant.
      plan.truncate.push({ id: e.id, endedAt: startedAt });
      plan.needsReview = true;
    }
  }
  return plan;
}

/** RG-M06-16 : un mécanicien corrige seul sa propre entrée de moins de 15 min, une fois. */
export function canSelfCorrect(
  entry: TimeEntryLike & { selfCorrected?: boolean },
  now: Date,
): boolean {
  if (entry.selfCorrected) return false;
  return computeDurationMinutes(entry, now) < 15;
}
