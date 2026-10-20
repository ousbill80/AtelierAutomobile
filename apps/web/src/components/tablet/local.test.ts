import { describe, expect, it } from "vitest";
import type { TechSnapshot } from "@/components/workshop/types";
import { applyLocalOp, liveMinutes, replayPending } from "./local";
import type { OutboxOp } from "./store";

// RG-M06-06/07 côté tablette : l'écran reflète les actions mises en file hors-ligne.
const at = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00.000Z`);

function task(id: string): TechSnapshot["tasks"][number] {
  return {
    id,
    description: id,
    type: "LABOR",
    status: "PENDING",
    standardHours: 1,
    updatedAt: at("07:00"),
    photoCount: 0,
    notes: [],
    entry: null,
    order: {
      id: "ro1",
      number: "OR-YOP-2026-00042",
      status: "APPROVED",
      priority: "NORMAL",
      promisedAt: null,
      complaint: null,
      diagnosis: null,
      customerName: "Kouassi Jean-Marc",
      vehicle: { plate: "2547 GH 01", make: "Toyota", model: "Corolla", year: null },
      parts: [],
      partRequests: [],
    },
  };
}

const snapshot: TechSnapshot = {
  serverNow: at("07:00"),
  timeZone: "Africa/Abidjan",
  membershipId: "konan",
  attendance: null,
  tasks: [task("vidange"), task("clim")],
  inspections: [],
};

let seq = 0;
const op = (type: string, time: string, extra: Record<string, unknown> = {}): OutboxOp => ({
  seq: ++seq,
  clientOpId: `op-${seq}`,
  type,
  at: at(time),
  actorMembershipId: "konan",
  offline: true,
  ...extra,
});

describe("applyLocalOp", () => {
  it("démarrer, mettre en pause, reprendre, terminer", () => {
    const started = applyLocalOp(snapshot, op("task.start", "08:00", { lineId: "vidange" }));
    expect(started.tasks[0]).toMatchObject({ status: "IN_PROGRESS", entry: { state: "RUNNING" } });
    const paused = applyLocalOp(started, op("task.pause", "08:30", { lineId: "vidange" }));
    expect(paused.tasks[0]!.entry).toMatchObject({ state: "PAUSED", pausedAt: at("08:30") });
    const resumed = applyLocalOp(paused, op("task.resume", "08:45", { lineId: "vidange" }));
    expect(resumed.tasks[0]!.entry).toMatchObject({ state: "RUNNING", pauseMinutes: 15 });
    expect(liveMinutes(resumed.tasks[0]!.entry, at("09:00"))).toBe(45);
    const done = applyLocalOp(resumed, op("task.complete", "09:00", { lineId: "vidange" }));
    expect(done.tasks[0]).toMatchObject({ status: "DONE", entry: null });
  });

  it("RG-M06-06 : démarrer une autre tâche met la première en pause", () => {
    const state = replayPending(snapshot, [
      op("task.start", "08:00", { lineId: "vidange" }),
      op("task.start", "08:20", { lineId: "clim" }),
    ]);
    expect(state.tasks[0]!.entry).toMatchObject({ state: "PAUSED", pausedAt: at("08:20") });
    expect(state.tasks[1]!.entry).toMatchObject({ state: "RUNNING" });
  });

  it("présence : arrivée puis départ (tâche en cours mise en pause)", () => {
    const state = replayPending(snapshot, [
      op("attendance.in", "07:48"),
      op("task.start", "08:00", { lineId: "vidange" }),
      op("attendance.out", "17:00"),
    ]);
    expect(state.attendance).toEqual({ clockIn: at("07:48"), clockOut: at("17:00") });
    expect(state.tasks[0]!.entry).toMatchObject({ state: "PAUSED" });
  });

  it("remarque et demande de pièce visibles avant la synchro", () => {
    const state = replayPending(snapshot, [
      op("note.add", "08:10", {
        lineId: "vidange",
        body: "Fuite au carter",
        visibleToCustomer: true,
      }),
      op("partRequest.create", "08:12", {
        repairOrderId: "ro1",
        label: "Joint de carter",
        quantity: 1,
      }),
    ]);
    expect(state.tasks[0]!.notes.map((n) => n.body)).toEqual(["Fuite au carter"]);
    expect(state.tasks[0]!.order.partRequests[0]).toMatchObject({
      label: "Joint de carter",
      status: "REQUESTED",
    });
  });
});
