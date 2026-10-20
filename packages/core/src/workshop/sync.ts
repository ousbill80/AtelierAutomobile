// M06 RG-M06-13/14 — synchronisation de la tablette hors-ligne : correction d'horloge,
// idempotence, résolution de conflits (« serveur gagne sauf pointage », 01 §11).
import type { LineStatus } from "../repairOrders/types";

export const TECH_OP_TYPES = [
  "task.start",
  "task.pause",
  "task.resume",
  "task.complete",
  "note.add",
  "photo.attach",
  "inspection.setItem",
  "inspection.complete",
  "attendance.in",
  "attendance.out",
  "partRequest.create",
] as const;
export type TechOpType = (typeof TECH_OP_TYPES)[number];

/** Opérations de pointage : toujours acceptées, même sur une ligne annulée (temps réel passé). */
export const TIME_OPS: readonly TechOpType[] = ["task.start", "task.pause", "task.resume"];

/** RG-M06-13 : au plus 200 opérations par lot, dans l'ordre `seq`. */
export const SYNC_BATCH_SIZE = 200;

/** Écart d'horloge au-delà duquel une entrée est signalée si aucun décalage n'était connu (§11). */
export const CLOCK_SKEW_REVIEW_MS = 5 * 60_000;

export interface ClockCorrection {
  /** `serverNow − deviceNow` mesuré à cette synchro. */
  offsetMs: number;
  /** §11 : aucun décalage connu auparavant et écart > 5 min → entrées signalées. */
  suspicious: boolean;
}

export function measureClockOffset(
  serverNow: Date,
  deviceNow: Date,
  previousOffsetMs: number | null | undefined,
): ClockCorrection {
  const offsetMs = serverNow.getTime() - deviceNow.getTime();
  const suspicious =
    (previousOffsetMs === null || previousOffsetMs === undefined) &&
    Math.abs(offsetMs) > CLOCK_SKEW_REVIEW_MS;
  return { offsetMs, suspicious };
}

/**
 * RG-M06-14 : horodatage appareil corrigé du décalage ; un horodatage dans le futur serveur est
 * ramené à l'heure de réception.
 */
export function correctTimestamp(deviceAt: Date, offsetMs: number, serverNow: Date): Date {
  const corrected = deviceAt.getTime() + offsetMs;
  return new Date(Math.min(corrected, serverNow.getTime()));
}

export type OpDecision =
  { action: "apply"; needsReview: boolean } | { action: "reject"; message: string };

export const CANCELLED_TASK_MESSAGE = "Tâche annulée par le bureau. Votre temps a été enregistré.";

/**
 * RG-M06-14 — décision pour une opération sur une ligne d'OR selon son statut serveur :
 * pointages acceptés même si la ligne est annulée (`needsReview`), changement de statut
 * (« Terminer ») refusé sur une ligne annulée.
 */
export function decideLineOp(type: TechOpType, lineStatus: LineStatus): OpDecision {
  if (lineStatus !== "CANCELLED") return { action: "apply", needsReview: false };
  if (TIME_OPS.includes(type)) return { action: "apply", needsReview: true };
  return { action: "reject", message: CANCELLED_TASK_MESSAGE };
}

/** RG-M06-14 « dernier écrit gagne par point » : `incomingAt` doit être ≥ au dernier écrit. */
export function lastWriteWins(lastWriteAt: Date | null | undefined, incomingAt: Date): boolean {
  return !lastWriteAt || incomingAt.getTime() >= lastWriteAt.getTime();
}

/** Ordonne un lot par `seq` croissant et coupe à 200 (les suivants partent au lot d'après). */
export function orderSyncBatch<T extends { seq: number }>(ops: readonly T[]): T[] {
  return [...ops].sort((a, b) => a.seq - b.seq).slice(0, SYNC_BATCH_SIZE);
}

/** RG-M06-13 : fenêtre du cache local — tâches des OR ouverts du site, au plus 7 jours. */
export const OFFLINE_CACHE_DAYS = 7;
