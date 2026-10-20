import { randomBytes, randomUUID } from "node:crypto";
import { computeSessionAbsoluteExpiry, fixedClock, systemClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { setRepairOrdersClock } from "../repairOrders/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

// M06 §12 — intégration : `tech.sync` (lots ordonnés, rejet partiel, idempotence, horloge,
// ligne annulée), contrôle qualité FAILED → lignes PENDING et OR IN_PROGRESS, isolation
// multi-locataire, permission `time:edit`. Horloge figée : mardi 13/10/2026, Abidjan (UTC+0).
const callerFactory = createCallerFactory(appRouter);
const at = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00.000Z`);

async function memberCaller(
  organizationId: string,
  role: "OWNER" | "MANAGER" | "MECHANIC" | "ADVISOR",
  users: string[],
  name: string = role,
) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(5).toString("hex")}@example.com` },
  });
  users.push(user.id);
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, skills: role === "MECHANIC" ? ["moteur"] : [] },
  });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organizationId,
      isPinSession: false,
    },
  });
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  const caller = callerFactory(
    await createContext({ req, resHeaders: new Headers(), info: undefined as never }),
  );
  return { caller, membershipId: membership.id };
}

type Caller = Awaited<ReturnType<typeof memberCaller>>;

function op<T extends Record<string, unknown>>(
  actor: string,
  seq: number,
  type: string,
  time: string,
  extra: T,
) {
  return { clientOpId: randomUUID(), actorMembershipId: actor, seq, type, at: at(time), ...extra };
}

/** Synchro à `hhmm` : horloge serveur figée à cette heure, tablette à l'heure (décalage 0). */
async function syncAt(who: Caller, hhmm: string, ops: unknown[]) {
  setRepairOrdersClock(fixedClock(at(hhmm)));
  return who.caller.tech.sync({
    deviceId: "tablette-yop-1",
    deviceNow: at(hhmm),
    previousOffsetMs: 0,
    ops: ops as never,
  });
}

describe("atelier M06 — routeurs workshop / tech", () => {
  const users: string[] = [];
  let orgA: string;
  let orgB: string;
  let siteId: string;
  let roId: string;
  let oilLineId: string;
  let brakeLineId: string;
  let manager: Caller;
  let konan: Caller;
  let ibrahim: Caller;
  let mechanicB: Caller;

  beforeAll(async () => {
    setRepairOrdersClock(fixedClock(at("10:00")));
    orgA = (
      await adminDb.organization.create({
        data: { name: "Atelier M06 A", onboardingCompletedAt: at("06:00") },
      })
    ).id;
    orgB = (
      await adminDb.organization.create({
        data: { name: "Atelier M06 B", onboardingCompletedAt: at("06:00") },
      })
    ).id;
    siteId = (
      await adminDb.site.create({
        data: {
          organizationId: orgA,
          name: "Yopougon",
          code: "YOP",
          openingHours: { tue: [["07:30", "18:00"]] },
        },
      })
    ).id;
    await adminDb.site.create({ data: { organizationId: orgB, name: "Cocody", code: "COC" } });
    manager = await memberCaller(orgA, "MANAGER", users, "Chef d'atelier");
    konan = await memberCaller(orgA, "MECHANIC", users, "Konan Yao");
    ibrahim = await memberCaller(orgA, "MECHANIC", users, "Ibrahim Ouattara");
    mechanicB = await memberCaller(orgB, "MECHANIC", users, "Mécanicien B");
    const customer = await adminDb.customer.create({
      data: { organizationId: orgA, displayName: "Kouassi Jean-Marc" },
    });
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgA,
        customerId: customer.id,
        plate: "2547 GH 01",
        make: "Toyota",
        model: "Corolla",
      },
    });
    const clim = await adminDb.laborOperation.create({
      data: {
        organizationId: orgA,
        code: "CLIM",
        name: "Recharge climatisation",
        standardHours: 1,
        requiredSkill: "climatisation",
      },
    });
    roId = (
      await adminDb.repairOrder.create({
        data: {
          organizationId: orgA,
          siteId,
          number: "OR-YOP-2026-00042",
          customerId: customer.id,
          vehicleId: vehicle.id,
          status: "APPROVED",
          promisedAt: at("17:00"),
        },
      })
    ).id;
    const mk = (description: string, laborOperationId?: string) =>
      adminDb.repairOrderLine.create({
        data: {
          organizationId: orgA,
          repairOrderId: roId,
          type: "LABOR",
          description,
          quantity: 1,
          unitPrice: 15_000,
          vatRate: 18,
          approval: "APPROVED",
          laborOperationId,
        },
      });
    oilLineId = (await mk("Vidange moteur + filtre")).id;
    brakeLineId = (await mk("Recharge climatisation", clim.id)).id;
  });

  afterAll(async () => {
    setRepairOrdersClock(systemClock);
    for (const id of [orgA, orgB]) {
      await adminDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET session_replication_role = replica");
        for (const table of [
          "AuditLog",
          "Notification",
          "DomainEvent",
          "TechSyncOperation",
          "QualityCheck",
          "WorkNote",
          "PartRequest",
          "TimeEntry",
          "Attendance",
          "StockReservation",
          "StockMovement",
          "RepairOrderStatusHistory",
          "RepairOrderLine",
          "RepairOrder",
          "LaborOperation",
          "Vehicle",
          "Customer",
          "Membership",
          "Site",
        ]) {
          await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, id);
        }
        await tx.$executeRawUnsafe('DELETE FROM "Organization" WHERE id = $1', id);
        await tx.$executeRawUnsafe("SET session_replication_role = DEFAULT");
      });
    }
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
  });

  it("affectation : suggestion classée par score, avertissement compétence, notification", async () => {
    await syncAt(konan, "07:48", [op(konan.membershipId, 1, "attendance.in", "07:48", {})]);
    const suggestion = await manager.caller.workshop.suggestAssignees({
      repairOrderLineId: brakeLineId,
    });
    expect(suggestion.requiredSkill).toBe("climatisation");
    // Konan présent (sans la compétence) devant Ibrahim absent.
    expect(suggestion.candidates.map((c) => c.name)).toEqual(["Konan Yao", "Ibrahim Ouattara"]);
    expect(suggestion.candidates[1]!.reasons).toContain("absent");

    const assigned = await manager.caller.repairOrderLine.assign({
      id: brakeLineId,
      membershipId: konan.membershipId,
    });
    expect(assigned.skillWarning).toBe("Konan Yao n'a pas la compétence climatisation");
    await manager.caller.repairOrderLine.assign({
      id: oilLineId,
      membershipId: konan.membershipId,
    });
    const notifications = await adminDb.notification.count({
      where: { membershipId: konan.membershipId, type: "workshop.task_assigned" },
    });
    expect(notifications).toBe(2);
  });

  it("tablette : mes tâches triées, sans prix", async () => {
    const snapshot = await konan.caller.tech.bootstrap({});
    expect(snapshot.tasks.map((t) => t.description).sort()).toEqual([
      "Recharge climatisation",
      "Vidange moteur + filtre",
    ]);
    expect(snapshot.attendance?.clockIn).toEqual(at("07:48"));
    expect(JSON.stringify(snapshot)).not.toContain("unitPrice");
  });

  it("tech.sync : lot ordonné, pause auto, correction d'horloge, idempotence", async () => {
    const start = op(konan.membershipId, 1, "task.start", "10:00", {
      lineId: oilLineId,
      offline: true,
    });
    const ops = [
      op(konan.membershipId, 4, "task.resume", "10:40", { lineId: oilLineId, offline: true }),
      start,
      op(konan.membershipId, 2, "task.start", "10:20", { lineId: brakeLineId, offline: true }),
      op(konan.membershipId, 3, "task.pause", "10:30", {
        lineId: brakeLineId,
        reason: "parts",
        offline: true,
      }),
    ];
    // Tablette en avance de 2 h : 12:00 appareil = 10:00 serveur… on synchronise à 11:00 serveur.
    setRepairOrdersClock(fixedClock(at("11:00")));
    const shifted = ops.map((o) => ({ ...o, at: new Date(o.at.getTime() + 2 * 3_600_000) }));
    const result = await konan.caller.tech.sync({
      deviceId: "tablette-yop-1",
      deviceNow: at("13:00"),
      previousOffsetMs: -7_200_000,
      ops: shifted as never,
    });
    expect(result.results.map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(result.serverOffsetMs).toBe(-7_200_000);

    const entries = await adminDb.timeEntry.findMany({
      where: { membershipId: konan.membershipId },
      orderBy: { startedAt: "asc" },
    });
    expect(entries).toHaveLength(2);
    // Vidange : démarrée 10:00, mise en pause auto à 10:20 (RG-M06-06), reprise à 10:40.
    expect(entries[0]).toMatchObject({
      repairOrderLineId: oilLineId,
      startedAt: at("10:00"),
      pausedAt: null,
      pauseMinutes: 20,
      source: "offline-sync",
      needsReview: false,
    });
    // Clim : démarrée 10:20, en pause « attente pièce » depuis 10:30.
    expect(entries[1]).toMatchObject({
      repairOrderLineId: brakeLineId,
      pausedAt: at("10:30"),
      pauseReason: "parts",
    });
    const order = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: roId } });
    expect(order.status).toBe("IN_PROGRESS");

    // Même lot renvoyé (réseau coupé avant la réponse) : aucun effet.
    const again = await konan.caller.tech.sync({
      deviceId: "tablette-yop-1",
      deviceNow: at("13:01"),
      previousOffsetMs: -7_200_000,
      ops: shifted as never,
    });
    expect(again.results.map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(await adminDb.timeEntry.count({ where: { membershipId: konan.membershipId } })).toBe(2);
  });

  it("tech.sync : rejet partiel (acteur étranger, ligne annulée) sans bloquer le lot", async () => {
    await adminDb.repairOrderLine.update({
      where: { id: brakeLineId },
      data: { status: "CANCELLED" },
    });
    const result = await syncAt(konan, "11:05", [
      op(ibrahim.membershipId, 1, "task.start", "11:00", { lineId: oilLineId }),
      op(konan.membershipId, 2, "task.resume", "11:01", { lineId: brakeLineId, offline: true }),
      op(konan.membershipId, 3, "task.complete", "11:02", { lineId: brakeLineId, offline: true }),
      op(konan.membershipId, 4, "note.add", "11:03", {
        lineId: oilLineId,
        body: "Fuite au carter",
        visibleToCustomer: true,
      }),
    ]);
    expect(result.results.map((r) => [r.status, r.error ?? null])).toEqual([
      ["rejected", "Action non autorisée pour ce mécanicien."],
      ["ok", null],
      ["rejected", "Tâche annulée par le bureau. Votre temps a été enregistré."],
      ["ok", null],
    ]);
    // Le temps passé sur la ligne annulée est conservé et signalé.
    const clim = await adminDb.timeEntry.findFirstOrThrow({
      where: { repairOrderLineId: brakeLineId },
    });
    expect(clim).toMatchObject({
      endedAt: at("11:02"),
      needsReview: true,
      reviewReason: "line_cancelled",
    });
    expect(
      await adminDb.workNote.count({ where: { repairOrderId: roId, visibleToCustomer: true } }),
    ).toBe(1);
  });

  it("terminer la dernière tâche → OR en contrôle qualité, chef notifié", async () => {
    const result = await syncAt(konan, "11:30", [
      op(konan.membershipId, 1, "task.complete", "11:30", { lineId: oilLineId, note: "RAS" }),
    ]);
    expect(result.results[0]!.status).toBe("ok");
    const order = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: roId } });
    expect(order.status).toBe("QUALITY_CHECK");
    const board = await manager.caller.workshop.board({});
    const qc = board.columns.find((c) => c.key === "quality_check")!;
    expect(qc.cards.map((c) => [c.number, c.progress])).toEqual([
      ["OR-YOP-2026-00042", { done: 1, total: 1 }],
    ]);
    expect(
      await adminDb.domainEvent.count({
        where: { organizationId: orgA, type: "workshop.ro_ready_for_qc" },
      }),
    ).toBe(1);
  });

  it("CQ refusé → lignes à reprendre PENDING, OR IN_PROGRESS, reprise pointée en REWORK", async () => {
    const checklist = [
      { key: "road_test", result: "NOK" as const },
      { key: "levels", result: "OK" as const },
    ];
    await manager.caller.repairOrder.qc({
      id: roId,
      checklist,
      reject: true,
      rejectLineIds: [oilLineId],
      comment: "Bruit au ralenti",
    });
    const order = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: roId } });
    expect(order.status).toBe("IN_PROGRESS");
    const line = await adminDb.repairOrderLine.findUniqueOrThrow({ where: { id: oilLineId } });
    expect(line).toMatchObject({ status: "PENDING", assignedToId: konan.membershipId });
    const check = await adminDb.qualityCheck.findFirstOrThrow({ where: { repairOrderId: roId } });
    expect(check).toMatchObject({
      result: "FAILED",
      reworkLineIds: [oilLineId],
      checklist: { road_test: false, levels: true },
    });

    await syncAt(konan, "11:45", [
      op(konan.membershipId, 1, "task.start", "11:45", { lineId: oilLineId }),
    ]);
    const rework = await adminDb.timeEntry.findFirstOrThrow({
      where: { repairOrderLineId: oilLineId, endedAt: null },
    });
    expect(rework.kind).toBe("REWORK");
  });

  it("isolation : un mécanicien de l'org B ne peut pas pointer sur un OR de A", async () => {
    const result = await syncAt(mechanicB, "11:50", [
      op(mechanicB.membershipId, 1, "task.start", "11:50", { lineId: oilLineId }),
    ]);
    expect(result.results[0]).toMatchObject({ status: "rejected", error: "Tâche introuvable." });
    expect(await adminDb.timeEntry.count({ where: { organizationId: orgB } })).toBe(0);
    await expect(mechanicB.caller.workshop.board({})).rejects.toThrow(/workshop:view/);
    const boardB = await (await memberCaller(orgB, "MANAGER", users)).caller.workshop.board({});
    expect(boardB.columns.flatMap((c) => c.cards)).toEqual([]);
  });

  it("correction de pointage : time:edit requis, motif et audit", async () => {
    const entry = await adminDb.timeEntry.findFirstOrThrow({
      where: { repairOrderLineId: brakeLineId },
    });
    await expect(
      konan.caller.workshop.editTimeEntry({
        id: entry.id,
        startedAt: at("10:20"),
        endedAt: at("10:30"),
        pauseMinutes: 0,
        reason: "Oubli d'arrêt",
      }),
    ).rejects.toThrow(/time:edit/);
    const edited = await manager.caller.workshop.editTimeEntry({
      id: entry.id,
      startedAt: at("10:20"),
      endedAt: at("10:30"),
      pauseMinutes: 0,
      reason: "Oubli d'arrêt",
    });
    expect(edited.entry).toMatchObject({ minutes: 10, needsReview: false });
    const audit = await adminDb.auditLog.findFirstOrThrow({
      where: { organizationId: orgA, action: "time_entry.edit" },
    });
    expect(audit.reason).toBe("Oubli d'arrêt");
    const list = await manager.caller.workshop.timeEntries({ from: at("00:00"), to: at("23:59") });
    expect(list.items.some((i) => i.source === "offline-sync")).toBe(true);
  });

  it("demande de pièce : créée depuis la tablette, refusée sans motif, puis préparée", async () => {
    const result = await syncAt(konan, "11:55", [
      op(konan.membershipId, 1, "partRequest.create", "11:55", {
        repairOrderId: roId,
        lineId: oilLineId,
        freeText: "Joint de carter",
        quantity: 1,
        urgency: "HIGH",
      }),
    ]);
    const requestId = result.results[0]!.entityId!;
    expect(result.results[0]!.status).toBe("ok");
    await expect(
      manager.caller.partRequest.updateStatus({ id: requestId, status: "REJECTED" }),
    ).rejects.toThrow("Indiquez le motif du refus.");
    const prepared = await manager.caller.partRequest.updateStatus({
      id: requestId,
      status: "PREPARING",
    });
    expect(prepared.status).toBe("PREPARING");
    await expect(
      konan.caller.partRequest.updateStatus({ id: requestId, status: "DELIVERED" }),
    ).rejects.toThrow(/stock:issue/);
  });
});
