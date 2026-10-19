import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import {
  allowedColumns,
  attributeBilledHours,
  assertPartRequestTransition,
  assertQcCheckerAllowed,
  assertSubcontractTransition,
  assertTaskStartable,
  availableHoursToday,
  checkBoardMove,
  columnForStatus,
  computeDurationMinutes,
  correctTimestamp,
  decideLineOp,
  decideStaleAttendance,
  decideStaleEntry,
  isSubcontractLoss,
  isSubcontractOverdue,
  lastWriteWins,
  laborCost,
  measureClockOffset,
  orderSyncBatch,
  pauseEntry,
  planStartOverlap,
  presenceMinutes,
  productivityMetrics,
  rankAssignees,
  releasesBayOn,
  remainingLaborHours,
  resumeEntry,
  reworkableLineIds,
  scoreAssignment,
  stopEntry,
  taskProgress,
  transitionForMove,
  workshopLateness,
  workshopSettingsFrom,
  type WorkshopLine,
} from "./index";

const T = (hhmm: string, day = "2026-10-13") => new Date(`${day}T${hhmm}:00.000Z`);
const ALL = new Set(["repair_order:update", "repair_order:assign", "repair_order:qc"]);

function expectDomain(fn: () => void, code: string) {
  try {
    fn();
  } catch (error) {
    expect(isDomainError(error) && error.code).toBe(code);
    return;
  }
  throw new Error(`DomainError ${code} attendue`);
}

describe("RG-M06-01/02 — kanban", () => {
  const labor = (status: WorkshopLine["status"], quantity: number): WorkshopLine => ({
    type: "LABOR",
    status,
    approval: "APPROVED",
    quantity,
  });

  it("répartit les statuts M04 en 7 colonnes et masque DRAFT/DELIVERED/INVOICED/CANCELLED", () => {
    expect(columnForStatus("CHECKED_IN")).toBe("to_diagnose");
    expect(columnForStatus("DIAGNOSING")).toBe("to_diagnose");
    expect(columnForStatus("QUALITY_CHECK")).toBe("quality_check");
    expect(columnForStatus("READY")).toBe("ready");
    for (const s of ["DRAFT", "DELIVERED", "INVOICED", "CANCELLED"] as const) {
      expect(columnForStatus(s)).toBeNull();
    }
  });

  it("avancement 3/5 tâches et heures barème restantes", () => {
    const lines = [
      labor("DONE", 1),
      labor("DONE", 2),
      labor("DONE", 0.5),
      labor("IN_PROGRESS", 1.5),
      labor("PENDING", 2),
      { ...labor("PENDING", 4), status: "CANCELLED" as const },
      {
        type: "PART" as const,
        status: "PENDING" as const,
        approval: "APPROVED" as const,
        quantity: 4,
      },
    ];
    expect(taskProgress(lines)).toEqual({ done: 3, total: 5 });
    expect(remainingLaborHours(lines)).toBe(3.5);
  });

  it("retard : promisedAt dépassé et statut avant READY → « En retard de 2 h »", () => {
    const order = { status: "IN_PROGRESS" as const, promisedAt: T("10:00") };
    expect(workshopLateness(order, [], T("12:00"))).toEqual({
      late: true,
      lateMinutes: 120,
      atRisk: false,
    });
    expect(workshopLateness({ ...order, status: "READY" }, [], T("12:00")).late).toBe(false);
    expect(workshopLateness({ ...order, promisedAt: null }, [], T("12:00")).late).toBe(false);
  });

  it("« à risque » si promisedAt − maintenant < heures barème restantes", () => {
    const order = { status: "IN_PROGRESS" as const, promisedAt: T("12:00") };
    expect(workshopLateness(order, [labor("PENDING", 3)], T("10:00")).atRisk).toBe(true);
    expect(workshopLateness(order, [labor("PENDING", 1)], T("10:00")).atRisk).toBe(false);
  });

  it("traduit un dépôt en transition M04", () => {
    expect(transitionForMove("APPROVED", "in_progress")).toBe("start_work");
    expect(transitionForMove("WAITING_PARTS", "in_progress")).toBe("resume");
    expect(transitionForMove("IN_PROGRESS", "quality_check")).toBe("complete_work");
    expect(transitionForMove("QUALITY_CHECK", "ready")).toBe("qc_pass");
    expect(transitionForMove("IN_PROGRESS", "in_progress")).toBeNull();
    expect(transitionForMove("CHECKED_IN", "quality_check")).toBeNull();
  });

  it("refuse le dépôt en CQ si des tâches ne sont pas terminées (« 2 lignes … »)", () => {
    const result = checkBoardMove(
      { status: "IN_PROGRESS" },
      [labor("DONE", 1), labor("PENDING", 1), labor("IN_PROGRESS", 1)],
      "quality_check",
      { permissions: ALL },
    );
    expect(result).toMatchObject({ ok: false, code: "LINES_NOT_DONE" });
    expect(!result.ok && result.message).toBe("2 lignes ne sont pas terminées.");
  });

  it("accepte le dépôt en CQ quand tout est terminé ; READY passe par l'écran CQ", () => {
    expect(
      checkBoardMove({ status: "IN_PROGRESS" }, [labor("DONE", 1)], "quality_check", {
        permissions: ALL,
      }),
    ).toEqual({ ok: true, transition: "complete_work", viaQualityCheck: false });
    expect(
      checkBoardMove({ status: "QUALITY_CHECK" }, [labor("DONE", 1)], "ready", {
        permissions: ALL,
      }),
    ).toEqual({ ok: true, transition: "qc_pass", viaQualityCheck: true });
  });

  it("colonnes autorisées pendant le glisser (les autres sont grisées)", () => {
    expect(
      allowedColumns({ status: "APPROVED" }, [labor("PENDING", 1)], { permissions: ALL }),
    ).toEqual(["in_progress"]);
    expect(
      allowedColumns({ status: "APPROVED" }, [labor("PENDING", 1)], { permissions: new Set() }),
    ).toEqual([]);
  });

  it("RG-M06-03 : READY libère le pont sauf keepBayUntilDelivery", () => {
    expect(releasesBayOn("READY", false)).toBe(true);
    expect(releasesBayOn("READY", true)).toBe(false);
    expect(releasesBayOn("DELIVERED", true)).toBe(true);
    expect(releasesBayOn("IN_PROGRESS", false)).toBe(false);
  });
});

describe("RG-M06-05/06/07 — pointage", () => {
  const entry = (over: Partial<Parameters<typeof computeDurationMinutes>[0]> = {}) => ({
    startedAt: T("08:00"),
    endedAt: null,
    pauseMinutes: 0,
    pausedAt: null,
    ...over,
  });

  it("computeDuration : sans pause, avec pause, pause en cours, entrée ouverte", () => {
    expect(computeDurationMinutes(entry({ endedAt: T("09:30") }), T("12:00"))).toBe(90);
    expect(
      computeDurationMinutes(entry({ endedAt: T("09:30"), pauseMinutes: 20 }), T("12:00")),
    ).toBe(70);
    expect(computeDurationMinutes(entry(), T("08:45"))).toBe(45);
    expect(computeDurationMinutes(entry({ pausedAt: T("08:30") }), T("09:00"))).toBe(30);
  });

  it("computeDuration : arrondi inférieur et jamais négatif", () => {
    expect(
      computeDurationMinutes(
        entry({ endedAt: new Date(T("08:00").getTime() + 119_000) }),
        T("12:00"),
      ),
    ).toBe(1);
    expect(
      computeDurationMinutes(entry({ endedAt: T("08:10"), pauseMinutes: 30 }), T("12:00")),
    ).toBe(0);
    expect(computeDurationMinutes(entry({ endedAt: T("07:00") }), T("12:00"))).toBe(0);
  });

  it("pause puis reprise : la durée de pause s'ajoute à pauseMinutes", () => {
    const e = entry();
    const paused = { ...e, ...pauseEntry(e, T("09:00"), "lunch")! };
    expect(paused).toMatchObject({ pausedAt: T("09:00"), pauseReason: "lunch" });
    expect(pauseEntry(paused, T("09:10"), "parts")).toBeNull();
    const resumed = { ...paused, ...resumeEntry(paused, T("09:45"))! };
    expect(resumed).toMatchObject({ pauseMinutes: 45, pausedAt: null });
    expect(resumeEntry(resumed, T("10:00"))).toBeNull();
    const stopped = { ...resumed, ...stopEntry(resumed, T("10:00"))! };
    expect(computeDurationMinutes(stopped, T("12:00"))).toBe(75);
  });

  it("stop sur une entrée en pause : close à pausedAt, pause terminale non comptée", () => {
    const paused = entry({ pausedAt: T("09:00"), pauseMinutes: 10 });
    const patch = stopEntry(paused, T("11:00"))!;
    expect(patch.endedAt).toEqual(T("09:00"));
    expect(computeDurationMinutes({ ...paused, ...patch }, T("12:00"))).toBe(50);
    expect(stopEntry({ ...paused, ...patch }, T("12:00"))).toBeNull();
  });

  it("RG-M06-06 : démarrer met en pause la tâche active", () => {
    const plan = planStartOverlap([{ id: "a", ...entry() }], T("09:00"));
    expect(plan).toEqual({
      pause: [{ id: "a", at: T("09:00") }],
      truncate: [],
      incomingEndedAt: null,
      needsReview: false,
    });
  });

  it("RG-M06-14 : chevauchement → la plus ancienne close au début de la suivante, needsReview", () => {
    const closedLater = { id: "b", ...entry({ endedAt: T("10:00") }) };
    expect(planStartOverlap([closedLater], T("09:00"))).toMatchObject({
      truncate: [{ id: "b", endedAt: T("09:00") }],
      needsReview: true,
    });
    const newer = { id: "c", ...entry({ startedAt: T("09:30") }) };
    expect(planStartOverlap([newer], T("09:00"))).toMatchObject({
      pause: [],
      incomingEndedAt: T("09:30"),
      needsReview: true,
    });
    const before = { id: "d", ...entry({ endedAt: T("08:30") }) };
    expect(planStartOverlap([before], T("09:00")).needsReview).toBe(false);
  });
});

describe("RG-M06-04 — scoreAssignment", () => {
  it("exemples du PRD : Konan 80, Ibrahim −6,7", () => {
    const konan = scoreAssignment(
      {
        membershipId: "konan",
        skills: ["climatisation"],
        present: true,
        remainingLoadHours: 3,
        alreadyOnOrder: false,
      },
      "climatisation",
      6,
    );
    expect(konan.score).toBe(80);
    expect(konan.reasons).toEqual(["skill_ok"]);
    const ibrahim = scoreAssignment(
      {
        membershipId: "ibrahim",
        skills: ["moteur"],
        present: true,
        remainingLoadHours: 1,
        alreadyOnOrder: false,
      },
      "climatisation",
      6,
    );
    expect(ibrahim.score).toBe(-6.7);
    expect(ibrahim.skillMatch).toBe(false);
  });

  it("absent −100, déjà sur l'OR +15, loadRatio plafonné à 2", () => {
    const base = {
      membershipId: "m",
      skills: [],
      present: false,
      remainingLoadHours: 0,
      alreadyOnOrder: true,
    };
    expect(scoreAssignment(base, null, 6).score).toBe(15);
    const overloaded = scoreAssignment(
      { ...base, present: true, alreadyOnOrder: false, remainingLoadHours: 50 },
      null,
      1,
    );
    expect(overloaded.loadRatio).toBe(2);
    expect(overloaded.score).toBe(20);
    expect(overloaded.reasons).toContain("overloaded");
  });

  it("classe par score décroissant (top 5)", () => {
    const cands = Array.from({ length: 7 }, (_, i) => ({
      membershipId: `m${i}`,
      skills: [],
      present: true,
      remainingLoadHours: i,
      alreadyOnOrder: false,
    }));
    const ranked = rankAssignees(cands, null, 6);
    expect(ranked.map((r) => r.membershipId)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
  });

  it("heures disponibles jusqu'à la fermeture du site, minimum 0,5", () => {
    const ctx = {
      timeZone: "Africa/Abidjan",
      openingHours: {
        tue: [
          ["07:30", "12:00"],
          ["13:00", "18:00"],
        ] as [string, string][],
      },
    };
    expect(availableHoursToday(T("12:00"), ctx)).toBe(5);
    expect(availableHoursToday(T("10:00"), ctx)).toBe(7);
    expect(availableHoursToday(T("19:00"), ctx)).toBe(0.5);
  });
});

describe("RG-M06-08/09/10 — productivité", () => {
  it("attributeBilledHours : prorata 3 h / 1 h pointées, 5 h vendues → 3,75 h / 1,25 h", () => {
    const result = attributeBilledHours(
      [{ id: "l1", quantity: 5, assignedToId: "a", payer: "CUSTOMER" }],
      [
        { repairOrderLineId: "l1", membershipId: "a", minutes: 180, kind: "WORK" },
        { repairOrderLineId: "l1", membershipId: "b", minutes: 60, kind: "WORK" },
        { repairOrderLineId: "l1", membershipId: "b", minutes: 600, kind: "REWORK" },
      ],
    );
    expect(result.get("a")?.billedHours).toBeCloseTo(3.75);
    expect(result.get("b")?.billedHours).toBeCloseTo(1.25);
  });

  it("aucun pointage → assignedToId ; WARRANTY/INTERNAL à part", () => {
    const result = attributeBilledHours(
      [
        { id: "l1", quantity: 2, assignedToId: "a", payer: "CUSTOMER" },
        { id: "l2", quantity: 1, assignedToId: "a", payer: "WARRANTY" },
        { id: "l3", quantity: 1, assignedToId: null, payer: "CUSTOMER" },
      ],
      [],
    );
    expect(result.get("a")).toEqual({ billedHours: 2, nonCustomerHours: 1 });
    expect(result.size).toBe(1);
  });

  it("exemple Konan Yao : 111 / 82 / 92", () => {
    const presence = presenceMinutes(
      { clockIn: T("07:45"), clockOut: T("17:15"), breakMinutes: 60 },
      T("20:00"),
    );
    expect(presence).toBe(510);
    const metrics = productivityMetrics({
      presenceMinutes: presence,
      workedMinutes: 420,
      reworkMinutes: 0,
      billedHours: 7.8,
      laborCost: laborCost([420], 2_500),
    });
    expect(metrics).toMatchObject({
      presenceH: 8.5,
      workedH: 7,
      billedH: 7.8,
      efficiency: 111,
      productivity: 82,
      overall: 92,
      laborCost: 17_500,
      toCheck: false,
    });
  });

  it("dénominateur nul → « — » ; efficacité > 300 % à vérifier", () => {
    const empty = productivityMetrics({
      presenceMinutes: 0,
      workedMinutes: 0,
      reworkMinutes: 0,
      billedHours: 0,
      laborCost: 0,
    });
    expect(empty).toMatchObject({ efficiency: null, productivity: null, overall: null });
    expect(
      productivityMetrics({
        presenceMinutes: 480,
        workedMinutes: 60,
        reworkMinutes: 0,
        billedHours: 4,
        laborCost: 0,
      }).toCheck,
    ).toBe(true);
  });

  it("coût MO arrondi par entrée, présence ouverte jusqu'à maintenant", () => {
    expect(laborCost([20, 20, 20], 2_500)).toBe(2_499);
    expect(laborCost([60], null)).toBe(0);
    expect(
      presenceMinutes({ clockIn: T("08:00"), clockOut: null, breakMinutes: 0 }, T("09:30")),
    ).toBe(90);
    expect(presenceMinutes({ clockIn: null, clockOut: null, breakMinutes: 60 }, T("09:30"))).toBe(
      0,
    );
  });
});

describe("RG-M06-13/14 — resolveSyncOps", () => {
  it("correction d'offset : tablette en avance de 2 h", () => {
    const serverNow = T("12:00");
    const { offsetMs, suspicious } = measureClockOffset(serverNow, T("14:00"), null);
    expect(offsetMs).toBe(-2 * 3_600_000);
    expect(suspicious).toBe(true);
    expect(correctTimestamp(T("11:30"), offsetMs, serverNow)).toEqual(T("09:30"));
    expect(measureClockOffset(serverNow, T("14:00"), -7_200_000).suspicious).toBe(false);
    expect(measureClockOffset(serverNow, T("12:03"), null).suspicious).toBe(false);
  });

  it("horodatage dans le futur serveur ramené à l'heure de réception", () => {
    expect(correctTimestamp(T("13:00"), 0, T("12:00"))).toEqual(T("12:00"));
  });

  it("ligne annulée : pointage accepté (needsReview), « Terminer » refusé", () => {
    expect(decideLineOp("task.start", "CANCELLED")).toEqual({ action: "apply", needsReview: true });
    expect(decideLineOp("task.pause", "CANCELLED")).toEqual({ action: "apply", needsReview: true });
    expect(decideLineOp("task.complete", "CANCELLED")).toEqual({
      action: "reject",
      message: "Tâche annulée par le bureau. Votre temps a été enregistré.",
    });
    expect(decideLineOp("task.complete", "IN_PROGRESS")).toEqual({
      action: "apply",
      needsReview: false,
    });
  });

  it("dernier écrit gagne par point d'inspection ; lots ordonnés par seq, 200 max", () => {
    expect(lastWriteWins(null, T("10:00"))).toBe(true);
    expect(lastWriteWins(T("10:00"), T("09:59"))).toBe(false);
    expect(lastWriteWins(T("10:00"), T("10:00"))).toBe(true);
    const ops = Array.from({ length: 250 }, (_, i) => ({ seq: 250 - i }));
    const batch = orderSyncBatch(ops);
    expect(batch).toHaveLength(200);
    expect(batch[0]!.seq).toBe(1);
  });
});

describe("§5 — tâches, demandes de pièces, sous-traitance, CQ", () => {
  it("une tâche ne démarre que sur un OR approuvé et une ligne accordée", () => {
    expect(() =>
      assertTaskStartable({ status: "PENDING", approval: "APPROVED" }, "APPROVED"),
    ).not.toThrow();
    expectDomain(
      () => assertTaskStartable({ status: "PENDING", approval: "PENDING" }, "APPROVED"),
      "task.awaiting_approval",
    );
    expectDomain(
      () => assertTaskStartable({ status: "PENDING", approval: "APPROVED" }, "CHECKED_IN"),
      "task.order_not_workable",
    );
    expectDomain(
      () => assertTaskStartable({ status: "DONE", approval: "APPROVED" }, "IN_PROGRESS"),
      "task.done",
    );
  });

  it("demande de pièce : REQUESTED → PREPARING → DELIVERED ; refus motivé ; annulation par le demandeur", () => {
    expect(() =>
      assertPartRequestTransition("REQUESTED", "PREPARING", { byRequester: false }),
    ).not.toThrow();
    expect(() =>
      assertPartRequestTransition("ORDERED", "DELIVERED", { byRequester: false }),
    ).not.toThrow();
    expectDomain(
      () => assertPartRequestTransition("DELIVERED", "PREPARING", { byRequester: false }),
      "part_request.invalid_transition",
    );
    expectDomain(
      () => assertPartRequestTransition("PREPARING", "REJECTED", { byRequester: false }),
      "part_request.reason_required",
    );
    expectDomain(
      () => assertPartRequestTransition("REQUESTED", "CANCELLED", { byRequester: false }),
      "part_request.cancel_requester_only",
    );
  });

  it("sous-traitance : TO_SEND → SENT → RETURNED, perte, retard", () => {
    expect(() => assertSubcontractTransition(null, "SENT")).not.toThrow();
    expect(() => assertSubcontractTransition("SENT", "RETURNED")).not.toThrow();
    expectDomain(
      () => assertSubcontractTransition("RETURNED", "SENT"),
      "subcontract.invalid_transition",
    );
    expect(isSubcontractLoss({ unitPrice: 60_000, quantity: 1, costPrice: 45_000 })).toBe(false);
    expect(isSubcontractLoss({ unitPrice: 40_000, quantity: 1, costPrice: 45_000 })).toBe(true);
    expect(
      isSubcontractOverdue(
        { subcontractStatus: "SENT", subcontractExpectedAt: T("08:00") },
        T("09:00"),
      ),
    ).toBe(true);
    expect(
      isSubcontractOverdue(
        { subcontractStatus: "RETURNED", subcontractExpectedAt: T("08:00") },
        T("09:00"),
      ),
    ).toBe(false);
  });

  it("RG-M06-11 : le contrôleur ne peut pas être l'unique mécanicien, sauf qc_self", () => {
    expectDomain(() => assertQcCheckerAllowed("m1", ["m1", "m1"], false), "qc.self_check");
    expect(() => assertQcCheckerAllowed("m1", ["m1"], true)).not.toThrow();
    expect(() => assertQcCheckerAllowed("m1", ["m1", "m2"], false)).not.toThrow();
    expect(() => assertQcCheckerAllowed("m1", [], false)).not.toThrow();
    expect(
      reworkableLineIds(
        [
          { id: "a", status: "DONE" },
          { id: "b", status: "PENDING" },
        ],
        ["a", "b", "a"],
      ),
    ).toEqual(["a"]);
  });

  it("paramètres atelier par défaut", () => {
    expect(workshopSettingsFrom({})).toEqual({
      qcRequired: null,
      sharedTablets: false,
      keepBayUntilDelivery: false,
      photoRequiredOnUrgent: true,
    });
    expect(
      workshopSettingsFrom({ atelier: { keepBayUntilDelivery: true, qcRequired: false } }),
    ).toMatchObject({
      keepBayUntilDelivery: true,
      qcRequired: false,
    });
  });
});

describe("workshop.close_stale — clôtures automatiques", () => {
  const tz = "Africa/Abidjan";
  const base = { id: "e", startedAt: T("08:00"), endedAt: null, pauseMinutes: 0, pausedAt: null };

  it("pause de plus de 4 h → close à pausedAt", () => {
    expect(decideStaleEntry({ ...base, pausedAt: T("09:00") }, T("13:30"), tz)).toEqual({
      id: "e",
      endedAt: T("09:00"),
      reason: "pause_expired",
    });
    expect(decideStaleEntry({ ...base, pausedAt: T("12:00") }, T("13:30"), tz)).toBeNull();
  });

  it("entrée ouverte : close en fin de journée ou à 23:59 du jour de départ", () => {
    expect(decideStaleEntry(base, T("15:00"), tz)).toBeNull();
    expect(decideStaleEntry(base, T("23:59"), tz)).toMatchObject({
      endedAt: T("23:59"),
      reason: "end_of_day",
    });
    expect(decideStaleEntry(base, T("06:00", "2026-10-14"), tz)).toMatchObject({
      endedAt: T("23:59"),
    });
  });

  it("présence sans départ → fin de la dernière entrée, sinon fermeture du site", () => {
    const att = {
      id: "a",
      date: new Date("2026-10-13T00:00:00.000Z"),
      clockIn: T("07:48"),
      clockOut: null,
    };
    expect(decideStaleAttendance(att, T("17:10"), T("18:00"), T("23:59"), tz)).toEqual(T("17:10"));
    expect(decideStaleAttendance(att, null, T("18:00"), T("23:59"), tz)).toEqual(T("18:00"));
    expect(decideStaleAttendance(att, null, null, T("23:59"), tz)).toEqual(T("23:59"));
    expect(decideStaleAttendance(att, T("17:10"), null, T("15:00"), tz)).toBeNull();
    expect(
      decideStaleAttendance({ ...att, clockOut: T("17:00") }, null, null, T("23:59"), tz),
    ).toBeNull();
  });
});
