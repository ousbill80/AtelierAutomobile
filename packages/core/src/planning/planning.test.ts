import { describe, expect, it } from "vitest";
import {
  assertTransition,
  attributeReminder,
  availableSlots,
  batchPlacement,
  canRevertNoShow,
  checkCapacity,
  classifyAppointmentReply,
  computeCapacity,
  confirmationMessage,
  defaultDuration,
  detectConflicts,
  formatMinutesFr,
  halfDayLoad,
  isLate,
  isWithinOpeningHours,
  noShowCount12m,
  noShowEligibility,
  occupancyTone,
  openIntervalsForDay,
  requiresMandatoryConfirmation,
  resolvePlanningConfig,
  spreadEvenly,
  zonedInstant,
  type ExistingAppointment,
  type PlanningSnapshot,
} from "./index";

const TZ = "Africa/Abidjan";
const HOURS = {
  mon: [
    ["07:30", "12:30"],
    ["13:30", "18:00"],
  ] as [string, string][],
  tue: [["07:30", "18:00"]] as [string, string][],
  sat: [["08:00", "14:00"]] as [string, string][],
  sun: [] as [string, string][],
};
const at = (iso: string) => new Date(iso);
const ctx = { timeZone: TZ, openingHours: HOURS };

describe("isWithinOpeningHours (RG-M03-01)", () => {
  it("accepte un RDV entièrement dans une plage (samedi 24/10/2026 09:00-10:30)", () => {
    expect(isWithinOpeningHours(at("2026-10-24T09:00:00Z"), at("2026-10-24T10:30:00Z"), ctx)).toBe(
      true,
    );
  });
  it("refuse un RDV qui chevauche la pause de midi (plages séparées)", () => {
    expect(isWithinOpeningHours(at("2026-10-26T12:00:00Z"), at("2026-10-26T13:00:00Z"), ctx)).toBe(
      false,
    );
  });
  it("applique la pause configurée sur une journée continue", () => {
    const withLunch = { ...ctx, lunchBreak: ["12:30", "13:30"] as [string, string] };
    expect(isWithinOpeningHours(at("2026-10-27T12:00:00Z"), at("2026-10-27T13:00:00Z"), ctx)).toBe(
      true,
    );
    expect(
      isWithinOpeningHours(at("2026-10-27T12:00:00Z"), at("2026-10-27T13:00:00Z"), withLunch),
    ).toBe(false);
    expect(openIntervalsForDay("2026-10-27", withLunch)).toEqual([
      [450, 750],
      [810, 1080],
    ]);
  });
  it("refuse le samedi après 14:00 (demi-journée)", () => {
    expect(isWithinOpeningHours(at("2026-10-24T13:00:00Z"), at("2026-10-24T14:30:00Z"), ctx)).toBe(
      false,
    );
  });
  it("refuse le dimanche et un jour sans horaires", () => {
    expect(isWithinOpeningHours(at("2026-10-25T09:00:00Z"), at("2026-10-25T10:00:00Z"), ctx)).toBe(
      false,
    );
    expect(isWithinOpeningHours(at("2026-10-28T09:00:00Z"), at("2026-10-28T10:00:00Z"), ctx)).toBe(
      false,
    );
  });
  it("refuse un jour férié (global ou du site)", () => {
    const holidays = [{ date: at("2026-12-25T00:00:00Z"), siteId: null }];
    expect(
      isWithinOpeningHours(at("2026-12-25T09:00:00Z"), at("2026-12-25T10:00:00Z"), {
        ...ctx,
        openingHours: { ...HOURS, fri: [["07:30", "18:00"]] },
        holidays,
      }),
    ).toBe(false);
  });
  it("refuse une durée nulle ou négative", () => {
    expect(isWithinOpeningHours(at("2026-10-24T09:00:00Z"), at("2026-10-24T09:00:00Z"), ctx)).toBe(
      false,
    );
  });
});

const appt = (over: Partial<ExistingAppointment>): ExistingAppointment => ({
  id: "a1",
  bayId: "pont1",
  mechanicId: null,
  status: "BOOKED",
  startsAt: at("2026-10-24T09:00:00Z"),
  endsAt: at("2026-10-24T10:30:00Z"),
  ...over,
});

describe("detectConflicts (RG-M03-02)", () => {
  const candidate = {
    startsAt: at("2026-10-24T09:00:00Z"),
    endsAt: at("2026-10-24T10:30:00Z"),
    bayId: "pont1",
    mechanicId: "m1",
  };
  it("détecte un chevauchement exact sur le même pont", () => {
    expect(detectConflicts(candidate, { appointments: [appt({})] })[0]?.kind).toBe("BAY");
  });
  it("autorise le bord à bord 09:00-10:30 / 10:30-12:00", () => {
    const next = {
      ...candidate,
      startsAt: at("2026-10-24T10:30:00Z"),
      endsAt: at("2026-10-24T12:00:00Z"),
    };
    expect(detectConflicts(next, { appointments: [appt({})] })).toEqual([]);
  });
  it("ignore les RDV annulés et absents", () => {
    expect(
      detectConflicts(candidate, {
        appointments: [appt({ status: "CANCELLED" }), appt({ id: "a2", status: "NO_SHOW" })],
      }),
    ).toEqual([]);
  });
  it("ignore le RDV lui-même lors d'une modification", () => {
    expect(
      detectConflicts({ ...candidate, excludeId: "a1" }, { appointments: [appt({})] }),
    ).toEqual([]);
  });
  it("un mécanicien ne peut avoir deux RDV simultanés", () => {
    const conflicts = detectConflicts(
      { ...candidate, bayId: "pont2" },
      { appointments: [appt({ mechanicId: "m1" })] },
    );
    expect(conflicts.map((c) => c.kind)).toEqual(["MECHANIC"]);
  });
  it("blocages pont, mécanicien, site et OR en cours", () => {
    const iv = { startsAt: at("2026-10-24T08:00:00Z"), endsAt: at("2026-10-24T12:00:00Z") };
    const kinds = detectConflicts(candidate, {
      appointments: [],
      blocks: [
        { id: "b1", bayId: "pont1", membershipId: null, reason: "Maintenance", ...iv },
        { id: "b2", bayId: null, membershipId: "m1", reason: "Congé", ...iv },
        { id: "b3", bayId: null, membershipId: null, reason: "Fermeture", ...iv },
      ],
      orders: [{ id: "or1", bayId: "pont1", ...iv }],
    }).map((c) => c.kind);
    expect(kinds).toEqual(["BAY_BLOCKED", "MECHANIC_ABSENT", "SITE_CLOSED", "REPAIR_ORDER"]);
  });
});

describe("computeCapacity / checkCapacity (RG-M03-05)", () => {
  it("exemple du PRD : 3 mécaniciens × 6 h × 0,85 = 15,3 h ; 12 h + 2 h acceptées, puis refus à 16 h", () => {
    const capacity = computeCapacity([360, 360, 360], 0.85);
    expect(capacity).toBe(918);
    expect(formatMinutesFr(capacity)).toBe("15 h 18");
    const base = {
      capacityMinutes: capacity,
      durationMinutes: 120,
      appointmentsCount: 4,
      maxAppointments: 6,
    };
    expect(checkCapacity({ ...base, loadMinutes: 720 }).ok).toBe(true);
    const refused = checkCapacity({ ...base, loadMinutes: 840 });
    expect(refused).toEqual({ ok: false, reason: "CAPACITY_EXCEEDED", load: 960, capacity: 918 });
    expect(formatMinutesFr(840)).toBe("14 h");
  });
  it("refuse au-delà du nombre maximal de RDV par demi-journée", () => {
    expect(
      checkCapacity({
        capacityMinutes: null,
        loadMinutes: 0,
        durationMinutes: 60,
        appointmentsCount: 6,
        maxAppointments: 6,
      }),
    ).toEqual({ ok: false, reason: "MAX_APPOINTMENTS", count: 6, max: 6 });
  });
  it("capacité inconnue (aucun mécanicien) : pas de contrôle de charge", () => {
    expect(
      checkCapacity({
        capacityMinutes: null,
        loadMinutes: 5000,
        durationMinutes: 60,
        appointmentsCount: 0,
        maxAppointments: null,
      }).ok,
    ).toBe(true);
  });
  it("jauge d'occupation : vert < 70 %, orange 70-90 %, rouge > 90 %", () => {
    expect(occupancyTone(0.5)).toBe("ok");
    expect(occupancyTone(0.7)).toBe("warn");
    expect(occupancyTone(0.9)).toBe("warn");
    expect(occupancyTone(0.95)).toBe("bad");
  });
});

describe("defaultDuration (RG-M03-04)", () => {
  it("durée du type par défaut", () => {
    expect(defaultDuration("SERVICE")).toBe(90);
    expect(defaultDuration("BODYWORK")).toBe(30);
  });
  it("vidange 0,5 h + plaquettes 1 h + géométrie 0,75 h = 2,25 h → 135 min", () => {
    expect(defaultDuration("SERVICE", [0.5, 1, 0.75])).toBe(135);
  });
  it("arrondi au quart d'heure supérieur, minimum la durée du type", () => {
    expect(defaultDuration("REPAIR", [2.1])).toBe(135);
    expect(defaultDuration("REPAIR", [0.5])).toBe(120);
  });
  it("respecte les durées paramétrées", () => {
    const { appointments } = resolvePlanningConfig({
      appointments: { durations: { SERVICE: 120 } },
    });
    expect(defaultDuration("SERVICE", [], appointments.durations)).toBe(120);
  });
});

function snapshot(over: Partial<PlanningSnapshot> = {}): PlanningSnapshot {
  return {
    timeZone: TZ,
    siteId: "site1",
    openingHours: HOURS,
    holidays: [],
    lunchBreak: null,
    productivityRate: 0.85,
    configuredMaxPerHalfDay: null,
    bays: [
      { id: "pont1", type: "LIFT", isActive: true },
      { id: "pont2", type: "LIFT", isActive: true },
      { id: "diag", type: "DIAGNOSTIC", isActive: true },
    ],
    mechanicIds: [],
    appointments: [],
    blocks: [],
    orders: [],
    ...over,
  };
}

describe("availableSlots (RG-M03-07, US-M03-02)", () => {
  const base = {
    now: at("2026-10-24T07:00:00Z"),
    type: "DIAGNOSTIC" as const,
    durationMinutes: 60,
    fromDate: "2026-10-24",
    stepMinutes: 30,
    requireBay: true,
  };
  it("respecte le délai minimum de 2 h", () => {
    const groups = availableSlots({ ...base, snapshot: snapshot(), days: 1, minLeadMinutes: 120 });
    expect(groups[0]!.slots[0]!.startsAt).toEqual(at("2026-10-24T09:00:00Z"));
  });
  it("exige un pont compatible libre (DIAGNOSTIC)", () => {
    const busy = appt({
      bayId: "diag",
      startsAt: at("2026-10-24T08:00:00Z"),
      endsAt: at("2026-10-24T14:00:00Z"),
    });
    const groups = availableSlots({
      ...base,
      snapshot: snapshot({ appointments: [busy] }),
      days: 1,
      minLeadMinutes: 0,
    });
    expect(groups).toEqual([]);
  });
  it("saute le dimanche et respecte l'horizon", () => {
    const groups = availableSlots({ ...base, snapshot: snapshot(), days: 2, minLeadMinutes: 0 });
    expect(new Set(groups.map((g) => g.date))).toEqual(new Set(["2026-10-24"]));
  });
  it("au plus 6 créneaux par demi-journée, répartis uniformément", () => {
    const groups = availableSlots({
      ...base,
      snapshot: snapshot(),
      days: 1,
      minLeadMinutes: 0,
      maxPerHalfDay: 6,
    });
    expect(groups[0]!.slots).toHaveLength(6);
    expect(groups[0]!.slots[0]!.startsAt).toEqual(at("2026-10-24T08:00:00Z"));
    expect(spreadEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)).toEqual([1, 6, 10]);
  });
  it("limite aux 10 prochains créneaux", () => {
    const groups = availableSlots({
      ...base,
      snapshot: snapshot(),
      days: 7,
      minLeadMinutes: 0,
      limit: 10,
    });
    expect(groups.flatMap((g) => g.slots)).toHaveLength(10);
  });
  it("refuse les créneaux d'une demi-journée pleine (capacité)", () => {
    const full = snapshot({
      mechanicIds: ["m1"],
      appointments: [
        appt({
          bayId: "pont1",
          startsAt: at("2026-10-24T08:00:00Z"),
          endsAt: at("2026-10-24T12:30:00Z"),
        }),
      ],
    });
    const groups = availableSlots({
      ...base,
      type: "OTHER",
      requireBay: false,
      snapshot: full,
      days: 1,
      minLeadMinutes: 0,
    });
    expect(groups.filter((g) => g.halfDay === "AM")).toEqual([]);
  });
  it("halfDayLoad compte les RDV et la charge de la demi-journée", () => {
    const load = halfDayLoad(
      snapshot({ mechanicIds: ["m1", "m2", "m3"], appointments: [appt({})] }),
      "2026-10-24",
      "AM",
    );
    expect(load.appointmentsCount).toBe(1);
    expect(load.loadMinutes).toBe(90);
    expect(load.capacityMinutes).toBe(Math.floor(3 * 300 * 0.85));
    expect(load.maxAppointments).toBe(6);
  });
});

describe("attributeReminder (RG-M03-12)", () => {
  const reminder = {
    id: "r1",
    type: "INSPECTION",
    customerId: "c1",
    vehicleId: "v1",
    sentAt: at("2026-10-15T09:00:00Z"),
  };
  const appointment = { customerId: "c1", vehicleId: "v1", createdAt: at("2026-10-20T09:00:00Z") };
  it("attribue la relance envoyée dans les 14 jours au même véhicule", () => {
    expect(attributeReminder(appointment, [reminder])).toBe("r1");
  });
  it("conserve un reminderId déjà renseigné", () => {
    expect(attributeReminder({ ...appointment, reminderId: "r0" }, [reminder])).toBe("r0");
  });
  it("ignore au-delà de 14 jours, autre véhicule ou relance de créance", () => {
    expect(
      attributeReminder({ ...appointment, createdAt: at("2026-10-30T09:00:00Z") }, [reminder]),
    ).toBeNull();
    expect(attributeReminder(appointment, [{ ...reminder, vehicleId: "v2" }])).toBeNull();
    expect(attributeReminder(appointment, [{ ...reminder, type: "RECEIVABLE" }])).toBeNull();
    expect(attributeReminder({ ...appointment, vehicleId: null }, [reminder])).toBeNull();
  });
});

describe("no-show (RG-M03-10)", () => {
  const booked = { status: "BOOKED" as const, startsAt: at("2026-10-24T09:00:00Z") };
  it("en retard après 60 min", () => {
    expect(isLate(booked, at("2026-10-24T09:59:00Z"), 60)).toBe(false);
    expect(isLate(booked, at("2026-10-24T10:00:00Z"), 60)).toBe(true);
    expect(isLate({ ...booked, status: "ARRIVED" }, at("2026-10-24T11:00:00Z"), 60)).toBe(false);
  });
  it("job de 20:00 en heure locale, jours précédents rattrapés", () => {
    expect(noShowEligibility(booked, at("2026-10-24T19:59:00Z"), TZ, "20:00")).toBe(false);
    expect(noShowEligibility(booked, at("2026-10-24T20:00:00Z"), TZ, "20:00")).toBe(true);
    expect(noShowEligibility(booked, at("2026-10-26T08:00:00Z"), TZ, "20:00")).toBe(true);
    expect(
      noShowEligibility(
        { ...booked, status: "CONFIRMED" },
        at("2026-10-24T21:00:00Z"),
        TZ,
        "20:00",
      ),
    ).toBe(true);
    expect(
      noShowEligibility(
        { ...booked, status: "CANCELLED" },
        at("2026-10-24T21:00:00Z"),
        TZ,
        "20:00",
      ),
    ).toBe(false);
  });
  it("fuseau autre que UTC : l'heure locale compte", () => {
    // 19:30 UTC = 21:30 à Paris (été) → éligible ; 18:30 UTC = 20:30 Paris → éligible aussi.
    expect(noShowEligibility(booked, at("2026-10-24T17:30:00Z"), "Europe/Paris", "20:00")).toBe(
      false,
    );
    expect(noShowEligibility(booked, at("2026-10-24T18:30:00Z"), "Europe/Paris", "20:00")).toBe(
      true,
    );
  });
  it("correction possible pendant 48 h", () => {
    expect(canRevertNoShow(at("2026-10-24T20:00:00Z"), at("2026-10-26T19:59:00Z"))).toBe(true);
    expect(canRevertNoShow(at("2026-10-24T20:00:00Z"), at("2026-10-26T20:01:00Z"))).toBe(false);
    expect(canRevertNoShow(null, at("2026-10-24T20:00:00Z"))).toBe(false);
  });
  it("compteur 12 mois glissants et badge à 2 absences", () => {
    const list = [
      { status: "NO_SHOW" as const, startsAt: at("2026-01-10T09:00:00Z") },
      { status: "NO_SHOW" as const, startsAt: at("2025-09-10T09:00:00Z") },
      { status: "NO_SHOW" as const, startsAt: at("2026-09-10T09:00:00Z") },
      { status: "COMPLETED" as const, startsAt: at("2026-09-11T09:00:00Z") },
    ];
    const count = noShowCount12m(list, at("2026-10-24T09:00:00Z"));
    expect(count).toBe(2);
    expect(requiresMandatoryConfirmation(count)).toBe(true);
    expect(requiresMandatoryConfirmation(1)).toBe(false);
  });
});

describe("batchPlacement (US-M03-12)", () => {
  it("4 véhicules, 2 en parallèle max", () => {
    const starts = [8, 9, 10, 11].map((h) => zonedInstant("2026-11-07", h * 60, TZ));
    const { placed, unplaced } = batchPlacement({
      vehicleIds: ["v1", "v2", "v3", "v4"],
      candidateStarts: starts,
      durationMinutes: 60,
      bays: [
        { id: "pont1", busy: [] },
        { id: "pont2", busy: [] },
        { id: "diag", busy: [] },
      ],
      maxParallel: 2,
    });
    expect(unplaced).toEqual([]);
    expect(
      placed.map((p) => [p.vehicleId, p.startsAt.toISOString().slice(11, 16), p.bayId]),
    ).toEqual([
      ["v1", "08:00", "pont1"],
      ["v2", "08:00", "pont2"],
      ["v3", "09:00", "pont1"],
      ["v4", "09:00", "pont2"],
    ]);
  });
  it("renvoie les véhicules non placés", () => {
    const { unplaced } = batchPlacement({
      vehicleIds: ["v1", "v2"],
      candidateStarts: [zonedInstant("2026-11-07", 480, TZ)],
      durationMinutes: 60,
      bays: [{ id: "pont1", busy: [] }],
      maxParallel: 2,
    });
    expect(unplaced).toEqual(["v2"]);
  });
});

describe("machine à états (§5)", () => {
  it("transitions autorisées", () => {
    expect(assertTransition("BOOKED", "confirm")).toBe("CONFIRMED");
    expect(assertTransition("CONFIRMED", "arrive")).toBe("ARRIVED");
    expect(assertTransition("ARRIVED", "complete")).toBe("COMPLETED");
    expect(assertTransition("NO_SHOW", "revert_no_show")).toBe("ARRIVED");
  });
  it("annulation impossible si arrivé ou terminé ; terminaux non modifiables", () => {
    expect(() => assertTransition("ARRIVED", "cancel")).toThrow(/annulez l'OR/);
    expect(() => assertTransition("COMPLETED", "edit")).toThrow();
    expect(() => assertTransition("CANCELLED", "reschedule")).toThrow();
  });
});

describe("classifyAppointmentReply (US-M03-07)", () => {
  it("1 / oui / ok → confirmation automatique", () => {
    expect(classifyAppointmentReply("1")).toEqual({ intent: "CONFIRM", automatic: true });
    expect(classifyAppointmentReply(" Oui ! ")).toEqual({ intent: "CONFIRM", automatic: true });
    expect(classifyAppointmentReply("D’accord")).toEqual({ intent: "CONFIRM", automatic: true });
  });
  it("3 → annulation, 2 → déplacement", () => {
    expect(classifyAppointmentReply("3")?.intent).toBe("CANCEL");
    expect(classifyAppointmentReply("2")).toEqual({ intent: "RESCHEDULE", automatic: true });
  });
  it("texte libre → à replanifier, jamais appliqué automatiquement", () => {
    expect(classifyAppointmentReply("je peux pas demain")).toEqual({
      intent: "RESCHEDULE",
      automatic: false,
    });
    expect(classifyAppointmentReply("   ")).toBeNull();
  });
});

describe("messages (US-M03-01)", () => {
  it("confirmation au format du PRD", () => {
    expect(
      confirmationMessage({
        salutation: "M. Kouassi",
        garageName: "Garage Excellence Auto",
        type: "SERVICE",
        startsAt: at("2026-10-24T09:00:00Z"),
        timeZone: TZ,
        vehicle: { make: "Toyota", model: "Corolla", plate: "2547 GH 01" },
      }),
    ).toBe(
      "Bonjour M. Kouassi, votre RDV chez Garage Excellence Auto est confirmé le samedi 24/10/2026 à 09:00 pour la révision de votre Toyota Corolla (2547 GH 01). Répondez 1 pour confirmer, 2 pour déplacer.",
    );
  });
});

describe("resolvePlanningConfig (§6)", () => {
  it("valeurs par défaut et paramètres invalides ignorés", () => {
    const config = resolvePlanningConfig({
      appointments: { lateAfterMinutes: "x", portalMinLeadHours: 4 },
      planning: { productivityRate: 3 },
    });
    expect(config.appointments.lateAfterMinutes).toBe(60);
    expect(config.appointments.portalMinLeadHours).toBe(4);
    expect(config.planning.productivityRate).toBe(0.85);
    expect(config.appointments.portalTypes).toEqual([
      "SERVICE",
      "INSPECTION_PREP",
      "DIAGNOSTIC",
      "TIRES",
    ]);
  });
});

describe("parsePreferredSlotText / transactionalSendTime", () => {
  const monday = at("2026-10-19T10:00:00Z");
  it("« oui samedi matin » → samedi 24/10, matin", async () => {
    const { parsePreferredSlotText } = await import("./index");
    expect(parsePreferredSlotText("oui samedi matin", monday, TZ)).toEqual({
      date: "2026-10-24",
      halfDay: "AM",
      label: "samedi matin",
    });
    expect(parsePreferredSlotText("Demain après-midi", monday, TZ)).toMatchObject({
      date: "2026-10-20",
      halfDay: "PM",
    });
    expect(parsePreferredSlotText("après la paie", monday, TZ)).toEqual({ label: "" });
  });
  it("hors fenêtre 22:00-07:00 → envoi à 07:00", async () => {
    const { transactionalSendTime } = await import("./index");
    expect(transactionalSendTime(at("2026-10-19T10:00:00Z"), TZ)).toEqual(
      at("2026-10-19T10:00:00Z"),
    );
    expect(transactionalSendTime(at("2026-10-19T22:30:00Z"), TZ)).toEqual(
      at("2026-10-20T07:00:00Z"),
    );
    expect(transactionalSendTime(at("2026-10-20T05:00:00Z"), TZ)).toEqual(
      at("2026-10-20T07:00:00Z"),
    );
  });
});
