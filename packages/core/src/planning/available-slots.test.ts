import { describe, expect, it } from "vitest";
import { availableSlots, spreadEvenly, type AvailableSlotsInput } from "./available-slots";
import { instantAt } from "./opening-hours";

const TZ = "Africa/Abidjan";
const at = (day: string, time: string) => instantAt(day, time, TZ);
const HOURS = {
  mon: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ] as [string, string][],
  tue: [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ] as [string, string][],
  sat: [["08:00", "14:00"]] as [string, string][],
  sun: [] as [string, string][],
};

function baseInput(over: Partial<AvailableSlotsInput> = {}): AvailableSlotsInput {
  return {
    from: at("2026-10-24", "00:00"), // samedi
    now: at("2026-10-24", "07:00"),
    days: 1,
    timeZone: TZ,
    openingHours: HOURS,
    type: "SERVICE",
    durationMinutes: 90,
    stepMinutes: 30,
    minLeadMinutes: 120,
    bays: [
      { id: "lift-1", type: "LIFT", isActive: true },
      { id: "diag", type: "DIAGNOSTIC", isActive: true },
    ],
    appointments: [],
    requireBay: true,
    mechanicIds: ["m1", "m2"],
    productivityRate: 0.85,
    maxAppointmentsPerHalfDay: null,
    ...over,
  };
}

describe("availableSlots (RG-M03-07)", () => {
  it("respecte le délai minimum de 2 h et la fin de plage", () => {
    const result = availableSlots(baseInput());
    expect(result).toHaveLength(1);
    const times = result[0]!.slots.map((s) => s.startsAt.toISOString().slice(11, 16));
    // now 07:00 + 2 h = 09:00 ; dernier début possible 12:30 (12:30 + 1 h 30 = 14:00)
    expect(times[0]).toBe("09:00");
    expect(times[times.length - 1]).toBe("12:30");
    expect(result[0]!.slots.every((s) => s.bayId === "lift-1")).toBe(true);
  });

  it("n'utilise qu'un pont compatible (DIAGNOSTIC → pont diagnostic)", () => {
    const result = availableSlots(baseInput({ type: "DIAGNOSTIC", durationMinutes: 60 }));
    expect(result[0]!.slots.every((s) => s.bayId === "diag")).toBe(true);
  });

  it("exclut les créneaux dont le pont est pris et un jour férié ; respecte l'horizon", () => {
    const result = availableSlots(
      baseInput({
        days: 3, // sam, dim (fermé), lun
        appointments: [
          {
            id: "a",
            bayId: "lift-1",
            mechanicId: null,
            startsAt: at("2026-10-24", "09:00"),
            endsAt: at("2026-10-24", "14:00"),
            status: "CONFIRMED",
          },
        ],
        holidays: [{ date: new Date("2026-10-26T00:00:00Z"), siteId: null }],
      }),
    );
    // samedi : pont occupé toute la matinée → aucun créneau ; dimanche fermé ; lundi férié.
    expect(result).toEqual([]);
  });

  it("limite à 6 créneaux par demi-journée répartis uniformément (portail)", () => {
    const result = availableSlots(baseInput({ maxPerHalfDay: 6, stepMinutes: 15 }));
    expect(result[0]!.slots).toHaveLength(6);
    const first = result[0]!.slots[0]!.startsAt.toISOString().slice(11, 16);
    const last = result[0]!.slots[5]!.startsAt.toISOString().slice(11, 16);
    expect(first).toBe("09:00");
    expect(last).toBe("12:30");
  });

  it("limite le nombre total de créneaux (assistant « 10 prochains »)", () => {
    const result = availableSlots(baseInput({ days: 3, limit: 10, stepMinutes: 15 }));
    const count = result.reduce((n, r) => n + r.slots.length, 0);
    expect(count).toBe(10);
  });

  it("sans pont exigé, renvoie des créneaux « à affecter » tant que la capacité suffit", () => {
    const result = availableSlots(
      baseInput({
        requireBay: false,
        appointments: [
          {
            id: "a",
            bayId: "lift-1",
            mechanicId: null,
            startsAt: at("2026-10-24", "09:00"),
            endsAt: at("2026-10-24", "14:00"),
            status: "CONFIRMED",
          },
        ],
      }),
    );
    expect(result[0]!.slots.length).toBeGreaterThan(0);
    expect(result[0]!.slots[0]!.bayId).toBeNull();
  });

  it("ne propose rien quand la demi-journée est à capacité", () => {
    const result = availableSlots(
      baseInput({
        requireBay: false,
        mechanicIds: ["m1"],
        productivityRate: 1,
        appointments: [
          {
            id: "a",
            bayId: null,
            mechanicId: null,
            startsAt: at("2026-10-24", "08:00"),
            endsAt: at("2026-10-24", "13:00"),
            status: "BOOKED",
          },
        ],
      }),
    );
    expect(result).toEqual([]);
  });

  it("exclut les créneaux où le mécanicien demandé est pris", () => {
    const result = availableSlots(
      baseInput({
        mechanicId: "m1",
        appointments: [
          {
            id: "a",
            bayId: "diag",
            mechanicId: "m1",
            startsAt: at("2026-10-24", "09:00"),
            endsAt: at("2026-10-24", "11:00"),
            status: "BOOKED",
          },
        ],
      }),
    );
    const times = result[0]!.slots.map((s) => s.startsAt.toISOString().slice(11, 16));
    expect(times[0]).toBe("11:00");
  });
});

describe("spreadEvenly", () => {
  it("répartit uniformément en gardant les extrémités", () => {
    expect(spreadEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 6)).toEqual([1, 3, 5, 7, 9, 11]);
    expect(spreadEvenly([1, 2, 3], 6)).toEqual([1, 2, 3]);
    expect(spreadEvenly([1, 2, 3], 1)).toEqual([1]);
  });
});
