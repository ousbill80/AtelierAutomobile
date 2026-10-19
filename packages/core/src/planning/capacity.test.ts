import { describe, expect, it } from "vitest";
import { canAcceptAppointment, computeCapacity, halfDayWindows, occupancyRate } from "./capacity";
import { instantAt } from "./opening-hours";
import type { AppointmentLike } from "./types";

const TZ = "Africa/Abidjan";
const at = (time: string, day = "2026-10-24") => instantAt(day, time, TZ);
const HOURS = {
  sat: [["08:00", "14:00"]] as [string, string][],
  mon: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ] as [string, string][],
};

describe("halfDayWindows", () => {
  it("samedi 08:00-14:00 = une seule demi-journée AM", () => {
    const windows = halfDayWindows(HOURS, at("09:00"), TZ);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ date: "2026-10-24", halfDay: "AM" });
  });
  it("lundi = AM (07:30-12:30) et PM (13:30-18:00)", () => {
    const windows = halfDayWindows(HOURS, at("09:00", "2026-10-26"), TZ);
    expect(windows.map((w) => w.halfDay)).toEqual(["AM", "PM"]);
    expect(windows[1]!.start.toISOString()).toBe("2026-10-26T13:30:00.000Z");
  });
});

describe("computeCapacity (RG-M03-05)", () => {
  const window = halfDayWindows(HOURS, at("09:00"), TZ)[0]!;
  const mechanics = ["m1", "m2", "m3"];
  const booked = (id: string, start: string, end: string): AppointmentLike => ({
    id,
    bayId: "b1",
    mechanicId: null,
    startsAt: at(start),
    endsAt: at(end),
    status: "BOOKED",
  });

  it("3 mécaniciens × 6 h × 0,85 = 15 h 18 (918 min)", () => {
    const capacity = computeCapacity({
      window,
      mechanicIds: mechanics,
      productivityRate: 0.85,
      appointments: [],
      maxAppointmentsPerHalfDay: null,
      activeBayCount: 3,
    });
    expect(capacity.capacityMinutes).toBe(918);
    expect(capacity.maxAppointments).toBe(6);
    expect(capacity.mechanicsPresent).toBe(3);
  });

  it("12 h réservées : un REPAIR de 2 h accepté, un second refusé", () => {
    const base = {
      window,
      mechanicIds: mechanics,
      productivityRate: 0.85,
      maxAppointmentsPerHalfDay: 10,
      activeBayCount: 3,
    };
    const twelveHours = [booked("a", "08:00", "14:00"), booked("b", "08:00", "14:00")];
    const first = computeCapacity({ ...base, appointments: twelveHours });
    expect(first.loadMinutes).toBe(720);
    expect(canAcceptAppointment(first, 120)).toEqual({ ok: true });
    const second = computeCapacity({
      ...base,
      appointments: [...twelveHours, booked("c", "08:00", "10:00")],
    });
    expect(canAcceptAppointment(second, 120)).toEqual({ ok: false, reason: "CAPACITY_EXCEEDED" });
  });

  it("ignore les RDV annulés et tronque ceux qui débordent de la fenêtre", () => {
    const capacity = computeCapacity({
      window,
      mechanicIds: mechanics,
      productivityRate: 1,
      appointments: [
        { ...booked("x", "07:00", "09:00"), status: "CANCELLED" },
        booked("y", "13:00", "15:00"),
      ],
      maxAppointmentsPerHalfDay: null,
      activeBayCount: 3,
    });
    expect(capacity.loadMinutes).toBe(60);
    expect(capacity.appointmentsCount).toBe(1);
  });

  it("un mécanicien absent (ResourceBlock) ou un blocage site réduit la capacité", () => {
    const capacity = computeCapacity({
      window,
      mechanicIds: mechanics,
      productivityRate: 1,
      appointments: [],
      blocks: [
        {
          id: "b1",
          bayId: null,
          membershipId: "m1",
          startsAt: at("08:00"),
          endsAt: at("14:00"),
          reason: "Congé",
        },
        {
          id: "b2",
          bayId: null,
          membershipId: null,
          startsAt: at("12:00"),
          endsAt: at("14:00"),
          reason: "Coupure",
        },
      ],
      maxAppointmentsPerHalfDay: null,
      activeBayCount: 3,
    });
    // m1 absent ; m2 et m3 perdent 2 h chacun → 2 × 4 h = 480 min.
    expect(capacity.capacityMinutes).toBe(480);
    expect(capacity.mechanicsPresent).toBe(2);
  });

  it("refuse quand le plafond de RDV de la demi-journée est atteint", () => {
    const capacity = computeCapacity({
      window,
      mechanicIds: mechanics,
      productivityRate: 1,
      appointments: [booked("a", "08:00", "09:00"), booked("b", "09:00", "10:00")],
      maxAppointmentsPerHalfDay: 2,
      activeBayCount: 3,
    });
    expect(canAcceptAppointment(capacity, 30)).toEqual({ ok: false, reason: "MAX_APPOINTMENTS" });
  });

  it("occupancyRate borne à 1", () => {
    expect(
      occupancyRate({
        date: "",
        halfDay: "AM",
        capacityMinutes: 100,
        loadMinutes: 50,
        appointmentsCount: 1,
        maxAppointments: 4,
        mechanicsPresent: 1,
      }),
    ).toBe(0.5);
    expect(
      occupancyRate({
        date: "",
        halfDay: "AM",
        capacityMinutes: 0,
        loadMinutes: 50,
        appointmentsCount: 1,
        maxAppointments: 4,
        mechanicsPresent: 0,
      }),
    ).toBe(1);
  });
});
