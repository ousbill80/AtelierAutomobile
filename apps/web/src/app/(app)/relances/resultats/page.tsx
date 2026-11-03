"use client";

// PRD M10 §7 — « Résultats des relances » : ce qui est parti (ou non) sur une période, si le
// client l'a reçu ou lu, et ce que cela a produit (RDV pris, promesse, paiement…). Les montants
// récupérés et le CA généré restent sur le tableau de bord (M12, `report:read`) ; cette page ne
// demande que `reminder:read`.
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import {
  Ban,
  CalendarCheck,
  CircleSlash,
  Mail,
  MessageCircle,
  MessageSquareText,
  Search,
  Send,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { describeStep } from "@atelieros/core/reminders/stepLabel";
import { Button, EmptyState, PlateBadge, StatusBadge } from "@atelieros/ui";
import { DeliveryTicks } from "@/components/messaging/delivery-ticks";
import { EduTip } from "@/components/edu-tip";
import { t } from "@/i18n/t";
import type { AppRouter } from "@/server/routers/_app";
import { trpc } from "@/trpc/react";
import { reminderStatusTone } from "../reminder-labels";

type HistoryItem = inferRouterOutputs<AppRouter>["reminders"]["history"]["items"][number];

const STATUSES = ["SENT", "FAILED", "CANCELLED", "SKIPPED"] as const;
type HistoryStatus = (typeof STATUSES)[number];
const TYPES = [
  "INSPECTION",
  "SERVICE",
  "RECEIVABLE",
  "APPOINTMENT",
  "QUOTE_FOLLOWUP",
  "VEHICLE_READY",
  "INSURANCE_EXPIRY",
  "SATISFACTION",
  "RECOMMENDED_WORK",
  "CUSTOM",
] as const;
type ReminderType = (typeof TYPES)[number];
const CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
type Channel = (typeof CHANNELS)[number];
const PERIODS = ["7", "30", "month", "custom"] as const;
type Period = (typeof PERIODS)[number];

const STATUS_ICON: Record<HistoryStatus, LucideIcon> = {
  SENT: Send,
  FAILED: TriangleAlert,
  CANCELLED: Ban,
  SKIPPED: CircleSlash,
};
const STATUS_ACCENT: Record<HistoryStatus, string> = {
  SENT: "text-status-ok",
  FAILED: "text-status-bad",
  CANCELLED: "text-muted",
  SKIPPED: "text-status-warn",
};
const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  WHATSAPP: MessageCircle,
  SMS: MessageSquareText,
  EMAIL: Mail,
};

const R = (key: string, vars?: Record<string, string | number>) =>
  t(`reminders.results.${key}`, vars);

function dateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function periodRange(period: Period, now: Date): { from: string; to: string } {
  const to = dateKey(now);
  if (period === "month") return { from: `${to.slice(0, 8)}01`, to };
  const days = period === "7" ? 7 : 30;
  return { from: dateKey(new Date(now.getTime() - (days - 1) * 86_400_000)), to };
}

function stepText(stepKey: string): string {
  const step = describeStep(stepKey);
  switch (step.kind) {
    case "before":
      return t("reminders.inbox.step.before", { days: step.days });
    case "after":
      return t("reminders.inbox.step.after", { days: step.days });
    case "on":
      return t("reminders.inbox.step.on");
    case "manual":
      return t("reminders.inbox.step.manual");
    case "promise":
      return t("reminders.inbox.step.promise");
    default:
      return step.key;
  }
}

function dayHeading(key: string, today: string, yesterday: string): string {
  if (key === today) return R("today");
  if (key === yesterday) return R("yesterday");
  const label = new Date(`${key}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function ReminderResultsPage() {
  return (
    <Suspense fallback={null}>
      <ReminderResults />
    </Suspense>
  );
}

function ReminderResults() {
  // « Voir tout » des fiches client/véhicule : `?customerId=` ou `?vehicleId=`, sur 12 mois.
  const params = useSearchParams();
  const customerId = params.get("customerId") || undefined;
  const vehicleId = params.get("vehicleId") || undefined;
  const scoped = Boolean(customerId || vehicleId);
  const [now] = useState(() => new Date());
  const [period, setPeriod] = useState<Period>(scoped ? "custom" : "30");
  const [customFrom, setCustomFrom] = useState(() =>
    dateKey(new Date(now.getTime() - (scoped ? 365 : 30) * 86_400_000)),
  );
  const [customTo, setCustomTo] = useState(() => dateKey(now));
  const [status, setStatus] = useState<HistoryStatus | "">("");
  const [type, setType] = useState<ReminderType | "">("");
  const [channel, setChannel] = useState<Channel | "">("");
  const [search, setSearch] = useState("");
  const q = search.trim().length >= 2 ? search.trim() : undefined;

  const { from, to } =
    period === "custom" ? { from: customFrom, to: customTo } : periodRange(period, now);
  const range = useMemo(
    () => ({ from: new Date(`${from}T00:00:00`), to: new Date(`${to}T23:59:59.999`) }),
    [from, to],
  );
  const rangeValid = Boolean(from && to) && range.from <= range.to;

  const history = trpc.reminders.history.useInfiniteQuery(
    {
      ...range,
      status: status || undefined,
      type: type || undefined,
      channel: channel || undefined,
      customerId,
      vehicleId,
      q,
      limit: 50,
    },
    {
      enabled: rangeValid,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = history.data?.pages[0]?.summary ?? null;
  const scopeName = customerId
    ? items[0]?.customer.displayName
    : vehicleId
      ? items[0]?.vehicle?.plate
      : undefined;

  const today = dateKey(now);
  const yesterday = dateKey(new Date(now.getTime() - 86_400_000));
  // Lignes regroupées par jour (déjà triées du plus récent au plus ancien).
  const days: { key: string; rows: HistoryItem[] }[] = [];
  for (const row of items) {
    const key = dateKey(new Date(row.sentAt ?? row.updatedAt));
    const last = days.at(-1);
    if (last && last.key === key) last.rows.push(row);
    else days.push({ key, rows: [row] });
  }

  const sent = summary?.byStatus.SENT ?? 0;
  const outcomes = summary?.byOutcome.reduce((sum, o) => sum + o.count, 0) ?? 0;
  const filtersActive = Boolean(status || type || channel || q);

  function resetFilters() {
    setStatus("");
    setType("");
    setChannel("");
    setSearch("");
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {R("title")}
            <EduTip text={R("description")} example={R("descriptionExample")} />
          </h1>
          <p className="mt-1 text-sm text-muted">{R("subtitle")}</p>
        </div>
        <Link href="/relances" className="btn btn-secondary min-h-11">
          {R("openQueue")}
        </Link>
      </header>

      {scoped && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-md border border-border bg-surface-2 px-3 py-1.5">
            {scopeName ? R("filteredOn", { name: scopeName }) : R("filteredOnUnknown")}
          </span>
          <Link
            href="/relances/resultats"
            className="inline-flex min-h-11 items-center text-accent hover:underline"
          >
            {R("clearFilter")}
          </Link>
        </div>
      )}

      {/* Période */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={R("periodLabel")}
          className="inline-flex rounded-md border border-border bg-surface p-0.5"
        >
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => {
                if (value === "custom" && period !== "custom") {
                  setCustomFrom(from);
                  setCustomTo(to);
                }
                setPeriod(value);
              }}
              className={`min-h-11 rounded px-3 text-sm ${period === value ? "bg-accent text-accent-foreground" : "text-muted"}`}
            >
              {R(`periods.${value}`)}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              <span className="text-muted">{R("fromLabel")}</span>
              <input
                type="date"
                className="min-h-11 rounded-md border border-border bg-surface px-2"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-muted">{R("toLabel")}</span>
              <input
                type="date"
                className="min-h-11 rounded-md border border-border bg-surface px-2"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </div>
        )}
        {period !== "custom" && rangeValid && (
          <span className="text-sm text-muted">
            {R("periodRange", {
              from: new Date(`${from}T12:00:00`).toLocaleDateString("fr-FR"),
              to: new Date(`${to}T12:00:00`).toLocaleDateString("fr-FR"),
            })}
          </span>
        )}
      </div>

      {!rangeValid && <p className="text-sm text-status-bad">{R("invalidRange")}</p>}

      {/* Compteurs : un clic filtre la liste. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUSES.map((s) => {
          const Icon = STATUS_ICON[s];
          const active = status === s;
          return (
            <div
              key={s}
              className={`relative flex flex-col rounded-xl border bg-surface transition-colors ${active ? "border-accent ring-1 ring-accent" : "border-border"}`}
            >
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setStatus(active ? "" : s)}
                className="flex min-h-20 flex-1 items-center gap-3 rounded-xl p-3 pr-10 text-left hover:bg-surface-2"
              >
                <span
                  className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 ${STATUS_ACCENT[s]}`}
                >
                  <Icon size={18} aria-hidden />
                </span>
                <span className="min-w-0">
                  {summary ? (
                    <span className="tabular block text-2xl leading-tight font-semibold">
                      {summary.byStatus[s]}
                    </span>
                  ) : (
                    <span className="block h-7 w-10 animate-pulse rounded bg-surface-2" />
                  )}
                  <span className="block text-sm">{t(`reminders.status.${s}`)}</span>
                  {s === "SENT" && summary && sent > 0 && (
                    <span className="block text-xs text-muted">
                      {R("deliverySummary", {
                        delivered: summary.delivery.delivered + summary.delivery.read,
                        read: summary.delivery.read,
                      })}
                    </span>
                  )}
                </span>
              </button>
              <span className="absolute top-1 right-1">
                <EduTip text={R(`help.${s}`)} example={R(`example.${s}`)} />
              </span>
            </div>
          );
        })}
      </div>

      {/* Résultats obtenus */}
      <section
        aria-label={R("outcomesTitle")}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3"
      >
        <span className="flex items-center gap-2 font-semibold">
          <CalendarCheck size={18} className="text-status-ok" aria-hidden />
          {R("outcomesTitle")}
        </span>
        {!summary ? (
          <span className="h-5 w-40 animate-pulse rounded bg-surface-2" />
        ) : summary.byOutcome.length === 0 ? (
          <span className="text-sm text-muted">{R("outcomesEmpty")}</span>
        ) : (
          <>
            {summary.byOutcome.map((o) => (
              <span
                key={o.outcome}
                className="inline-flex items-center gap-1.5 rounded-full bg-status-ok-bg px-3 py-1 text-sm text-status-ok"
              >
                {t(`reminders.outcomes.${o.outcome}`)}
                <strong className="tabular">{o.count}</strong>
              </span>
            ))}
            {sent > 0 && (
              <span className="text-sm text-muted">
                {R("outcomeRate", { rate: Math.round((outcomes / sent) * 100) })}
              </span>
            )}
          </>
        )}
        {summary && summary.delivery.unconfirmed > 0 && (
          <span className="text-sm text-status-warn sm:ml-auto">
            {R("unconfirmed", { count: summary.delivery.unconfirmed })}
          </span>
        )}
      </section>

      {/* Filtres de la liste */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-60">
          <span className="sr-only">{R("searchLabel")}</span>
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={R("searchPlaceholder")}
            className="min-h-11 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm"
          />
        </label>
        <select
          aria-label={R("typeFilterLabel")}
          className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value as ReminderType | "")}
        >
          <option value="">{R("allTypes")}</option>
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`reminders.types.${ty}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={R("channelFilterLabel")}
          className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
          value={channel}
          onChange={(e) => setChannel(e.target.value as Channel | "")}
        >
          <option value="">{R("allChannels")}</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t(`common.channels.${c}`)}
            </option>
          ))}
        </select>
        {filtersActive && (
          <Button variant="ghost" className="min-h-11" onClick={resetFilters}>
            {R("resetFilters")}
          </Button>
        )}
      </div>

      {history.isLoading && rangeValid ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-border bg-surface-2"
            />
          ))}
        </div>
      ) : history.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">{R("error")}</p>
          <Button variant="secondary" onClick={() => history.refetch()}>
            {R("retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={filtersActive ? R("emptyFiltered.title") : R("empty.title")}
          description={filtersActive ? R("emptyFiltered.description") : R("empty.description")}
        />
      ) : (
        <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface">
          {days.map((day) => (
            <section key={day.key} aria-label={dayHeading(day.key, today, yesterday)}>
              <h2 className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-2 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                <span>{dayHeading(day.key, today, yesterday)}</span>
                <span className="font-normal normal-case">
                  {R("dayCount", { count: day.rows.length })}
                </span>
              </h2>
              <ul className="divide-y divide-border">
                {day.rows.map((row) => (
                  <ResultRow key={row.id} row={row} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {items.length > 0 && summary && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-muted">
            {R("shown", { shown: items.length, total: summary.total })}
          </p>
          {history.hasNextPage && (
            <Button
              variant="secondary"
              onClick={() => history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              {history.isFetchingNextPage ? R("loadingMore") : R("loadMore")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({ row }: { row: HistoryItem }) {
  const status = row.status as HistoryStatus;
  const ChannelIcon = row.channel ? CHANNEL_ICON[row.channel as Channel] : null;
  const at = new Date(row.sentAt ?? row.updatedAt);
  const time = at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const outcome = row.outcome ? t(`reminders.outcomes.${row.outcome}`) : null;
  const reason = !outcome && row.skippedReason ? row.skippedReason : null;

  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 text-sm lg:grid-cols-[3.5rem_minmax(0,1.2fr)_minmax(0,1.2fr)_9rem_8rem_minmax(0,1.3fr)]">
      <span className="hidden text-xs text-muted tabular lg:block">{time}</span>

      {/* Quoi */}
      <span className="min-w-0">
        <span className="block truncate font-medium">{t(`reminders.types.${row.type}`)}</span>
        <span className="block truncate text-xs text-muted">
          {stepText(row.stepKey)}
          {row.invoice ? ` · ${row.invoice.number}` : ""}
        </span>
      </span>

      {/* Statut (mobile : en face du type) */}
      <span className="justify-self-end lg:hidden">
        <StatusBadge tone={reminderStatusTone(status)} label={t(`reminders.status.${status}`)} />
      </span>

      {/* Qui */}
      <span className="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1">
        <Link href={`/clients/${row.customer.id}`} className="truncate font-medium hover:underline">
          {row.customer.displayName}
        </Link>
        {row.vehicle && (
          <span className="shrink-0">
            <PlateBadge plate={row.vehicle.plate} plateType={row.vehicle.plateType} />
          </span>
        )}
      </span>

      {/* Canal + accusé */}
      <span className="flex min-w-0 items-center gap-2 text-xs">
        {ChannelIcon ? (
          <span className="inline-flex items-center gap-1 text-muted">
            <ChannelIcon size={14} aria-hidden />
            {t(`common.channels.${row.channel}`)}
          </span>
        ) : (
          <span className="text-muted">{R("noChannel")}</span>
        )}
        {status === "SENT" && row.delivery && <DeliveryTicks state={row.delivery.state} compact />}
        <span className="text-muted tabular lg:hidden">· {time}</span>
      </span>

      <span className="hidden lg:block">
        <StatusBadge tone={reminderStatusTone(status)} label={t(`reminders.status.${status}`)} />
      </span>

      {/* Résultat ou motif */}
      <span className="col-span-2 min-w-0 text-xs lg:col-span-1 lg:text-sm">
        {outcome ? (
          <span className="inline-flex items-center gap-1 font-medium text-status-ok">
            <CalendarCheck size={14} aria-hidden />
            {outcome}
          </span>
        ) : reason ? (
          <span className="line-clamp-2 text-muted" title={reason}>
            {reason}
          </span>
        ) : status === "SENT" ? (
          <span className="text-muted">{R("waiting")}</span>
        ) : null}
      </span>
    </li>
  );
}
