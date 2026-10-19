import { describe, expect, it } from "vitest";
import { detectConflicts, type OccupancyLike } from "./conflicts";

function occ(partial: Partial<OccupancyLike> & { id: string }): OccupancyLike {
  return {
    bayId: "bay_1",
    mechanicId: null,
    startsAt: new Date("2026-10-24T09:00:00Z"),
    endsAt: new Date("2026-10-24T10:30:00Z"),
    blocking: true,
    overbooked: false,
    ...partial,
  };
}

describe("detectConflicts (RG-M03-02)", () => {
  it("détecte un chevauchement exact sur le même pont", () => {
    const existing = [occ({ id: "a" })];
    const conflict = detectConflicts(
      {
        bayId: "bay_1",
        startsAt: new Date("2026-10-24T09:30:00Z"),
        endsAt: new Date("2026-10-24T11:00:00Z"),
      },
      existing,
    );
    expect(conflict?.id).toBe("a");
  });

  it("autorise le bord à bord (09:00-10:30 puis 10:30-12:00)", () => {
    const existing = [occ({ id: "a" })];
    const conflict = detectConflicts(
      {
        bayId: "bay_1",
        startsAt: new Date("2026-10-24T10:30:00Z"),
        endsAt: new Date("2026-10-24T12:00:00Z"),
      },
      existing,
    );
    expect(conflict).toBeNull();
  });

  it("ignore les statuts non bloquants (CANCELLED/NO_SHOW)", () => {
    const existing = [occ({ id: "a", blocking: false })];
    const conflict = detectConflicts(
      {
        bayId: "bay_1",
        startsAt: new Date("2026-10-24T09:00:00Z"),
        endsAt: new Date("2026-10-24T10:30:00Z"),
      },
      existing,
    );
    expect(conflict).toBeNull();
  });

  it("ignore une occupation surréservée volontairement", () => {
    const existing = [occ({ id: "a", overbooked: true })];
    const conflict = detectConflicts(
      {
        bayId: "bay_1",
        startsAt: new Date("2026-10-24T09:00:00Z"),
        endsAt: new Date("2026-10-24T10:30:00Z"),
      },
      existing,
    );
    expect(conflict).toBeNull();
  });

  it("détecte un conflit sur le même mécanicien même si les ponts diffèrent", () => {
    const existing = [occ({ id: "a", bayId: "bay_1", mechanicId: "mech_1" })];
    const conflict = detectConflicts(
      {
        bayId: "bay_2",
        mechanicId: "mech_1",
        startsAt: new Date("2026-10-24T09:30:00Z"),
        endsAt: new Date("2026-10-24T10:00:00Z"),
      },
      existing,
    );
    expect(conflict?.id).toBe("a");
  });

  it("exclut le RDV lui-même lors d'une modification (excludeId)", () => {
    const existing = [occ({ id: "a" })];
    const conflict = detectConflicts(
      {
        excludeId: "a",
        bayId: "bay_1",
        startsAt: new Date("2026-10-24T09:00:00Z"),
        endsAt: new Date("2026-10-24T10:30:00Z"),
      },
      existing,
    );
    expect(conflict).toBeNull();
  });
});
