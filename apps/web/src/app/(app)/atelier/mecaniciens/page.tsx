"use client";

// M06 US-M06-03 — /atelier/mecaniciens : une carte par mécanicien (présence, tâche en cours et
// chrono, charge restante, compétences) et les tâches à affecter avec le score suggéré
// (RG-M06-04), avertissement non bloquant si la compétence manque.
import { useState } from "react";
import { CircleCheck, CircleOff, Pause, Wrench } from "lucide-react";
import { Button, EmptyState, Modal, PageHead, PlateBadge, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDuration, formatTime, tw } from "@/components/workshop/i18n";
import type { RouterOutputs } from "@/components/workshop/types";

type Unassigned = RouterOutputs["workshop"]["mechanics"]["unassigned"][number];

export default function WorkshopMechanicsPage() {
  const utils = trpc.useUtils();
  const mechanics = trpc.workshop.mechanics.useQuery({}, { refetchInterval: 30_000 });
  const me = trpc.me.get.useQuery(undefined, { staleTime: 60_000 });
  const canAssign = new Set(me.data?.permissions ?? []).has("repair_order:assign");
  const [target, setTarget] = useState<Unassigned | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead title={tw("tabs.mechanics")} description={tw("mechanics.description")} />
      {notice ? (
        <p
          role={notice.tone === "bad" ? "alert" : "status"}
          className={`text-sm ${notice.tone === "ok" ? "text-status-ok" : notice.tone === "warn" ? "text-status-warn" : "text-status-bad"}`}
        >
          {notice.text}
        </p>
      ) : null}
      {mechanics.isLoading ? (
        <ListSkeleton rows={3} />
      ) : mechanics.isError || !mechanics.data ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void mechanics.refetch()} />
      ) : (
        <>
          {mechanics.data.mechanics.length === 0 ? (
            <EmptyState title={tw("mechanics.empty")} />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {mechanics.data.mechanics.map((m) => (
                <li
                  key={m.membershipId}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{m.name}</h3>
                    {m.present ? (
                      <StatusBadge tone="ok">
                        <CircleCheck className="size-3" aria-hidden />
                        {tw("mechanics.present")}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="off">
                        <CircleOff className="size-3" aria-hidden />
                        {m.attendance?.clockOut ? tw("mechanics.left") : tw("mechanics.absent")}
                      </StatusBadge>
                    )}
                  </div>
                  {m.activeEntry ? (
                    <div className="flex flex-col gap-1 rounded-md bg-surface-2 p-2 text-sm">
                      <StatusBadge tone={m.activeEntry.state === "PAUSED" ? "warn" : "ok"}>
                        {m.activeEntry.state === "PAUSED" ? (
                          <Pause className="size-3" aria-hidden />
                        ) : (
                          <Wrench className="size-3" aria-hidden />
                        )}
                        {m.activeEntry.state === "PAUSED"
                          ? tw("mechanics.paused")
                          : tw("mechanics.onTask")}
                        {" · "}
                        {formatDuration(m.activeEntry.minutes)}
                      </StatusBadge>
                      <span>
                        {m.activeEntry.repairOrder.number} — {m.activeEntry.lineDescription}
                      </span>
                      <span className="text-xs text-muted">
                        {tw("mechanics.since", { time: formatTime(m.activeEntry.startedAt) })}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">{tw("mechanics.free")}</p>
                  )}
                  <p className="text-sm">{tw("mechanics.load", { hours: m.remainingLoad })}</p>
                  <p className="text-xs text-muted">
                    {tw("mechanics.skills")} :{" "}
                    {m.skills.length ? m.skills.join(", ") : tw("mechanics.noSkills")}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <section className="flex flex-col gap-2" aria-label={tw("mechanics.unassignedTitle")}>
            <h3 className="font-semibold">{tw("mechanics.unassignedTitle")}</h3>
            {mechanics.data.unassigned.length === 0 ? (
              <p className="text-sm text-muted">{tw("mechanics.unassignedEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {mechanics.data.unassigned.map((line) => (
                  <li
                    key={line.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{line.description}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        {line.repairOrder.number} <PlateBadge plate={line.repairOrder.plate} />
                        {tw("mechanics.hours", { hours: line.hours })}
                      </span>
                    </div>
                    {canAssign ? (
                      <Button onClick={() => setTarget(line)}>{tw("mechanics.assign")}</Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {target ? (
        <AssignModal
          line={target}
          onClose={() => setTarget(null)}
          onAssigned={(name, warning) => {
            setTarget(null);
            setNotice(
              warning
                ? { tone: "warn", text: `${tw("mechanics.assigned", { name })} — ${warning}` }
                : { tone: "ok", text: tw("mechanics.assigned", { name }) },
            );
            void utils.workshop.mechanics.invalidate();
            void utils.workshop.board.invalidate();
          }}
          onError={(text) => setNotice({ tone: "bad", text })}
        />
      ) : null}
    </div>
  );
}

function AssignModal({
  line,
  onClose,
  onAssigned,
  onError,
}: {
  line: Unassigned;
  onClose: () => void;
  onAssigned: (name: string, warning: string | null) => void;
  onError: (message: string) => void;
}) {
  const suggestions = trpc.workshop.suggestAssignees.useQuery({ repairOrderLineId: line.id });
  const assign = trpc.repairOrderLine.assign.useMutation();
  return (
    <Modal open title={tw("mechanics.suggestTitle", { task: line.description })} onClose={onClose}>
      <p className="text-sm text-muted">
        {suggestions.data?.requiredSkill
          ? tw("mechanics.requiredSkill", { skill: suggestions.data.requiredSkill })
          : tw("mechanics.noRequiredSkill")}
      </p>
      {suggestions.isLoading ? (
        <ListSkeleton rows={2} />
      ) : suggestions.isError ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void suggestions.refetch()} />
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {suggestions.data?.candidates.map((c) => (
            <li key={c.membershipId}>
              <button
                type="button"
                disabled={assign.isPending}
                onClick={() =>
                  assign.mutate(
                    { id: line.id, membershipId: c.membershipId },
                    {
                      onSuccess: (res) => onAssigned(c.name, res.skillWarning),
                      onError: (err) => onError(err.message),
                    },
                  )
                }
                className="flex min-h-11 w-full flex-col items-start gap-1 rounded-lg border border-border p-3 text-left hover:bg-surface-2"
              >
                <span className="flex w-full items-center justify-between gap-2 font-medium">
                  {c.name}
                  <span className="text-sm">{tw("mechanics.score", { score: c.score })}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {c.reasons.map((r) => (
                    <StatusBadge
                      key={r}
                      tone={
                        r === "skill_ok" || r === "on_order"
                          ? "ok"
                          : r === "overloaded"
                            ? "warn"
                            : "bad"
                      }
                      label={tw(`mechanics.reasons.${r}`)}
                    />
                  ))}
                  <span className="text-xs text-muted">
                    {tw("mechanics.load", { hours: c.remainingLoad })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
