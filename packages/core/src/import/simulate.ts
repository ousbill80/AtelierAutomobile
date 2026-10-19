import type { RowOutcome } from "./policy";

/**
 * RG-M13-23 — agrège les résultats par ligne (déjà calculés par
 * `mergeFields`/`hasBlockingError` pour chaque ligne) en compteurs de
 * simulation, plus un échantillon de changements avant/après.
 */

export interface SimulatedRowResult {
  rowNumber: number;
  outcome: RowOutcome | "error";
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface SimulationCounts {
  create: number;
  update: number;
  unchanged: number;
  skip: number;
  error: number;
}

export interface SimulationSummary extends SimulationCounts {
  sample: SimulatedRowResult[];
}

const SAMPLE_SIZE = 20;

/** RG-M13-23 — agrège les résultats de simulation (dryRun, aucune écriture). */
export function summarizeSimulation(results: readonly SimulatedRowResult[]): SimulationSummary {
  const counts: SimulationCounts = { create: 0, update: 0, unchanged: 0, skip: 0, error: 0 };

  for (const result of results) {
    counts[result.outcome] += 1;
  }

  const sample = results
    .filter((result) => result.outcome === "create" || result.outcome === "update")
    .slice(0, SAMPLE_SIZE);

  return { ...counts, sample };
}
