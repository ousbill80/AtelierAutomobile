import { describe, expect, it } from "vitest";
import { summarizeSimulation } from "./simulate";

describe("summarizeSimulation", () => {
  it("compte chaque issue correctement", () => {
    const summary = summarizeSimulation([
      { rowNumber: 1, outcome: "create" },
      { rowNumber: 2, outcome: "create" },
      { rowNumber: 3, outcome: "update" },
      { rowNumber: 4, outcome: "unchanged" },
      { rowNumber: 5, outcome: "skip" },
      { rowNumber: 6, outcome: "error" },
    ]);

    expect(summary).toMatchObject({ create: 2, update: 1, unchanged: 1, skip: 1, error: 1 });
  });

  it("limite l'échantillon aux créations/mises à jour, à 20 maximum", () => {
    const results = Array.from({ length: 30 }, (_, i) => ({
      rowNumber: i + 1,
      outcome: "create" as const,
      before: undefined,
      after: { displayName: `Client ${i}` },
    }));

    const summary = summarizeSimulation(results);
    expect(summary.sample).toHaveLength(20);
    expect(summary.create).toBe(30);
  });

  it("exclut les lignes inchangées/ignorées/en erreur de l'échantillon", () => {
    const summary = summarizeSimulation([
      { rowNumber: 1, outcome: "unchanged" },
      { rowNumber: 2, outcome: "skip" },
      { rowNumber: 3, outcome: "error" },
    ]);
    expect(summary.sample).toEqual([]);
  });

  it("renvoie des compteurs à zéro pour une liste vide", () => {
    expect(summarizeSimulation([])).toEqual({
      create: 0,
      update: 0,
      unchanged: 0,
      skip: 0,
      error: 0,
      sample: [],
    });
  });
});
