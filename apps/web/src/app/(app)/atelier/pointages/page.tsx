"use client";

// M06 §7 / RG-M06-16 — /atelier/pointages : pointages du jour (filtre mécanicien, « à vérifier »),
// correction avec motif (audit avant/après), validation des entrées signalées, présences du
// jour, export CSV.
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  Pause,
  Play,
  Search,
  UserCheck,
} from "lucide-react";
import { Button, Field, Input, Modal, PageHead, Select, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { fromLocalInput, toLocalInput } from "@/components/repair-orders/i18n";
import { downloadCsv, formatDuration, formatTime, tw } from "@/components/workshop/i18n";
import type { RouterOutputs } from "@/components/workshop/types";

type Entry = RouterOutputs["workshop"]["timeEntries"]["items"][number];
const TZ = "Africa/Abidjan";

function todayKey() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
}

function shiftDay(current: string, deltaDays: number): string {
  const d = new Date(`${current}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export default function TimeEntriesPage() {
  const utils = trpc.useUtils();
  const [day, setDay] = useState(todayKey);
  const [needsReview, setNeedsReview] = useState(false);
  const [membershipId, setMembershipId] = useState("");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [q, setQ] = useState("");

  const range = useMemo(() => {
    const from = fromLocalInput(`${day}T00:00`, TZ) ?? new Date();
    return { from, to: new Date(from.getTime() + 86_400_000) };
  }, [day]);

  const mechanics = trpc.workshop.mechanics.useQuery({}, { staleTime: 60_000 });
  const entries = trpc.workshop.timeEntries.useQuery({
    ...range,
    needsReview: needsReview || undefined,
    membershipId: membershipId || undefined,
    limit: 200,
  });
  const review = trpc.workshop.reviewTimeEntry.useMutation({
    onSuccess: () => void utils.workshop.timeEntries.invalidate(),
  });
  const timeZone = entries.data?.timeZone ?? TZ;

  const rawItems = useMemo(() => entries.data?.items ?? [], [entries.data?.items]);

  // Statistiques de la journée
  const stats = useMemo(() => {
    const totalMinutes = rawItems.reduce((s, e) => s + (e.minutes ?? 0), 0);
    const active = rawItems.filter((e) => e.state === "RUNNING" || e.state === "PAUSED").length;
    const reviewCount = rawItems.filter((e) => e.needsReview).length;
    const attendancesCount = entries.data?.attendances.length ?? 0;
    return { totalMinutes, active, reviewCount, attendancesCount, totalEntries: rawItems.length };
  }, [rawItems, entries.data?.attendances.length]);

  const filteredItems = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rawItems;
    return rawItems.filter(
      (e) =>
        e.mechanicName.toLowerCase().includes(query) ||
        e.repairOrder.number.toLowerCase().includes(query) ||
        (e.lineDescription ? e.lineDescription.toLowerCase().includes(query) : false),
    );
  }, [rawItems, q]);

  const exportCsv = () => {
    if (!entries.data) return;
    downloadCsv(`pointages-${day}.csv`, [
      [
        tw("time.mechanic"),
        tw("time.order"),
        tw("time.task"),
        tw("time.start"),
        tw("time.end"),
        tw("time.pause"),
        tw("time.duration"),
        tw("time.kind"),
        tw("time.source"),
        tw("time.toReview"),
      ],
      ...entries.data.items.map((e) => [
        e.mechanicName,
        e.repairOrder.number,
        e.lineDescription,
        formatTime(e.startedAt, timeZone),
        e.endedAt ? formatTime(e.endedAt, timeZone) : "",
        e.pauseMinutes,
        e.minutes,
        tw(`time.kinds.${e.kind}`),
        tw(`time.sources.${e.source}`),
        e.needsReview ? tw("time.toReview") : "",
      ]),
    ]);
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHead
        title={tw("tabs.timeEntries")}
        description={tw("time.description")}
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!entries.data}>
            <Download className="size-4" aria-hidden />
            {tw("exportCsv")}
          </Button>
        }
      />

      {/* KPI Cards / Synthèse Pointages */}
      {entries.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.totalHoursToday")}</span>
              <Clock className="size-4 text-accent" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">
              {formatDuration(stats.totalMinutes)}
            </span>
            <span className="text-xs text-muted">{stats.totalEntries} pointage(s)</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-status-ok">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.productiveHours")}</span>
              <Play className="size-4 text-status-ok" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-ok">{stats.active}</span>
            <span className="text-xs text-muted">En cours actuellement</span>
          </div>

          <button
            type="button"
            onClick={() => setNeedsReview(!needsReview)}
            className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
              needsReview
                ? "border-status-warn bg-status-warn/10 shadow-sm"
                : "border-border bg-surface hover:border-status-warn/50"
            }`}
          >
            <div className="flex items-center justify-between text-status-warn">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.toReviewCount")}</span>
              <AlertTriangle className="size-4 text-status-warn" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-warn">
              {stats.reviewCount}
            </span>
            <span className="text-xs text-muted">À valider ou corriger</span>
          </button>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">Présences</span>
              <UserCheck className="size-4 text-muted" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{stats.attendancesCount}</span>
            <span className="text-xs text-muted">Mécaniciens pointés</span>
          </div>
        </div>
      ) : null}

      {/* Barre de navigation date et filtres */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setDay(shiftDay(day, -1))}
            aria-label="Jour précédent"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Button>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-muted">{tw("time.date")}</span>
            <Input
              type="date"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="max-w-[170px]"
            />
          </div>

          <Button
            variant="ghost"
            onClick={() => setDay(shiftDay(day, 1))}
            aria-label="Jour suivant"
          >
            <ArrowRight className="size-4" aria-hidden />
          </Button>

          <Button variant="ghost" onClick={() => setDay(todayKey())} className="text-xs">
            Aujourd&apos;hui
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-48 max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={q}
              placeholder="Mécanicien, OR ou tâche…"
              onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="w-full sm:w-auto sm:min-w-44">
            <Select value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
              <option value="">{tw("board.allMechanics")}</option>
              {mechanics.data?.mechanics.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>

          <button
            type="button"
            onClick={() => setNeedsReview(!needsReview)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition ${
              needsReview
                ? "border-status-warn bg-status-warn/10 text-status-warn font-semibold"
                : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <AlertTriangle className="size-4" aria-hidden />
            {tw("time.needsReviewOnly")}
          </button>
        </div>
      </div>

      {entries.isLoading ? (
        <ListSkeleton rows={4} />
      ) : entries.isError || !entries.data ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void entries.refetch()} />
      ) : (
        <>
          {filteredItems.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">{tw("time.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2.5" aria-label={tw("tabs.timeEntries")}>
              {filteredItems.map((e) => (
                <li
                  key={e.id}
                  data-testid="time-entry"
                  className={`flex flex-col justify-between gap-3 rounded-xl border bg-surface p-4 shadow-sm md:flex-row md:items-center ${
                    e.needsReview ? "border-status-warn" : "border-border"
                  }`}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-base text-foreground">{e.mechanicName}</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-mono font-medium text-foreground">
                        {e.repairOrder.number}
                      </span>
                    </div>
                    <span className="truncate text-sm text-muted">{e.lineDescription}</span>
                    <span className="text-xs text-muted pt-0.5">
                      {formatTime(e.startedAt, timeZone)} →{" "}
                      {e.endedAt ? formatTime(e.endedAt, timeZone) : "En cours"} ·{" "}
                      <strong className="text-foreground">{formatDuration(e.minutes)}</strong>
                      {e.pauseMinutes > 0 ? ` · ${tw("time.pause")} ${e.pauseMinutes} min` : ""}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      tone={e.state === "STOPPED" ? "off" : e.state === "PAUSED" ? "warn" : "ok"}
                    >
                      {e.state === "PAUSED" ? (
                        <Pause className="size-3" aria-hidden />
                      ) : e.state === "RUNNING" ? (
                        <Play className="size-3" aria-hidden />
                      ) : (
                        <CheckCircle2 className="size-3" aria-hidden />
                      )}
                      {tw(
                        e.state === "STOPPED"
                          ? "time.stopped"
                          : e.state === "PAUSED"
                          ? "time.pausedState"
                          : "time.running",
                      )}
                    </StatusBadge>

                    <StatusBadge
                      tone={e.kind === "REWORK" ? "warn" : "off"}
                      label={tw(`time.kinds.${e.kind}`)}
                    />

                    {e.needsReview ? (
                      <StatusBadge tone="warn">
                        <AlertTriangle className="size-3" aria-hidden />
                        {tw("time.toReview")}
                        {e.reviewReason
                          ? ` · ${e.reviewReason
                              .split(", ")
                              .map((r) => tw(`time.reviewReasons.${r}`))
                              .join(", ")}`
                          : ""}
                      </StatusBadge>
                    ) : null}

                    <div className="flex items-center gap-1.5">
                      <Button variant="secondary" onClick={() => setEditing(e)}>
                        {tw("time.edit")}
                      </Button>
                      {e.needsReview ? (
                        <Button
                          onClick={() => review.mutate({ id: e.id })}
                          disabled={review.isPending}
                        >
                          {tw("time.validate")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Section Présences du jour */}
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm" aria-label={tw("time.attendanceTitle")}>
            <h3 className="font-semibold text-base text-foreground">{tw("time.attendanceTitle")}</h3>
            {entries.data.attendances.length === 0 ? (
              <p className="text-sm text-muted">{tw("time.attendanceEmpty")}</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {entries.data.attendances.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2/40 p-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between font-semibold text-sm text-foreground">
                      <span>{a.mechanicName}</span>
                      {a.autoClosed ? (
                        <StatusBadge tone="warn" label={tw("time.autoClosed")} />
                      ) : null}
                    </div>
                    <div className="text-muted">
                      {tw("time.arrival")} <strong>{formatTime(a.clockIn, timeZone)}</strong> ·{" "}
                      {tw("time.departure")} <strong>{formatTime(a.clockOut, timeZone)}</strong>
                    </div>
                    <div className="text-muted">
                      {tw("time.presence")} <strong className="text-foreground">{formatDuration(a.presenceMinutes)}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {editing ? (
        <EditEntryModal
          entry={editing}
          timeZone={timeZone}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void utils.workshop.timeEntries.invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function EditEntryModal({
  entry,
  timeZone,
  onClose,
  onSaved,
}: {
  entry: Entry;
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startedAt, setStartedAt] = useState(toLocalInput(entry.startedAt, timeZone));
  const [endedAt, setEndedAt] = useState(toLocalInput(entry.endedAt, timeZone));
  const [pauseMinutes, setPauseMinutes] = useState(String(entry.pauseMinutes));
  const [reason, setReason] = useState("");
  const edit = trpc.workshop.editTimeEntry.useMutation({ onSuccess: onSaved });
  return (
    <Modal
      open
      title={tw("time.editTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tw("cancel")}
          </Button>
          <Button
            disabled={edit.isPending || reason.trim().length < 3}
            onClick={() =>
              edit.mutate({
                id: entry.id,
                startedAt: fromLocalInput(startedAt, timeZone) ?? new Date(entry.startedAt),
                endedAt: endedAt ? (fromLocalInput(endedAt, timeZone) ?? null) : null,
                pauseMinutes: Number(pauseMinutes) || 0,
                reason,
              })
            }
          >
            {tw("save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={tw("time.start")}>
          <Input
            type="datetime-local"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
          />
        </Field>
        <Field label={tw("time.end")}>
          <Input
            type="datetime-local"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
          />
        </Field>
        <Field label={tw("time.pause")}>
          <Input
            type="number"
            min={0}
            value={pauseMinutes}
            onChange={(e) => setPauseMinutes(e.target.value)}
          />
        </Field>
        <Field label={tw("time.reason")} hint={tw("time.reasonHint")}>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
          />
        </Field>
        {edit.error ? (
          <p role="alert" className="text-sm text-status-bad">
            {edit.error.message}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
