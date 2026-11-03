"use client";

// PRD M10 §7.1 — relances du jour, présentées par ce que l'utilisateur doit faire :
// « À envoyer » (attend son clic), « Bloquées » (n'ont pas pu partir), « Partent aujourd'hui »
// (rien à faire) et « Envoyées aujourd'hui ». Chaque relance dit en clair pour qui, pourquoi,
// quand et par quel canal. Simplifications documentées : pas de bandeau de mode (rodage/pause),
// pas de geste de balayage sur mobile, pas de filtre site/palier/conseiller.
import { useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Car,
  CheckCircle2,
  Clock,
  FileText,
  Hand,
  Mail,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Receipt,
  RotateCcw,
  Send,
  ShieldCheck,
  Star,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, StatusBadge } from "@atelieros/ui";
import { describeStep } from "@atelieros/core/reminders/stepLabel";
import { formatFCFA } from "@atelieros/core/money";
import { REMINDER_SKIP_REASONS, type ReminderTypeInput } from "@atelieros/validators";
import { t } from "@/i18n/t";
import { GuideLink } from "@/components/guide-link";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { DeliveryTicks } from "@/components/messaging/delivery-ticks";
import { REMINDER_CHANNEL_LABELS, REMINDER_TYPE_LABELS } from "./reminder-labels";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ReminderCard = RouterOutputs["reminders"]["queue"]["items"][number];
type ChannelInput = "WHATSAPP" | "SMS" | "EMAIL";
type View = "TO_APPROVE" | "BLOCKED" | "PLANNED_TODAY" | "SENT_TODAY" | "EXPIRED" | "UNCONFIRMED";

const VIEWS: { key: View; icon: LucideIcon; tone: string }[] = [
  { key: "TO_APPROVE", icon: Hand, tone: "text-accent" },
  { key: "BLOCKED", icon: AlertTriangle, tone: "text-status-bad" },
  { key: "PLANNED_TODAY", icon: Clock, tone: "text-status-warn" },
  { key: "SENT_TODAY", icon: CheckCircle2, tone: "text-status-ok" },
];

const TYPE_ICON: Record<string, LucideIcon> = {
  RECEIVABLE: Receipt,
  INSPECTION: Car,
  SERVICE: Wrench,
  APPOINTMENT: CalendarClock,
  QUOTE_FOLLOWUP: FileText,
  VEHICLE_READY: Car,
  INSURANCE_EXPIRY: ShieldCheck,
  SATISFACTION: Star,
  RECOMMENDED_WORK: Wrench,
};

const ACTIONABLE = ["NEEDS_APPROVAL", "PLANNED"] as const;
const CANCELLABLE = ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] as const;

const L = (key: string, vars?: Record<string, string | number>) =>
  t(`reminders.inbox.${key}`, vars);

function dateTime(value: Date | string): { date: string; time: string } {
  const d = new Date(value);
  return {
    date: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function isToday(value: Date | string): boolean {
  return new Date(value).toDateString() === new Date().toDateString();
}

function stepText(stepKey: string): string {
  const step = describeStep(stepKey);
  switch (step.kind) {
    case "before":
      return L("step.before", { days: step.days });
    case "after":
      return L("step.after", { days: step.days });
    case "on":
      return L("step.on");
    case "manual":
      return L("step.manual");
    case "promise":
      return L("step.promise");
    default:
      return step.key;
  }
}

function channelLabel(channel: string | null): string {
  return channel ? (REMINDER_CHANNEL_LABELS[channel] ?? channel) : L("bestChannel");
}

export default function RelancesPage() {
  const [chosenView, setChosenView] = useState<View | null>(null);
  const [typeFilter, setTypeFilter] = useState<ReminderTypeInput | "">("");
  const [channelFilter, setChannelFilter] = useState<ChannelInput | "">("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Les compteurs viennent avec chaque liste ; tant que l'utilisateur n'a pas choisi, on ouvre
  // le premier onglet qui demande une action (à envoyer, puis bloquées), sinon le suivi du jour.
  const counts = trpc.reminders.queue.useQuery({ tab: "TO_APPROVE", limit: 1 });
  const c = counts.data?.counts;
  const autoView: View = !c
    ? "TO_APPROVE"
    : (c.TO_APPROVE ?? 0) > 0
      ? "TO_APPROVE"
      : (c.BLOCKED ?? 0) > 0
        ? "BLOCKED"
        : (c.PLANNED_TODAY ?? 0) > 0
          ? "PLANNED_TODAY"
          : "SENT_TODAY";
  const view = chosenView ?? autoView;

  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch, isFetching } = trpc.reminders.queue.useQuery(
    {
      tab: view,
      types: typeFilter ? [typeFilter] : undefined,
      channels: channelFilter ? [channelFilter] : undefined,
      limit: 50,
    },
    { enabled: !!c || chosenView !== null },
  );
  const allCounts = data?.counts ?? c;

  function invalidateAll() {
    void utils.reminders.queue.invalidate();
    setSelected(new Set());
  }

  const approve = trpc.reminders.approve.useMutation({ onSuccess: invalidateAll });

  function choose(next: View) {
    setChosenView(next);
    setSelected(new Set());
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const items = data?.items ?? [];
  const selectable = view === "TO_APPROVE" ? items.filter((r) => r.channel != null) : [];
  const expired = allCounts?.EXPIRED ?? 0;
  const unconfirmed = allCounts?.UNCONFIRMED ?? 0;

  return (
    <div className="flex flex-col gap-5 pb-24">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">{t("reminders.queue.title")}</h1>
          <p className="mt-1 text-sm text-muted">{L("intro")}</p>
        </div>
        <GuideLink href="/relances/guide" />
      </header>

      {/* Les 4 situations, avec leur nombre : ce sont aussi les onglets. */}
      <div
        role="tablist"
        aria-label={L("tabsLabel")}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {VIEWS.map(({ key, icon: Icon, tone }) => {
          const count = allCounts?.[key] ?? 0;
          const active = view === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => choose(key)}
              className={`flex min-h-24 flex-col gap-1 rounded-xl border p-3 text-left transition-colors ${
                active
                  ? "border-accent bg-accent/5 ring-1 ring-accent"
                  : "border-border bg-surface hover:bg-surface-2"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`flex items-center gap-1.5 text-sm font-semibold ${tone}`}>
                  <Icon size={16} aria-hidden />
                  {L(`views.${key}.title`)}
                </span>
                {allCounts ? (
                  <span
                    className={`text-2xl font-bold tabular-nums ${count === 0 ? "text-muted" : ""}`}
                  >
                    {count}
                  </span>
                ) : (
                  <span className="h-7 w-8 animate-pulse rounded bg-surface-2" />
                )}
              </span>
              <span className="text-xs text-muted">{L(`views.${key}.hint`)}</span>
            </button>
          );
        })}
      </div>

      {unconfirmed > 0 && view !== "UNCONFIRMED" && (
        <button
          type="button"
          onClick={() => choose("UNCONFIRMED")}
          className="flex min-h-11 items-center gap-2 self-start rounded-lg border border-status-warn bg-status-warn-bg px-3 text-left text-sm text-status-warn"
        >
          <AlertTriangle size={16} aria-hidden />
          {L("unconfirmedLink", { count: unconfirmed })}
        </button>
      )}

      {/* Ce qu'il faut faire dans l'onglet ouvert + filtres. */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm">
          <strong>{L(`views.${view}.title`)} — </strong>
          {L(`views.${view}.todo`)}
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
            aria-label={t("reminders.queue.typeFilter")}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ReminderTypeInput | "")}
          >
            <option value="">{t("reminders.queue.allTypes")}</option>
            {Object.entries(REMINDER_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
            aria-label={t("reminders.queue.channelFilter")}
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value as ChannelInput | "")}
          >
            <option value="">{t("reminders.queue.allChannels")}</option>
            {Object.entries(REMINDER_CHANNEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectable.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            className="min-h-11 font-medium text-accent"
            onClick={() =>
              setSelected(
                selected.size === selectable.length
                  ? new Set()
                  : new Set(selectable.map((r) => r.id)),
              )
            }
          >
            {selected.size === selectable.length
              ? L("unselectAll")
              : L("selectAll", { count: selectable.length })}
          </button>
        </div>
      )}

      {(isLoading || (!data && !isError)) && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-border bg-surface-2"
            />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">{t("reminders.queue.loadError")}</p>
          <Button variant="secondary" onClick={() => refetch()}>
            {t("reminders.queue.retry")}
          </Button>
        </div>
      )}

      {data && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center">
          <CheckCircle2 size={32} className="text-status-ok" aria-hidden />
          <p className="font-semibold">{L(`views.${view}.emptyTitle`)}</p>
          <p className="max-w-md text-sm text-muted">{L(`views.${view}.emptyHint`)}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link href="/creances" className="btn btn-secondary min-h-11">
              {L("goReceivables")}
            </Link>
            <Link href="/relances/echeances" className="btn btn-secondary min-h-11">
              {L("goDueDates")}
            </Link>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((reminder) => (
            <li key={reminder.id}>
              <ReminderRow
                reminder={reminder}
                selectable={view === "TO_APPROVE" && reminder.channel != null}
                selected={selected.has(reminder.id)}
                onToggleSelected={() => toggleSelected(reminder.id)}
                onChanged={invalidateAll}
              />
            </li>
          ))}
        </ul>
      )}

      {expired > 0 && view !== "EXPIRED" && (
        <button
          type="button"
          onClick={() => choose("EXPIRED")}
          className="self-start text-sm text-muted underline"
        >
          {L("seeExpired", { count: expired })}
        </button>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[var(--bottom-nav-offset)] z-30 flex items-center justify-between gap-3 border-t border-border bg-surface p-3 shadow-lg md:left-[var(--sidebar-w)]">
          <p className="text-sm">{t("reminders.queue.selectedCount", { count: selected.size })}</p>
          <Button
            onClick={() => approve.mutate({ ids: Array.from(selected), sendNow: true })}
            disabled={approve.isPending || isFetching}
          >
            <Send size={16} aria-hidden />
            {L("sendSelection", { count: selected.size })}
          </Button>
        </div>
      )}
      {approve.error && <p className="text-sm text-status-bad">{approve.error.message}</p>}
    </div>
  );
}

/** Phrase d'état d'une relance : ce qui va se passer (ou s'est passé), quand, par quel canal. */
function StatusLine({ reminder, now }: { reminder: ReminderCard; now: number }) {
  const channel = channelLabel(reminder.channel);
  if (reminder.status === "SENT" && reminder.sentAt) {
    const { date, time } = dateTime(reminder.sentAt);
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-status-ok">
        <CheckCircle2 size={15} className="shrink-0" aria-hidden />
        {isToday(reminder.sentAt)
          ? L("status.sentToday", { time, channel })
          : L("status.sentOn", { date, time, channel })}
        <DeliveryTicks state={reminder.delivery?.state} />
      </p>
    );
  }
  if (reminder.status === "PLANNED" || reminder.status === "QUEUED") {
    const { date, time } = dateTime(reminder.scheduledFor);
    const past = new Date(reminder.scheduledFor).getTime() <= now;
    return (
      <p className="flex items-start gap-1.5 text-sm text-status-warn">
        <Clock size={15} className="mt-0.5 shrink-0" aria-hidden />
        {past || reminder.status === "QUEUED"
          ? L("status.sending", { channel })
          : isToday(reminder.scheduledFor)
            ? L("status.plannedToday", { time, channel })
            : L("status.plannedOn", { date, time, channel })}
      </p>
    );
  }
  if (reminder.status === "NEEDS_APPROVAL" && reminder.channel) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-accent">
        <Hand size={15} className="mt-0.5 shrink-0" aria-hidden />
        {L("status.ready", { channel })}
      </p>
    );
  }
  if (reminder.status === "NEEDS_APPROVAL" || reminder.status === "FAILED") {
    return (
      <p className="flex items-start gap-1.5 text-sm text-status-bad">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
        {L("status.blocked", {
          reason: !reminder.skippedReason
            ? L("status.noChannelReason")
            : reminder.skippedReason.startsWith("Erreur de rendu")
              ? L("status.legacyRenderError")
              : reminder.skippedReason,
        })}
      </p>
    );
  }
  if (reminder.status === "SNOOZED" && reminder.snoozedUntil) {
    const { date, time } = dateTime(reminder.snoozedUntil);
    return <p className="text-sm text-muted">{L("status.snoozed", { date, time })}</p>;
  }
  return (
    <p className="text-sm text-muted">
      {reminder.skippedReason ?? t(`reminders.status.${reminder.status}`)}
    </p>
  );
}

const CHANNEL_ICON: Record<ChannelInput, LucideIcon> = {
  WHATSAPP: MessageCircle,
  SMS: MessageSquareText,
  EMAIL: Mail,
};

/** Masque une adresse pour l'affichage (+225 05 01 •• •• 62, k•••@gmail.com). */
function maskAddress(address: string): string {
  if (address.includes("@")) {
    const [user, domain] = address.split("@");
    return `${user!.slice(0, 1)}•••@${domain}`;
  }
  return address.length > 6 ? `${address.slice(0, 8)} •• ${address.slice(-2)}` : address;
}

/** « Renvoyer par… » : l'utilisateur choisit le canal ; chaque choix dit s'il peut partir. */
function ChannelPicker({
  reminderId,
  onSent,
  onWhatsappLink,
  onClose,
}: {
  reminderId: string;
  onSent: () => void;
  onWhatsappLink: (phone: string) => void;
  onClose: () => void;
}) {
  const options = trpc.reminders.channelOptions.useQuery({ id: reminderId });
  const sendVia = trpc.reminders.sendVia.useMutation({ onSuccess: onSent });
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{L("picker.title")}</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("reminders.queue.cancel")}
        </Button>
      </div>
      {options.isLoading && <div className="h-20 animate-pulse rounded-md bg-surface-2" />}
      {options.error && <p className="text-sm text-status-bad">{options.error.message}</p>}
      {options.data && (
        <div className="grid gap-2 sm:grid-cols-3">
          {options.data.map((o) => {
            const ch = o.channel as ChannelInput;
            const Icon = CHANNEL_ICON[ch];
            const manualLink = o.mode === "manual_only" && ch === "WHATSAPP" && !!o.address;
            const usable = !!o.address && (o.mode === "auto" || o.mode === "test" || manualLink);
            const note = !o.address
              ? ch === "EMAIL"
                ? L("picker.noEmail")
                : L("picker.noMobile")
              : o.error
                ? L("picker.error", { error: o.error.slice(0, 60) })
                : L(`picker.mode.${o.mode}`);
            return (
              <button
                key={ch}
                type="button"
                disabled={!usable || sendVia.isPending}
                onClick={() =>
                  manualLink
                    ? onWhatsappLink(o.address!)
                    : sendVia.mutate({ id: reminderId, channel: ch })
                }
                className="flex min-h-20 flex-col items-start gap-1 rounded-lg border border-border bg-surface p-3 text-left enabled:hover:border-accent disabled:opacity-55"
              >
                <span className="flex items-center gap-2 font-semibold">
                  <Icon size={16} aria-hidden />
                  {REMINDER_CHANNEL_LABELS[ch]}
                </span>
                {o.address && <span className="text-xs text-muted">{maskAddress(o.address)}</span>}
                <span
                  className={`text-xs ${!usable ? "text-status-bad" : o.mode === "test" ? "text-status-warn" : "text-status-ok"}`}
                >
                  {note}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {sendVia.error && <p className="text-sm text-status-bad">{sendVia.error.message}</p>}
      <p className="text-xs text-muted">{L("picker.hint")}</p>
    </div>
  );
}

function ReminderRow({
  reminder,
  selectable,
  selected,
  onToggleSelected,
  onChanged,
}: {
  reminder: ReminderCard;
  selectable: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onChanged: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(reminder.renderedBody ?? "");
  const [snoozing, setSnoozing] = useState(false);
  const [until, setUntil] = useState("");
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState<string>(REMINDER_SKIP_REASONS[0]);
  const [stopSequence, setStopSequence] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [now] = useState(() => Date.now());

  const preview = trpc.reminders.preview.useQuery(
    { id: reminder.id, channel: reminder.channel ?? "SMS" },
    { enabled: previewOpen && reminder.channel != null },
  );

  const approve = trpc.reminders.approve.useMutation({ onSuccess: onChanged });
  const update = trpc.reminders.update.useMutation({
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });
  const snooze = trpc.reminders.snooze.useMutation({
    onSuccess: () => {
      setSnoozing(false);
      onChanged();
    },
  });
  const skip = trpc.reminders.skip.useMutation({
    onSuccess: () => {
      setSkipping(false);
      onChanged();
    },
  });
  const retry = trpc.reminders.retry.useMutation({ onSuccess: onChanged });
  const markWaLinkSent = trpc.reminders.markWaLinkSent.useMutation({
    onSuccess: () => {
      setWaBody(null);
      onChanged();
    },
  });
  const utils = trpc.useUtils();
  const [waBody, setWaBody] = useState<string | null>(null);
  const [waError, setWaError] = useState(false);

  async function openWhatsapp(to: string) {
    setWaError(false);
    // Fenêtre ouverte tout de suite (dans le clic) pour ne pas être bloquée par le navigateur.
    const popup = window.open("", "_blank");
    try {
      const { body: text } = await utils.reminders.preview.fetch({
        id: reminder.id,
        channel: "WHATSAPP",
      });
      const url = `https://wa.me/${to.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
      if (popup) {
        popup.opener = null;
        popup.location.href = url;
      } else {
        window.location.href = url;
      }
      setWaBody(text);
    } catch {
      popup?.close();
      setWaError(true);
    }
  }

  const isActionable = (ACTIONABLE as readonly string[]).includes(reminder.status);
  const isReady = reminder.status === "NEEDS_APPROVAL" && reminder.channel != null;
  const isBlocked = reminder.status === "NEEDS_APPROVAL" && reminder.channel == null;
  const isFailed = reminder.status === "FAILED";
  const isPlanned = reminder.status === "PLANNED";
  const isUnconfirmed = reminder.status === "SENT" && reminder.delivery?.state === "sent";
  const canCancel = (CANCELLABLE as readonly string[]).includes(reminder.status);
  const canWaLink = reminder.channel === "WHATSAPP" && isActionable;
  const phone = reminder.customer.whatsappPhone ?? reminder.customer.phone ?? null;
  const anyPending =
    approve.isPending || update.isPending || snooze.isPending || skip.isPending || retry.isPending;
  const TypeIcon = TYPE_ICON[reminder.type] ?? Bell;

  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border bg-surface p-4 ${
        selected ? "border-accent ring-1 ring-accent" : "border-border"
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {selectable && (
            <input
              type="checkbox"
              className="mt-2.5 size-5 shrink-0"
              checked={selected}
              onChange={onToggleSelected}
              aria-label={t("reminders.queue.select")}
            />
          )}
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground"
          >
            <TypeIcon size={18} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/clients/${reminder.customerId}`}
                className="font-semibold hover:underline"
              >
                {reminder.customer.displayName}
              </Link>
              <StatusBadge tone="off">
                {REMINDER_TYPE_LABELS[reminder.type] ?? reminder.type}
              </StatusBadge>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span>{stepText(reminder.stepKey)}</span>
              {reminder.vehicle && (
                <span className="rounded border border-border bg-surface-2 px-1.5 font-mono text-xs text-foreground">
                  {reminder.vehicle.plate}
                </span>
              )}
              {reminder.invoice && (
                <span>
                  {L("invoice", {
                    number: reminder.invoice.number ?? "",
                    amount: formatFCFA(reminder.invoice.balance),
                  })}
                </span>
              )}
            </p>
            <StatusLine reminder={reminder} now={now} />
          </div>
        </div>

        {/* Une action principale selon la situation, le reste dans « Plus ». */}
        <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
          {isReady && (
            <Button
              disabled={anyPending}
              onClick={() => approve.mutate({ ids: [reminder.id], sendNow: true })}
            >
              <Send size={16} aria-hidden />
              {L("actions.sendBy", { channel: channelLabel(reminder.channel) })}
            </Button>
          )}
          {isReady && !picking && (
            <Button variant="ghost" disabled={anyPending} onClick={() => setPicking(true)}>
              {L("actions.otherChannel")}
            </Button>
          )}
          {(isBlocked || isFailed) && !picking && (
            <Button disabled={anyPending} onClick={() => setPicking(true)}>
              <RotateCcw size={16} aria-hidden />
              {L("actions.resendBy")}
            </Button>
          )}
          {isPlanned && new Date(reminder.scheduledFor).getTime() > now && (
            <Button
              variant="secondary"
              disabled={anyPending}
              onClick={() => approve.mutate({ ids: [reminder.id], sendNow: true })}
            >
              <Send size={16} aria-hidden />
              {L("actions.sendNow")}
            </Button>
          )}
          {canWaLink && phone && waBody === null && (
            <Button
              variant="secondary"
              disabled={anyPending}
              onClick={() => void openWhatsapp(phone)}
            >
              <MessageCircle size={16} aria-hidden />
              {t("reminders.queue.openWhatsapp")}
            </Button>
          )}
          {(isBlocked || isFailed || isUnconfirmed) && phone && (
            <a
              href={`tel:${phone}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-surface-2 px-4 text-sm font-medium hover:bg-border"
            >
              <Phone size={16} aria-hidden />
              {t("reminders.queue.call")}
            </a>
          )}
          {reminder.channel && (
            <Button variant="ghost" onClick={() => setPreviewOpen((v) => !v)}>
              {previewOpen ? L("actions.hideMessage") : L("actions.showMessage")}
            </Button>
          )}
          {canCancel && (
            <div className="relative">
              <button
                type="button"
                aria-label={L("actions.more")}
                title={L("actions.more")}
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
                className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-surface-2"
              >
                <MoreHorizontal size={18} aria-hidden />
              </button>
              {moreOpen && (
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-1 flex min-w-56 flex-col rounded-lg border border-border bg-surface p-1 shadow-lg"
                >
                  {isActionable && (
                    <button
                      role="menuitem"
                      type="button"
                      className="min-h-11 rounded-md px-3 text-left text-sm hover:bg-surface-2"
                      onClick={() => {
                        setEditing(true);
                        setMoreOpen(false);
                      }}
                    >
                      {L("actions.editText")}
                    </button>
                  )}
                  <button
                    role="menuitem"
                    type="button"
                    className="min-h-11 rounded-md px-3 text-left text-sm hover:bg-surface-2"
                    onClick={() => {
                      setSnoozing(true);
                      setMoreOpen(false);
                    }}
                  >
                    {L("actions.snooze")}
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    className="min-h-11 rounded-md px-3 text-left text-sm text-status-bad hover:bg-surface-2"
                    onClick={() => {
                      setSkipping(true);
                      setMoreOpen(false);
                    }}
                  >
                    {L("actions.dontSend")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {picking && (
        <ChannelPicker
          reminderId={reminder.id}
          onClose={() => setPicking(false)}
          onSent={() => {
            setPicking(false);
            onChanged();
          }}
          onWhatsappLink={(to) => {
            setPicking(false);
            void openWhatsapp(to);
          }}
        />
      )}

      {previewOpen && reminder.channel && (
        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <p className="mb-1 text-xs font-semibold text-muted uppercase">
            {L("messageBy", { channel: channelLabel(reminder.channel) })}
          </p>
          {preview.isLoading && <p className="text-muted">{t("reminders.queue.previewLoading")}</p>}
          {preview.isError && (
            <p className="text-status-bad">
              {preview.error.message || t("reminders.queue.previewError")}
            </p>
          )}
          {preview.data && (
            <>
              {preview.data.subject && <p className="mb-1 font-medium">{preview.data.subject}</p>}
              <p className="whitespace-pre-wrap">{preview.data.body}</p>
              {preview.data.sms && (
                <p className="mt-2 text-xs text-muted">
                  {t("reminders.queue.smsStats", {
                    chars: preview.data.sms.chars,
                    segments: preview.data.sms.segments,
                    encoding: preview.data.sms.encoding,
                  })}
                </p>
              )}
              {preview.data.warnings.map((warning, index) => (
                <StatusBadge key={index} tone="warn">
                  {warning}
                </StatusBadge>
              ))}
            </>
          )}
        </div>
      )}

      {/* M11 US wa_link : wa.me s'ouvre avec le message ; « Oui » au retour enregistre l'envoi. */}
      {waBody !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-3 text-sm">
          <span>{t("reminders.queue.waConfirm")}</span>
          <Button
            disabled={markWaLinkSent.isPending}
            onClick={() => markWaLinkSent.mutate({ id: reminder.id, body: waBody })}
          >
            {t("reminders.queue.waYes")}
          </Button>
          <Button variant="ghost" onClick={() => setWaBody(null)}>
            {t("reminders.queue.waNo")}
          </Button>
        </div>
      )}
      {waError && <p className="text-xs text-status-bad">{t("reminders.queue.waOpenError")}</p>}

      {editing && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            update.mutate({ id: reminder.id, body: body.trim() });
          }}
        >
          <textarea
            aria-label={t("reminders.queue.messageBody")}
            className="min-h-24 rounded-md border border-border bg-surface p-3 text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={update.isPending}>
              {t("reminders.queue.save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              {t("reminders.queue.cancel")}
            </Button>
          </div>
          {update.error && <p className="text-xs text-status-bad">{update.error.message}</p>}
        </form>
      )}

      {snoozing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!until) return;
            snooze.mutate({ ids: [reminder.id], until: new Date(until) });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t("reminders.queue.snoozeUntil")}
            <input
              type="datetime-local"
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={snooze.isPending}>
            {t("reminders.queue.confirm")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSnoozing(false)}>
            {t("reminders.queue.cancel")}
          </Button>
          {snooze.error && <p className="text-xs text-status-bad">{snooze.error.message}</p>}
        </form>
      )}

      {skipping && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            skip.mutate({ ids: [reminder.id], reason, stopSequence });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {L("dontSendWhy")}
            <select
              className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {REMINDER_SKIP_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={stopSequence}
              onChange={(e) => setStopSequence(e.target.checked)}
            />
            {L("stopNext")}
          </label>
          <Button type="submit" disabled={skip.isPending}>
            {t("reminders.queue.confirm")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSkipping(false)}>
            {t("reminders.queue.cancel")}
          </Button>
          {skip.error && <p className="text-xs text-status-bad">{skip.error.message}</p>}
        </form>
      )}

      {approve.error && <p className="text-xs text-status-bad">{approve.error.message}</p>}
      {retry.error && <p className="text-xs text-status-bad">{retry.error.message}</p>}
      {markWaLinkSent.error && (
        <p className="text-xs text-status-bad">{markWaLinkSent.error.message}</p>
      )}
    </article>
  );
}
