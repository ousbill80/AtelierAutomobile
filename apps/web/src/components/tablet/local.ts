// M06 RG-M06-06/07/13 — application locale (optimiste) d'une opération de la tablette sur
// l'instantané en cache : l'écran reflète l'action tout de suite, même hors-ligne ; le serveur
// tranche à la synchronisation (RG-M06-14). Fonction pure.
import { computeDurationMinutes, pauseEntry, resumeEntry } from "@atelieros/core/workshop";
import type { TechSnapshot, TechTask } from "@/components/workshop/types";
import type { OutboxOp } from "./store";

type Entry = NonNullable<TechTask["entry"]>;

function withEntry(task: TechTask, entry: Entry | null, now: Date): TechTask {
  if (!entry) return { ...task, entry: null };
  return {
    ...task,
    entry: {
      ...entry,
      state: entry.pausedAt ? "PAUSED" : "RUNNING",
      minutes: computeDurationMinutes({ ...entry, endedAt: null }, now),
    },
  };
}

function pauseOthers(tasks: TechTask[], exceptId: string, at: Date): TechTask[] {
  return tasks.map((t) => {
    if (t.id === exceptId || !t.entry || t.entry.pausedAt) return t;
    const patch = pauseEntry({ ...t.entry, endedAt: null }, at, "other");
    return patch ? withEntry(t, { ...t.entry, pausedAt: patch.pausedAt ?? at }, at) : t;
  });
}

function startOrResume(snapshot: TechSnapshot, lineId: string, at: Date): TechSnapshot {
  const tasks = pauseOthers(snapshot.tasks, lineId, at).map((t) => {
    if (t.id !== lineId) return t;
    if (t.entry?.pausedAt) {
      const patch = resumeEntry({ ...t.entry, endedAt: null }, at);
      return withEntry(
        { ...t, status: t.status === "PENDING" ? "IN_PROGRESS" : t.status },
        { ...t.entry, pausedAt: null, pauseMinutes: patch?.pauseMinutes ?? t.entry.pauseMinutes },
        at,
      );
    }
    if (t.entry) return t;
    return withEntry(
      { ...t, status: t.status === "PENDING" ? "IN_PROGRESS" : t.status },
      {
        id: `local-${lineId}`,
        startedAt: at,
        pausedAt: null,
        pauseMinutes: 0,
        state: "RUNNING",
        minutes: 0,
      },
      at,
    );
  });
  return { ...snapshot, tasks };
}

export function applyLocalOp(snapshot: TechSnapshot, op: OutboxOp): TechSnapshot {
  const at = new Date(op.at);
  const lineId = op.lineId as string | undefined;
  switch (op.type) {
    case "task.start":
    case "task.resume":
      return lineId ? startOrResume(snapshot, lineId, at) : snapshot;
    case "task.pause":
      return {
        ...snapshot,
        tasks: snapshot.tasks.map((t) =>
          t.id === lineId && t.entry && !t.entry.pausedAt
            ? withEntry(t, { ...t.entry, pausedAt: at }, at)
            : t,
        ),
      };
    case "task.complete":
      return {
        ...snapshot,
        tasks: snapshot.tasks.map((t) =>
          t.id === lineId
            ? { ...t, status: t.status === "CANCELLED" ? t.status : "DONE", entry: null }
            : t,
        ),
      };
    case "note.add":
      return {
        ...snapshot,
        tasks: snapshot.tasks.map((t) =>
          t.id === lineId
            ? {
                ...t,
                notes: [
                  ...t.notes,
                  {
                    id: op.clientOpId,
                    body: String(op.body ?? ""),
                    visibleToCustomer: op.visibleToCustomer === true,
                    createdAt: at,
                  },
                ],
              }
            : t,
        ),
      };
    case "attendance.in":
      return {
        ...snapshot,
        attendance: { clockIn: snapshot.attendance?.clockIn ?? at, clockOut: null },
      };
    case "attendance.out":
      return {
        ...snapshot,
        tasks: pauseOthers(snapshot.tasks, "", at),
        attendance: { clockIn: snapshot.attendance?.clockIn ?? null, clockOut: at },
      };
    case "inspection.setItem":
      return {
        ...snapshot,
        inspections: snapshot.inspections.map((i) => ({
          ...i,
          items: i.items.map((it) =>
            it.id === op.itemId
              ? {
                  ...it,
                  result: op.result as typeof it.result,
                  measurement: (op.measurement as string | null | undefined) ?? it.measurement,
                  comment: (op.comment as string | null | undefined) ?? it.comment,
                }
              : it,
          ),
        })),
      };
    case "inspection.complete":
      return {
        ...snapshot,
        inspections: snapshot.inspections.filter((i) => i.id !== op.inspectionId),
      };
    case "partRequest.create":
      return {
        ...snapshot,
        tasks: snapshot.tasks.map((t) =>
          t.order.id === op.repairOrderId
            ? {
                ...t,
                order: {
                  ...t.order,
                  partRequests: [
                    {
                      id: op.clientOpId,
                      label: String(op.label ?? op.freeText ?? ""),
                      quantity: Number(op.quantity),
                      status: "REQUESTED" as const,
                    },
                    ...t.order.partRequests,
                  ],
                },
              }
            : t,
        ),
      };
    default:
      return snapshot;
  }
}

/** Instantané serveur + opérations encore en file (ré-appliquées après une synchro). */
export function replayPending(snapshot: TechSnapshot, ops: readonly OutboxOp[]): TechSnapshot {
  return ops.reduce(applyLocalOp, snapshot);
}

/** Chrono d'une tâche à l'instant `now` (RG-M06-05). */
export function liveMinutes(entry: TechTask["entry"], now: Date): number {
  if (!entry) return 0;
  return computeDurationMinutes({ ...entry, endedAt: null }, now);
}
