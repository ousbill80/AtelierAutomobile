"use client";

// M06 US-M06-03 — /atelier/mecaniciens : une carte par mécanicien (présence, tâche en cours et
// chrono, charge restante, compétences) et les tâches à affecter avec le score suggéré
// (RG-M06-04), avertissement non bloquant si la compétence manque.
import { useMemo, useState } from "react";
import {
  CircleCheck,
  CircleOff,
  Clock,
  Pause,
  Search,
  UserCheck,
  Users,
  Wrench,
} from "lucide-react";
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
  const [q, setQ] = useState("");

  const mecsList = useMemo(() => mechanics.data?.mechanics ?? [], [mechanics.data?.mechanics]);
  const unassigned = useMemo(() => mechanics.data?.unassigned ?? [], [mechanics.data?.unassigned]);

  // Statistiques d'équipe
  const stats = useMemo(() => {
    const total = mecsList.length;
    const present = mecsList.filter((m) => m.present).length;
    const busy = mecsList.filter((m) => m.activeEntry && m.activeEntry.state === "RUNNING").length;
    const free = mecsList.filter((m) => m.present && !m.activeEntry).length;
    const totalLoad = Math.round(mecsList.reduce((s, m) => s + m.remainingLoad, 0) * 10) / 10;
    return { total, present, busy, free, totalLoad, unassignedCount: unassigned.length };
  }, [mecsList, unassigned.length]);

  const filteredMecs = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return mecsList;
    return mecsList.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.skills.some((s) => s.toLowerCase().includes(query)),
    );
  }, [mecsList, q]);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHead title={tw("tabs.mechanics")} description={tw("mechanics.description")} />

      {/* KPI Cards / Synthèse Équipe Atelier */}
      {mecsList.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-status-ok">
              <span className="text-xs font-medium uppercase tracking-wider">
                {tw("kpis.presentMechanics")}
              </span>
              <UserCheck className="size-4 text-status-ok" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-ok">
              {stats.present} / {stats.total}
            </span>
            <span className="text-xs text-muted">{stats.total - stats.present} absent(s)</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-accent">
              <span className="text-xs font-medium uppercase tracking-wider">
                {tw("kpis.busyMechanics")}
              </span>
              <Wrench className="size-4 text-accent" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-accent">{stats.busy}</span>
            <span className="text-xs text-muted">Sur intervention</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">
                {tw("kpis.freeMechanics")}
              </span>
              <Users className="size-4 text-muted" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{stats.free}</span>
            <span className="text-xs text-muted">Prêts pour tâche</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-status-warn">
              <span className="text-xs font-medium uppercase tracking-wider">
                {tw("kpis.unassignedTasks")}
              </span>
              <Clock className="size-4 text-status-warn" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-warn">
              {stats.unassignedCount}
            </span>
            <span className="text-xs text-muted">À distribuer</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">
                {tw("kpis.totalLoad")}
              </span>
              <Clock className="size-4 text-muted" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{stats.totalLoad} h</span>
            <span className="text-xs text-muted">Charge planifiée</span>
          </div>
        </div>
      ) : null}

      {/* Barre de recherche mécanicien */}
      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1 max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            placeholder="Rechercher par nom ou compétence…"
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {notice ? (
        <p
          role={notice.tone === "bad" ? "alert" : "status"}
          className={`text-sm ${
            notice.tone === "ok"
              ? "text-status-ok"
              : notice.tone === "warn"
                ? "text-status-warn"
                : "text-status-bad"
          }`}
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
          {filteredMecs.length === 0 ? (
            <EmptyState title={tw("mechanics.empty")} />
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredMecs.map((m) => (
                <li
                  key={m.membershipId}
                  className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-base text-foreground">{m.name}</h3>
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
                    <div className="flex flex-col gap-1 rounded-lg bg-surface-2 p-2.5 text-sm">
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
                      <span className="font-medium text-foreground">
                        {m.activeEntry.repairOrder.number} — {m.activeEntry.lineDescription}
                      </span>
                      <span className="text-xs text-muted">
                        {tw("mechanics.since", { time: formatTime(m.activeEntry.startedAt) })}
                      </span>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-surface-2/50 p-2.5 text-sm text-muted">
                      {tw("mechanics.free")}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-muted border-t border-border pt-2">
                    <span>{tw("mechanics.load", { hours: m.remainingLoad })}</span>
                    <span className="truncate max-w-[200px]" title={m.skills.join(", ")}>
                      {m.skills.length ? m.skills.join(", ") : tw("mechanics.noSkills")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Section Tâches non affectées */}
          <section
            className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
            aria-label={tw("mechanics.unassignedTitle")}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base text-foreground flex items-center gap-2">
                <span>{tw("mechanics.unassignedTitle")}</span>
                <span className="rounded-full bg-status-warn/20 px-2 py-0.5 text-xs font-bold text-status-warn">
                  {unassigned.length}
                </span>
              </h3>
            </div>

            {unassigned.length === 0 ? (
              <p className="text-sm text-muted py-2">{tw("mechanics.unassignedEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {unassigned.map((line) => (
                  <li
                    key={line.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 p-3"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium text-foreground">{line.description}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        {line.repairOrder.number} <PlateBadge plate={line.repairOrder.plate} />
                        <span>·</span>
                        {tw("mechanics.hours", { hours: line.hours })}
                      </span>
                    </div>
                    {canAssign ? (
                      <Button variant="secondary" onClick={() => setTarget(line)}>
                        {tw("mechanics.assign")}
                      </Button>
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
            setNotice({
              tone: warning ? "warn" : "ok",
              text: `${tw("mechanics.assigned", { task: target.description, name })}${
                warning ? ` — ${warning}` : ""
              }`,
            });
            void utils.workshop.mechanics.invalidate();
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
                className="flex min-h-11 w-full flex-col items-start gap-1 rounded-lg border border-border p-3 text-left hover:bg-surface-2 transition"
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
