"use client";

// M06 §7 / RG-M06-16 — /atelier/pointages : pointages du jour (filtre mécanicien, « à vérifier »),
// correction avec motif (audit avant/après), validation des entrées signalées, présences du
// jour, export CSV.
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Pause, Play } from "lucide-react";
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

export default function TimeEntriesPage() {
  const utils = trpc.useUtils();
  const [day, setDay] = useState(todayKey);
  const [needsReview, setNeedsReview] = useState(false);
  const [membershipId, setMembershipId] = useState("");
  const [editing, setEditing] = useState<Entry | null>(null);
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
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead
        title={tw("tabs.timeEntries")}
        description={tw("time.description")}
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!entries.data}>
            {tw("exportCsv")}
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {tw("time.date")}
          <Input
            type="date"
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {tw("time.mechanic")}
          <Select value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
            <option value="">{tw("board.allMechanics")}</option>
            {mechanics.data?.mechanics.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={needsReview}
            onChange={(e) => setNeedsReview(e.target.checked)}
          />
          {tw("time.needsReviewOnly")}
        </label>
      </div>

      {entries.isLoading ? (
        <ListSkeleton rows={4} />
      ) : entries.isError || !entries.data ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void entries.refetch()} />
      ) : (
        <>
          {entries.data.items.length === 0 ? (
            <p className="text-sm text-muted">{tw("time.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label={tw("tabs.timeEntries")}>
              {entries.data.items.map((e) => (
                <li
                  key={e.id}
                  data-testid="time-entry"
                  className={`flex flex-col gap-2 rounded-lg border bg-surface p-3 md:flex-row md:items-center ${
                    e.needsReview ? "border-status-warn" : "border-border"
                  }`}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium">
                      {e.mechanicName} · {e.repairOrder.number}
                    </span>
                    <span className="truncate text-sm text-muted">{e.lineDescription}</span>
                    <span className="text-sm">
                      {formatTime(e.startedAt, timeZone)} →{" "}
                      {e.endedAt ? formatTime(e.endedAt, timeZone) : "…"} ·{" "}
                      {formatDuration(e.minutes)}
                      {e.pauseMinutes > 0 ? ` · ${tw("time.pause")} ${e.pauseMinutes}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
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
                    <StatusBadge tone="off" label={tw(`time.sources.${e.source}`)} />
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
                  </div>
                  <div className="flex gap-2">
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
                </li>
              ))}
            </ul>
          )}

          <section className="flex flex-col gap-2" aria-label={tw("time.attendanceTitle")}>
            <h3 className="font-semibold">{tw("time.attendanceTitle")}</h3>
            {entries.data.attendances.length === 0 ? (
              <p className="text-sm text-muted">{tw("time.attendanceEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {entries.data.attendances.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{a.mechanicName}</span>
                    <span>
                      {tw("time.arrival")} {formatTime(a.clockIn, timeZone)} ·{" "}
                      {tw("time.departure")} {formatTime(a.clockOut, timeZone)}
                    </span>
                    <span>
                      {tw("time.presence")} {formatDuration(a.presenceMinutes)}
                    </span>
                    {a.autoClosed ? (
                      <StatusBadge tone="warn" label={tw("time.autoClosed")} />
                    ) : null}
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
