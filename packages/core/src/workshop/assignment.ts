// M06 RG-M06-04 — score d'affectation suggérée. Fonction pure ; M17 pourra affiner, l'humain
// valide toujours.
import { openIntervalsForDay, type OpeningContext } from "../planning/openingHours";
import { localDateKey, localMinutes } from "../planning/time";

export interface AssignmentCandidate {
  membershipId: string;
  skills: readonly string[];
  /** Présent : `Attendance.clockIn` du jour sans `clockOut`. */
  present: boolean;
  /** Σ heures barème des lignes LABOR affectées non DONE/CANCELLED des OR ouverts du site. */
  remainingLoadHours: number;
  /** Déjà affecté à une autre ligne de cet OR. */
  alreadyOnOrder: boolean;
}

export type AssignmentReason = "skill_ok" | "skill_missing" | "absent" | "on_order" | "overloaded";

export interface AssignmentScore {
  membershipId: string;
  score: number;
  skillMatch: boolean;
  loadRatio: number;
  reasons: AssignmentReason[];
}

/** Heures ouvertes restantes aujourd'hui (fermeture du site), minimum 0,5 (RG-M06-04). */
export function availableHoursToday(now: Date, ctx: OpeningContext): number {
  const dateKey = localDateKey(now, ctx.timeZone);
  const minutesNow = localMinutes(now, ctx.timeZone);
  const remaining = openIntervalsForDay(dateKey, ctx).reduce(
    (sum, [from, to]) => sum + Math.max(0, to - Math.max(from, minutesNow)),
    0,
  );
  return Math.max(0.5, remaining / 60);
}

export function hasSkill(skills: readonly string[], requiredSkill: string | null | undefined) {
  if (!requiredSkill) return true;
  const needle = requiredSkill.trim().toLowerCase();
  return skills.some((s) => s.trim().toLowerCase() === needle);
}

/**
 * `score = 100 × skillMatch − 40 × loadRatio + 15 × (déjà sur l'OR) − 100 × (absent)` avec
 * `loadRatio = min(charge / heures disponibles, 2)`.
 */
export function scoreAssignment(
  candidate: AssignmentCandidate,
  requiredSkill: string | null | undefined,
  availableHours: number,
): AssignmentScore {
  const skillMatch = hasSkill(candidate.skills, requiredSkill);
  const hours = Math.max(0.5, availableHours);
  const loadRatio = Math.min(candidate.remainingLoadHours / hours, 2);
  const raw =
    100 * (skillMatch ? 1 : 0) -
    40 * loadRatio +
    15 * (candidate.alreadyOnOrder ? 1 : 0) -
    100 * (candidate.present ? 0 : 1);
  const reasons: AssignmentReason[] = [skillMatch ? "skill_ok" : "skill_missing"];
  if (!candidate.present) reasons.push("absent");
  if (candidate.alreadyOnOrder) reasons.push("on_order");
  if (loadRatio >= 1) reasons.push("overloaded");
  return {
    membershipId: candidate.membershipId,
    score: Math.round(raw * 10) / 10,
    skillMatch,
    loadRatio,
    reasons,
  };
}

/** Mécaniciens classés par score décroissant (top `limit`, défaut 5 — §8 suggestAssignees). */
export function rankAssignees(
  candidates: readonly AssignmentCandidate[],
  requiredSkill: string | null | undefined,
  availableHours: number,
  limit = 5,
): AssignmentScore[] {
  return candidates
    .map((c) => scoreAssignment(c, requiredSkill, availableHours))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
