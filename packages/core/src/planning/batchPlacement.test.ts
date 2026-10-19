import { describe, expect, it } from "vitest";
import { batchPlacement } from "./batchPlacement";

describe("batchPlacement (RG-M03-14, US-M03-12)", () => {
  it("répartit 4 véhicules sur des créneaux à 2 en parallèle max", () => {
    const result = batchPlacement({
      vehicleIds: ["v1", "v2", "v3", "v4"],
      availableSlots: [
        { startsAt: new Date("2026-10-24T08:00:00Z"), bayId: "bay_1" },
        { startsAt: new Date("2026-10-24T08:00:00Z"), bayId: "bay_2" },
        { startsAt: new Date("2026-10-24T09:00:00Z"), bayId: "bay_1" },
        { startsAt: new Date("2026-10-24T09:00:00Z"), bayId: "bay_2" },
      ],
    });
    expect(result.unplaced).toEqual([]);
    expect(result.placements).toHaveLength(4);
    expect(result.placements[0]).toEqual({
      vehicleId: "v1",
      startsAt: new Date("2026-10-24T08:00:00Z"),
      bayId: "bay_1",
    });
    expect(result.placements[1]).toEqual({
      vehicleId: "v2",
      startsAt: new Date("2026-10-24T08:00:00Z"),
      bayId: "bay_2",
    });
    expect(result.placements[2]?.startsAt).toEqual(new Date("2026-10-24T09:00:00Z"));
    expect(result.placements[3]?.startsAt).toEqual(new Date("2026-10-24T09:00:00Z"));
  });

  it("laisse les véhicules en trop dans unplaced faute de créneaux", () => {
    const result = batchPlacement({
      vehicleIds: ["v1", "v2", "v3"],
      availableSlots: [{ startsAt: new Date("2026-10-24T08:00:00Z"), bayId: "bay_1" }],
      maxParallel: 1,
    });
    expect(result.placements).toHaveLength(1);
    expect(result.unplaced).toEqual(["v2", "v3"]);
  });

  it("respecte un maxParallel personnalisé", () => {
    const result = batchPlacement({
      vehicleIds: ["v1", "v2", "v3"],
      availableSlots: [
        { startsAt: new Date("2026-10-24T08:00:00Z"), bayId: "bay_1" },
        { startsAt: new Date("2026-10-24T08:00:00Z"), bayId: "bay_2" },
        { startsAt: new Date("2026-10-24T08:00:00Z"), bayId: "bay_3" },
      ],
      maxParallel: 1,
    });
    expect(result.placements).toHaveLength(1);
    expect(result.unplaced).toEqual(["v2", "v3"]);
  });
});
