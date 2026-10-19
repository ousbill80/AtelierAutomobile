import { describe, expect, it } from "vitest";
import { detectConflicts, isBayFree, overlaps } from "./conflicts";
import type { AppointmentLike } from "./types";

const d = (time: string) => new Date(`2026-10-24T${time}:00Z`);
const appt = (over: Partial<AppointmentLike> & { id: string }): AppointmentLike => ({
  bayId: "bay-1",
  mechanicId: null,
  startsAt: d("09:00"),
  endsAt: d("10:30"),
  status: "BOOKED",
  ...over,
});

describe("overlaps", () => {
  it("autorise le bord à bord (09:00-10:30 / 10:30-12:00)", () => {
    expect(overlaps(d("09:00"), d("10:30"), d("10:30"), d("12:00"))).toBe(false);
  });
  it("détecte un chevauchement exact et partiel", () => {
    expect(overlaps(d("09:00"), d("10:30"), d("09:00"), d("10:30"))).toBe(true);
    expect(overlaps(d("09:00"), d("10:30"), d("10:00"), d("11:00"))).toBe(true);
  });
});

describe("detectConflicts (RG-M03-02)", () => {
  it("signale un RDV sur le même pont", () => {
    const conflicts = detectConflicts({
      startsAt: d("10:00"),
      endsAt: d("11:00"),
      bayId: "bay-1",
      appointments: [appt({ id: "a" })],
    });
    expect(conflicts).toEqual([
      { kind: "BAY_APPOINTMENT", appointment: expect.objectContaining({ id: "a" }) },
    ]);
  });

  it("ignore les statuts CANCELLED et NO_SHOW et le RDV exclu", () => {
    const conflicts = detectConflicts({
      startsAt: d("09:00"),
      endsAt: d("10:30"),
      bayId: "bay-1",
      excludeAppointmentId: "self",
      appointments: [
        appt({ id: "c", status: "CANCELLED" }),
        appt({ id: "n", status: "NO_SHOW" }),
        appt({ id: "self" }),
      ],
    });
    expect(conflicts).toEqual([]);
  });

  it("un mécanicien ne peut avoir qu'un RDV à la fois", () => {
    const conflicts = detectConflicts({
      startsAt: d("09:30"),
      endsAt: d("10:00"),
      bayId: "bay-2",
      mechanicId: "mec-1",
      appointments: [appt({ id: "a", mechanicId: "mec-1" })],
    });
    expect(conflicts.map((c) => c.kind)).toEqual(["MECHANIC_APPOINTMENT"]);
  });

  it("signale les blocages pont, mécanicien et site entier", () => {
    const block = { startsAt: d("08:00"), endsAt: d("12:00"), reason: "x" };
    const conflicts = detectConflicts({
      startsAt: d("09:00"),
      endsAt: d("10:00"),
      bayId: "bay-1",
      mechanicId: "mec-1",
      appointments: [],
      blocks: [
        { id: "b1", bayId: "bay-1", membershipId: null, ...block },
        { id: "b2", bayId: null, membershipId: "mec-1", ...block },
        { id: "b3", bayId: null, membershipId: null, ...block },
        { id: "b4", bayId: "bay-9", membershipId: null, ...block },
      ],
    });
    expect(conflicts.map((c) => c.kind).sort()).toEqual([
      "BAY_BLOCK",
      "MECHANIC_BLOCK",
      "SITE_BLOCK",
    ]);
  });

  it("un OR en cours bloque le pont jusqu'à promisedAt (ou fin de journée)", () => {
    const base = { startsAt: d("10:00"), endsAt: d("11:00"), bayId: "bay-1", appointments: [] };
    const withPromise = detectConflicts({
      ...base,
      occupyingOrders: [{ id: "or1", number: "OR-1", bayId: "bay-1", promisedAt: d("12:00") }],
    });
    expect(withPromise.map((c) => c.kind)).toEqual(["BAY_ORDER"]);
    const afterPromise = detectConflicts({
      ...base,
      startsAt: d("12:00"),
      endsAt: d("13:00"),
      occupyingOrders: [{ id: "or1", number: "OR-1", bayId: "bay-1", promisedAt: d("12:00") }],
    });
    expect(afterPromise).toEqual([]);
    const noPromise = detectConflicts({
      ...base,
      dayEnd: d("18:00"),
      occupyingOrders: [{ id: "or1", number: "OR-1", bayId: "bay-1", promisedAt: null }],
    });
    expect(noPromise.map((c) => c.kind)).toEqual(["BAY_ORDER"]);
  });

  it("isBayFree ne tient pas compte des conflits de mécanicien", () => {
    expect(
      isBayFree("bay-2", {
        startsAt: d("09:00"),
        endsAt: d("10:00"),
        appointments: [appt({ id: "a" })],
      }),
    ).toBe(true);
    expect(
      isBayFree("bay-1", {
        startsAt: d("09:00"),
        endsAt: d("10:00"),
        appointments: [appt({ id: "a" })],
      }),
    ).toBe(false);
  });
});
