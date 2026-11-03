"use client";

// M06 §7 / RG-M06-16 — /atelier/pointages : présences du jour (saisie et correction par le
// chef, avec motif) et temps passé sur les ordres (filtre mécanicien, « à vérifier »).
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, LogOut, Play, UserX, Users } from "lucide-react";
import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHead,
  Select,
  StatusBadge,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { fromLocalInput, toLocalInput } from "@/components/repair-orders/i18n";
import { downloadCsv, formatDuration, formatTime, tw } from "@/components/workshop/i18n";
import type { RouterOutputs } from "@/components/workshop/types";

type Entry = RouterOutputs["workshop"]["timeEntries"]["items"][number];
type TeamMember = RouterOutputs["workshop"]["timeEntries"]["team"][number];
type Presence = TeamMember["status"];
const TZ = "Africa/Abidjan";

function todayKey() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
}

export default function TimeEntriesPage() {
  const utils = trpc.useUtils();
  const [day, setDay] = useState(todayKey);
  const [needsReview, setNeedsReview] = useState(false);
  const [membershipId, setMembershipId] = useState("");
  const [orderQuery, setOrderQuery] = useState("");
  const [presence, setPresence] = useState<Presence | "">("");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [attendance, setAttendance] = useState<TeamMember | null>(null);
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
  const team = entries.data?.team ?? [];
  const visibleTeam = presence ? team.filter((m) => m.status === presence) : team;
  const pointed = (entries.data?.items ?? []).reduce((sum, e) => sum + e.minutes, 0);
  const reviewCount = (entries.data?.items ?? []).filter((e) => e.needsReview).length;
  const orderNeedle = orderQuery.trim().toLowerCase();
  const visibleEntries = (entries.data?.items ?? []).filter(
    (e) => !orderNeedle || e.repairOrder.number.toLowerCase().includes(orderNeedle),
  );
  const live = (entries.data?.items ?? []).filter((e) => e.state !== "STOPPED");

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
      ...entries.data.team.map((m) => [
        m.name,
        tw("time.attendanceTitle"),
        "",
        m.clockIn ? formatTime(m.clockIn, timeZone) : "",
        m.clockOut ? formatTime(m.clockOut, timeZone) : "",
        m.breakMinutes,
        m.presenceMinutes,
        tw(`time.status${m.status[0]!.toUpperCase()}${m.status.slice(1)}`),
        "",
        m.autoClosed ? tw("time.autoClosed") : "",
      ]),
    ]);
  };

  const togglePresence = (next: Presence) => {
    setNeedsReview(false);
    setPresence((current) => (current === next ? "" : next));
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
        <label className="flex flex-col gap-1 text-sm">
          {tw("time.searchOrder")}
          <Input
            value={orderQuery}
            onChange={(e) => setOrderQuery(e.target.value)}
            placeholder="OR-2026-00012"
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={needsReview}
            onChange={(e) => {
              setNeedsReview(e.target.checked);
              if (e.target.checked) setPresence("");
            }}
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
          <div className="mini-stats cols-5">
            <SummaryStat
              icon={Users}
              tone="ok"
              label={tw("time.present")}
              value={String(team.filter((m) => m.status === "present").length)}
              pressed={presence === "present"}
              onClick={() => togglePresence("present")}
            />
            <SummaryStat
              icon={LogOut}
              label={tw("time.left")}
              value={String(team.filter((m) => m.status === "left").length)}
              pressed={presence === "left"}
              onClick={() => togglePresence("left")}
            />
            <SummaryStat
              icon={UserX}
              tone="warn"
              label={tw("time.absent")}
              value={String(team.filter((m) => m.status === "absent").length)}
              pressed={presence === "absent"}
              onClick={() => togglePresence("absent")}
            />
            <SummaryStat
              icon={AlertTriangle}
              tone={reviewCount > 0 ? "warn" : undefined}
              label={tw("time.toReview")}
              value={String(reviewCount)}
              pressed={needsReview}
              onClick={() => {
                setPresence("");
                setNeedsReview((v) => !v);
              }}
            />
            <SummaryStat icon={Clock} label={tw("time.pointed")} value={formatDuration(pointed)} />
          </div>

          {live.length > 0 ? (
            <section className="flex flex-col gap-2" aria-label={tw("time.liveTitle")}>
              <h2 className="font-semibold">{tw("time.liveTitle")}</h2>
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {live.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3"
                  >
                    <span className="font-medium">{e.mechanicName}</span>
                    <span className="text-sm">
                      <Link href={`/ordres/${e.repairOrder.id}`} className="underline">
                        {e.repairOrder.number}
                      </Link>
                      {e.lineDescription ? ` — ${e.lineDescription}` : ""}
                    </span>
                    <span className="text-sm text-muted">
                      {tw(e.state === "PAUSED" ? "time.pausedState" : "time.running")} ·{" "}
                      {formatDuration(e.minutes)}
                      {e.carriedOver ? ` · ${tw("time.carriedOver")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-col gap-2" aria-label={tw("time.teamTitle")}>
            <div>
              <h2 className="font-semibold">{tw("time.teamTitle")}</h2>
              <p className="text-sm text-muted">{tw("time.teamHint")}</p>
            </div>
            {team.length === 0 ? (
              <EmptyState title={tw("time.teamEmpty")} />
            ) : visibleTeam.length === 0 ? (
              <p className="text-sm text-muted">{tw("time.filterEmpty")}</p>
            ) : (
              <div className="listing-table-wrap overflow-x-auto">
                <table className="listing-table min-w-[880px]">
                  <thead>
                    <tr>
                      <th>{tw("time.mechanic")}</th>
                      <th>{tw("time.status")}</th>
                      <th>{tw("time.arrival")}</th>
                      <th>{tw("time.departure")}</th>
                      <th>{tw("time.presence")}</th>
                      <th>{tw("time.pointed")}</th>
                      <th>{tw("time.gap")}</th>
                      <th>{tw("time.currentTask")}</th>
                      <th>{tw("time.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTeam.map((m) => {
                      const gap = m.presenceMinutes - m.pointedMinutes;
                      return (
                        <tr key={m.membershipId}>
                          <td className="font-medium">{m.name}</td>
                          <td>
                            <StatusBadge
                              tone={
                                m.status === "present" ? "ok" : m.status === "left" ? "off" : "warn"
                              }
                            >
                              {m.status === "present" ? (
                                <Play className="size-3" aria-hidden />
                              ) : m.status === "left" ? (
                                <LogOut className="size-3" aria-hidden />
                              ) : (
                                <UserX className="size-3" aria-hidden />
                              )}
                              {tw(
                                m.status === "present"
                                  ? "time.statusPresent"
                                  : m.status === "left"
                                    ? "time.statusLeft"
                                    : "time.statusAbsent",
                              )}
                            </StatusBadge>
                            {m.autoClosed ? (
                              <StatusBadge tone="warn" label={tw("time.autoClosed")} />
                            ) : null}
                          </td>
                          <td>{m.clockIn ? formatTime(m.clockIn, timeZone) : "—"}</td>
                          <td>{m.clockOut ? formatTime(m.clockOut, timeZone) : "—"}</td>
                          <td>{m.clockIn ? formatDuration(m.presenceMinutes) : "—"}</td>
                          <td>{m.pointedMinutes > 0 ? formatDuration(m.pointedMinutes) : "—"}</td>
                          <td>
                            {!m.clockIn && m.pointedMinutes > 0 ? (
                              <StatusBadge tone="warn" label={tw("time.noArrival")} />
                            ) : m.clockIn ? (
                              <span className={gap < 0 ? "font-medium text-status-warn" : ""}>
                                {gap < 0 ? `− ${formatDuration(-gap)}` : formatDuration(gap)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {m.active ? (
                              <span>
                                <Link
                                  href={`/ordres/${m.active.repairOrder.id}`}
                                  className="underline"
                                >
                                  {m.active.repairOrder.number}
                                </Link>
                                {m.active.lineDescription ? ` — ${m.active.lineDescription}` : ""}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <Button variant="secondary" onClick={() => setAttendance(m)}>
                              {m.attendanceId
                                ? m.clockOut
                                  ? tw("time.correctAttendance")
                                  : tw("time.recordDeparture")
                                : tw("time.recordArrival")}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2" aria-label={tw("time.tasksTitle")}>
            <h2 className="font-semibold">{tw("time.tasksTitle")}</h2>
            {entries.data.items.length === 0 ? (
              <p className="text-sm text-muted">{tw("time.empty")}</p>
            ) : visibleEntries.length === 0 ? (
              <p className="text-sm text-muted">{tw("time.noMatch")}</p>
            ) : (
              <div className="listing-table-wrap overflow-x-auto">
                <table className="listing-table min-w-[960px]">
                  <thead>
                    <tr>
                      <th>{tw("time.mechanic")}</th>
                      <th>{tw("time.order")}</th>
                      <th>{tw("time.task")}</th>
                      <th>{tw("time.start")}</th>
                      <th>{tw("time.end")}</th>
                      <th>{tw("time.duration")}</th>
                      <th>{tw("time.status")}</th>
                      <th>{tw("time.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEntries.map((e) => (
                      <tr
                        key={e.id}
                        data-testid="time-entry"
                        className={e.needsReview ? "bg-status-warn-bg" : undefined}
                      >
                        <td className="font-medium">{e.mechanicName}</td>
                        <td>
                          <Link href={`/ordres/${e.repairOrder.id}`} className="underline">
                            {e.repairOrder.number}
                          </Link>
                        </td>
                        <td>{e.lineDescription ?? "—"}</td>
                        <td>
                          {formatTime(e.startedAt, timeZone)}
                          {e.carriedOver ? (
                            <span className="block text-xs text-muted">
                              {tw("time.carriedOver")}
                            </span>
                          ) : null}
                        </td>
                        <td>{e.endedAt ? formatTime(e.endedAt, timeZone) : "…"}</td>
                        <td>
                          {formatDuration(e.minutes)}
                          {e.pauseMinutes > 0 ? (
                            <span className="block text-xs text-muted">
                              {tw("time.pause")} {e.pauseMinutes}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <StatusBadge
                              tone={
                                e.state === "STOPPED" ? "off" : e.state === "PAUSED" ? "warn" : "ok"
                              }
                              label={tw(
                                e.state === "STOPPED"
                                  ? "time.stopped"
                                  : e.state === "PAUSED"
                                    ? "time.pausedState"
                                    : "time.running",
                              )}
                            />
                            <StatusBadge
                              tone={e.kind === "REWORK" ? "warn" : "off"}
                              label={tw(`time.kinds.${e.kind}`)}
                            />
                            <StatusBadge tone="off" label={tw(`time.sources.${e.source}`)} />
                            {e.needsReview ? (
                              <StatusBadge tone="warn" label={tw("time.toReview")} />
                            ) : null}
                          </div>
                        </td>
                        <td>
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
      {attendance ? (
        <AttendanceModal
          member={attendance}
          day={day}
          timeZone={timeZone}
          onClose={() => setAttendance(null)}
          onSaved={() => {
            setAttendance(null);
            void utils.workshop.timeEntries.invalidate();
            void utils.workshop.mechanics.invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
  tone,
  pressed,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone?: "ok" | "warn";
  pressed?: boolean;
  onClick?: () => void;
}) {
  if (!onClick) {
    return (
      <div className="mini-stat is-static">
        <span className={`mini-stat-icon${tone ? ` ${tone}` : ""}`}>
          <Icon aria-hidden />
        </span>
        <span>
          <span className={`mini-stat-value${tone ? ` ${tone}` : ""}`}>{value}</span>
          <span className="mini-stat-label">{label}</span>
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`mini-stat${pressed ? " is-pressed" : ""}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span className={`mini-stat-icon${tone ? ` ${tone}` : ""}`}>
        <Icon aria-hidden />
      </span>
      <span>
        <span className={`mini-stat-value${tone ? ` ${tone}` : ""}`}>{value}</span>
        <span className="mini-stat-label">{label}</span>
      </span>
    </button>
  );
}

function AttendanceModal({
  member,
  day,
  timeZone,
  onClose,
  onSaved,
}: {
  member: TeamMember;
  day: string;
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isToday = day === todayKey();
  const [clockIn, setClockIn] = useState(
    member.clockIn
      ? toLocalInput(member.clockIn, timeZone)
      : isToday
        ? toLocalInput(new Date(), timeZone)
        : `${day}T08:00`,
  );
  const [clockOut, setClockOut] = useState(toLocalInput(member.clockOut, timeZone));
  const [breakMinutes, setBreakMinutes] = useState(String(member.breakMinutes));
  const [reason, setReason] = useState("");
  const save = trpc.workshop.recordAttendance.useMutation({ onSuccess: onSaved });
  return (
    <Modal
      open
      title={tw("time.recordTitle", { name: member.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tw("cancel")}
          </Button>
          <Button
            disabled={save.isPending || reason.trim().length < 3 || !clockIn}
            onClick={() => {
              const start = fromLocalInput(clockIn, timeZone);
              if (!start) return;
              save.mutate({
                membershipId: member.membershipId,
                clockIn: start,
                clockOut: clockOut ? (fromLocalInput(clockOut, timeZone) ?? null) : null,
                breakMinutes: Number(breakMinutes) || 0,
                reason,
              });
            }}
          >
            {tw("save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={tw("time.arrival")}>
          <Input
            type="datetime-local"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
          />
        </Field>
        <Field label={tw("time.departure")}>
          <Input
            type="datetime-local"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
          />
        </Field>
        <Field label={tw("time.break")} hint={tw("time.breakHint")}>
          <Input
            type="number"
            min={0}
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
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
        <div className="flex flex-wrap gap-2">
          {(["reasonForgot", "reasonArrival", "reasonDeparture"] as const).map((key) => (
            <Button
              key={key}
              variant="secondary"
              type="button"
              onClick={() => setReason(tw(`time.${key}`))}
            >
              {tw(`time.${key}`)}
            </Button>
          ))}
        </div>
        {save.error ? (
          <p role="alert" className="text-sm text-status-bad">
            {save.error.message}
          </p>
        ) : null}
      </div>
    </Modal>
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
