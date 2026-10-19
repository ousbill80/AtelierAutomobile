import { describe, expect, it } from "vitest";
import { availableSlots, halfDayKey } from "./availableSlots";

const TZ = "Africa/Abidjan";
const OPENING_HOURS = {
  mon: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ] as const,
  tue: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ] as const,
  wed: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ] as const,
  thu: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ] as const,
  fri: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ] as const,
  sat: [["08:00", "13:00"]] as const,
  sun: [],
};

describe("availableSlots (RG-M03-07)", () => {
  it("respecte le délai minimum de réservation (2 h)", () => {
    // Lundi 19/10/2026, 08:00 locale ; délai minimum 2 h → rien avant 10:00.
    const days = availableSlots({
      from: new Date("2026-10-19T08:00:00Z"),
      horizonDays: 1,
      stepMinutes: 30,
      durationMinutes: 60,
      timeZone: TZ,
      openingHours: OPENING_HOURS,
      minLeadHours: 2,
      occupancies: [],
      autoAssignBay: false,
    });
    const allSlots = days.flatMap((d) => d.slots);
    expect(
      allSlots.every((s) => s.startsAt.getTime() >= new Date("2026-10-19T10:00:00Z").getTime()),
    ).toBe(true);
    expect(
      allSlots.some((s) => s.startsAt.getTime() === new Date("2026-10-19T10:00:00Z").getTime()),
    ).toBe(true);
  });

  it("respecte l'horizon demandé (aucun créneau au-delà)", () => {
    const days = availableSlots({
      from: new Date("2026-10-19T08:00:00Z"),
      horizonDays: 3,
      stepMinutes: 30,
      durationMinutes: 60,
      timeZone: TZ,
      openingHours: OPENING_HOURS,
      minLeadHours: 2,
      occupancies: [],
      autoAssignBay: false,
    });
    const lastDate = days
      .map((d) => d.date)
      .sort()
      .at(-1);
    expect(lastDate! <= "2026-10-21").toBe(true);
  });

  it("limite à 6 créneaux par demi-journée, répartis uniformément", () => {
    const days = availableSlots({
      from: new Date("2026-10-19T00:00:00Z"),
      horizonDays: 1,
      stepMinutes: 15, // beaucoup plus de 6 créneaux possibles le matin
      durationMinutes: 30,
      timeZone: TZ,
      openingHours: OPENING_HOURS,
      minLeadHours: 0,
      occupancies: [],
      autoAssignBay: false,
    });
    const morning = days.find((d) => d.halfDay === "AM");
    expect(morning).toBeDefined();
    expect(morning!.slots.length).toBeLessThanOrEqual(6);
    expect(morning!.slots.length).toBeGreaterThan(1);
  });

  it("n'expose que des créneaux avec un pont compatible libre quand autoAssignBay est actif", () => {
    const days = availableSlots({
      from: new Date("2026-10-19T00:00:00Z"),
      horizonDays: 1,
      stepMinutes: 60,
      durationMinutes: 60,
      timeZone: TZ,
      openingHours: OPENING_HOURS,
      minLeadHours: 0,
      occupancies: [
        {
          id: "existing",
          bayId: "bay_1",
          startsAt: new Date("2026-10-19T07:30:00Z"),
          endsAt: new Date("2026-10-19T12:30:00Z"),
          blocking: true,
        },
      ],
      compatibleBayIds: ["bay_1", "bay_2"],
      autoAssignBay: true,
    });
    const morning = days.find((d) => d.halfDay === "AM")!;
    // bay_1 occupé toute la matinée : seul bay_2 doit être proposé, jamais bay_1.
    expect(morning.slots.every((s) => s.bayId === "bay_2")).toBe(true);
    expect(morning.slots.length).toBeGreaterThan(0);
  });

  it("ne propose rien quand aucun pont compatible n'existe et autoAssignBay est actif", () => {
    const days = availableSlots({
      from: new Date("2026-10-19T00:00:00Z"),
      horizonDays: 1,
      stepMinutes: 60,
      durationMinutes: 60,
      timeZone: TZ,
      openingHours: OPENING_HOURS,
      minLeadHours: 0,
      occupancies: [],
      compatibleBayIds: [],
      autoAssignBay: true,
    });
    expect(days.flatMap((d) => d.slots)).toHaveLength(0);
  });

  it("masque toute la demi-journée quand la capacité restante est déjà saturée", () => {
    const days = availableSlots({
      from: new Date("2026-10-19T00:00:00Z"),
      horizonDays: 1,
      stepMinutes: 60,
      durationMinutes: 60,
      timeZone: TZ,
      openingHours: OPENING_HOURS,
      minLeadHours: 0,
      occupancies: [],
      autoAssignBay: false,
      // Capacité déjà à 0 min restante : aucun créneau de 60 min ne doit passer le filtre,
      // quel que soit l'horaire (la vraie disponibilité par pont est revérifiée en transaction
      // à la réservation, RG-M03-07 — ce filtre ne fait qu'exposer ou non la demi-journée).
      halfDayCapacity: new Map([
        [halfDayKey("2026-10-19", "AM"), { capacityMinutes: 60, loadMinutes: 60 }],
      ]),
    });
    const morning = days.find((d) => d.halfDay === "AM");
    expect(morning?.slots.length ?? 0).toBe(0);
  });

  it("ignore les jours fériés", () => {
    const days = availableSlots({
      from: new Date("2026-10-19T00:00:00Z"),
      horizonDays: 1,
      stepMinutes: 60,
      durationMinutes: 60,
      timeZone: TZ,
      openingHours: OPENING_HOURS,
      holidays: [{ date: new Date("2026-10-19T00:00:00Z"), siteId: null }],
      minLeadHours: 0,
      occupancies: [],
      autoAssignBay: false,
    });
    expect(days).toHaveLength(0);
  });
});
