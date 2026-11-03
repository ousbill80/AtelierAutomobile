"use client";

// M10 §7.2 — vue calendrier mensuel des échéances : un point coloré par jour (couleur + icône
// + nombre, jamais la couleur seule), clic sur un jour = liste des véhicules de ce jour.
import { ChevronLeft, ChevronRight, CircleAlert, Phone, Wrench, CalendarDays } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@atelieros/ui";
import { dueDayTone, monthGrid, shiftMonth, type DueDayTone } from "@atelieros/core/dueCalendar";
import { trpc } from "@/trpc/react";
import { t } from "@/i18n/t";

type Kind = "INSPECTION" | "SERVICE" | "INSURANCE";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const TONE_STYLE: Record<DueDayTone, { className: string; icon: LucideIcon }> = {
  EXPIRED: { className: "bg-status-bad-bg text-status-bad", icon: CircleAlert },
  CLIENT: { className: "bg-status-warn-bg text-status-warn", icon: Phone },
  WORKSHOP: { className: "bg-status-ok-bg text-status-ok", icon: Wrench },
  LATER: { className: "bg-surface-2 text-muted", icon: CalendarDays },
};

function monthTitle(month: string): string {
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export function DueCalendar({
  kind,
  month,
  today,
  selectedDay,
  onMonthChange,
  onSelectDay,
}: {
  kind: Kind;
  month: string;
  today: string;
  selectedDay: string | null;
  onMonthChange: (month: string) => void;
  onSelectDay: (day: string | null) => void;
}) {
  const { data, isLoading, isError, refetch } = trpc.reminders.dueCalendar.useQuery({
    kind,
    month,
  });
  const grid = monthGrid(month);
  const todayMonth = today.slice(0, 7);

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:p-4"
      aria-label={t("reminders.due.calendar.title")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            aria-label={t("reminders.due.calendar.previous")}
            onClick={() => onMonthChange(shiftMonth(month, -1))}
          >
            <ChevronLeft size={18} />
          </Button>
          <h2 className="min-w-36 text-center font-semibold" aria-live="polite">
            {monthTitle(month)}
          </h2>
          <Button
            variant="ghost"
            aria-label={t("reminders.due.calendar.next")}
            onClick={() => onMonthChange(shiftMonth(month, 1))}
          >
            <ChevronRight size={18} />
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-sm text-muted">
              {t(
                data.total > 1
                  ? "reminders.due.calendar.totalMany"
                  : "reminders.due.calendar.totalOne",
                {
                  count: data.total,
                },
              )}
            </span>
          )}
          {month !== todayMonth && (
            <Button variant="secondary" onClick={() => onMonthChange(todayMonth)}>
              {t("reminders.due.calendar.today")}
            </Button>
          )}
        </div>
      </div>

      {isError ? (
        <div className="flex flex-col items-start gap-2 rounded-md bg-status-bad-bg p-3">
          <p className="text-sm text-status-bad">{t("reminders.due.calendar.error")}</p>
          <Button variant="secondary" onClick={() => refetch()}>
            {t("reminders.due.retry")}
          </Button>
        </div>
      ) : (
        <div role="grid" aria-busy={isLoading} className="grid grid-cols-7 gap-1 text-center">
          <div role="row" className="contents">
            {WEEKDAYS.map((weekday) => (
              <div
                key={weekday}
                role="columnheader"
                className="py-1 text-[11px] font-semibold tracking-wide text-muted uppercase"
              >
                <abbr
                  title={t(`reminders.due.calendar.weekdays.${weekday}`)}
                  className="no-underline"
                >
                  {t(`reminders.due.calendar.weekdaysShort.${weekday}`)}
                </abbr>
              </div>
            ))}
          </div>
          {grid.weeks.map((week, index) => (
            <div key={index} role="row" className="contents">
              {week.map((day, column) => {
                if (!day) return <div key={`empty-${column}`} role="gridcell" aria-hidden />;
                const count = data?.days[day] ?? 0;
                const tone = dueDayTone(day, today);
                const style = TONE_STYLE[tone];
                const Icon = style.icon;
                const selected = day === selectedDay;
                const label =
                  count > 0
                    ? t("reminders.due.calendar.dayWithCount", {
                        day: dayLabel(day),
                        count,
                        tone: t(`reminders.due.calendar.tones.${tone}`),
                      })
                    : dayLabel(day);
                return (
                  <div key={day} role="gridcell" aria-selected={selected}>
                    <button
                      type="button"
                      aria-label={label}
                      aria-pressed={selected}
                      disabled={count === 0 && !selected}
                      onClick={() => onSelectDay(selected ? null : day)}
                      className={`flex min-h-14 w-full flex-col items-center justify-start gap-0.5 rounded-md border p-1 text-sm transition-colors disabled:cursor-default ${
                        selected
                          ? "border-accent ring-2 ring-accent"
                          : "border-transparent hover:border-border"
                      } ${day === today ? "font-bold" : ""}`}
                    >
                      <span
                        className={
                          day === today
                            ? "rounded-full bg-accent px-1.5 text-accent-foreground"
                            : ""
                        }
                      >
                        {Number(day.slice(8))}
                      </span>
                      {isLoading ? (
                        <span className="h-5 w-8 animate-pulse rounded-full bg-surface-2" />
                      ) : count > 0 ? (
                        <span
                          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 text-xs font-semibold ${style.className}`}
                        >
                          <Icon size={11} aria-hidden />
                          {count}
                        </span>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
        aria-label={t("reminders.due.calendar.legend")}
      >
        {(Object.keys(TONE_STYLE) as DueDayTone[]).map((tone) => {
          const Icon = TONE_STYLE[tone].icon;
          return (
            <li key={tone} className="inline-flex items-center gap-1">
              <span className={`inline-flex rounded-full p-0.5 ${TONE_STYLE[tone].className}`}>
                <Icon size={11} aria-hidden />
              </span>
              {t(`reminders.due.calendar.tones.${tone}`)}
            </li>
          );
        })}
      </ul>

      {selectedDay ? (
        <p className="text-sm font-medium">
          {t("reminders.due.calendar.selectedDay", { day: dayLabel(selectedDay) })}
        </p>
      ) : (
        <p className="text-sm text-muted">{t("reminders.due.calendar.pickDay")}</p>
      )}
    </section>
  );
}
