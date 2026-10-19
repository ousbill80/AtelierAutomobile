import { describe, expect, it } from "vitest";
import { batchPlacement } from "./batch";
import { halfDayWindows } from "./capacity";
import { instantAt } from "./opening-hours";

const TZ = "Africa/Abidjan";
const HOURS = { sat: [["08:00", "14:00"]] as [string, string][] };

describe("batchPlacement (US-M03-12)", () => {
  const windows = halfDayWindows(HOURS, instantAt("2026-10-24", "08:00", TZ), TZ);
  const bays = [
    { id: "lift-1", type: "LIFT" as const, isActive: true },
    { id: "lift-2", type: "LIFT" as const, isActive: true },
    { id: "lift-3", type: "LIFT" as const, isActive: true },
  ];

  it("répartit 4 véhicules, 2 en parallèle, sur des ponts distincts", () => {
    const result = batchPlacement({
      vehicleIds: ["v1", "v2", "v3", "v4"],
      type: "INSPECTION_PREP",
      durationMinutes: 60,
      stepMinutes: 30,
      windows,
      bays,
      appointments: [],
      maxParallel: 2,
    });
    expect(result.unplaced).toEqual([]);
    expect(
      result.placed.map((p) => [p.vehicleId, p.startsAt.toISOString().slice(11, 16), p.bayId]),
    ).toEqual([
      ["v1", "08:00", "lift-1"],
      ["v2", "08:00", "lift-2"],
      ["v3", "09:00", "lift-1"],
      ["v4", "09:00", "lift-2"],
    ]);
  });

  it("évite les ponts déjà occupés et signale les véhicules non placés", () => {
    const result = batchPlacement({
      vehicleIds: ["v1", "v2", "v3"],
      type: "SERVICE",
      durationMinutes: 360,
      stepMinutes: 30,
      windows,
      bays: bays.slice(0, 2),
      appointments: [
        {
          id: "a",
          bayId: "lift-1",
          mechanicId: null,
          startsAt: instantAt("2026-10-24", "08:00", TZ),
          endsAt: instantAt("2026-10-24", "14:00", TZ),
          status: "BOOKED",
        },
      ],
      maxParallel: 2,
    });
    expect(result.placed.map((p) => p.bayId)).toEqual(["lift-2"]);
    expect(result.unplaced).toEqual(["v2", "v3"]);
  });
});
