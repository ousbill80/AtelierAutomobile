"use client";

// PRD M10 §7.1 — File du jour des relances :
// 5 cartes KPIs interactives et cliquables, onglets de statut avec compteurs en temps réel,
// filtres rapides multi-champs (client, plaque, tél), cartes modernisées avec PlateBadge officiel,
// bulle de prévisualisation et sélection multiple pour envoi groupé.
import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Smartphone,
  UserCheck,
  X,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, EmptyState, PlateBadge, StatusBadge } from "@atelieros/ui";
import { REMINDER_SKIP_REASONS, type ReminderTypeInput } from "@atelieros/validators";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { formatDateTime } from "./reminder-labels";

type RouterOutputs = inferRouterOutputs<AppRouter>;

type Tab =
  | "TO_APPROVE"
  | "PLANNED_TODAY"
  | "SENT_TODAY"
  | "FAILED"
  | "TO_CALL"
  | "EXPIRED";

const TABS: readonly Tab[] = [
  "TO_APPROVE",
  "PLANNED_TODAY",
  "SENT_TODAY",
  "FAILED",
  "TO_CALL",
  "EXPIRED",
] as const;

type ReminderCard = RouterOutputs["reminders"]["queue"]["items"][number];
type ChannelInput = "WHATSAPP" | "SMS" | "EMAIL";

const ACTIONABLE = ["NEEDS_APPROVAL", "PLANNED"] as const;
const CANCELLABLE = ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] as const;

export default function RelancesPage() {
  const [tab, setTab] = useState<Tab>("TO_APPROVE");
  const [typeFilter, setTypeFilter] = useState<ReminderTypeInput | "">("");
  const [channelFilter, setChannelFilter] = useState<ChannelInput | "">("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch, isFetching } = trpc.reminders.queue.useQuery({
    tab,
    types: typeFilter ? [typeFilter] : undefined,
    channels: channelFilter ? [channelFilter] : undefined,
    q: q.trim() || undefined,
    limit: 50,
  });

  function invalidateAll() {
    void utils.reminders.queue.invalidate();
    setSelected(new Set());
  }

  const approve = trpc.reminders.approve.useMutation({ onSuccess: invalidateAll });

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasFilter = Boolean(typeFilter || channelFilter || q.trim() || tab !== "TO_APPROVE");

  const resetFilters = () => {
    setTypeFilter("");
    setChannelFilter("");
    setQ("");
    setTab("TO_APPROVE");
    setSelected(new Set());
  };

  const counts = data?.counts ?? {
    TO_APPROVE: 0,
    PLANNED_TODAY: 0,
    SENT_TODAY: 0,
    FAILED: 0,
    TO_CALL: 0,
    EXPIRED: 0,
  };

  const stats = data?.stats;

  return (
    <div className="flex flex-col gap-6 pb-28">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Send size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t("remindersModule.title")}
              </h1>
              {counts.TO_APPROVE > 0 && (
                <span className="rounded-full bg-status-warn-bg px-2.5 py-0.5 text-xs font-semibold text-status-warn">
                  {counts.TO_APPROVE} {t("remindersModule.kpis.toApprove")}
                </span>
              )}
            </div>
            <p className="text-xs text-muted">{t("remindersModule.subtitle")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/relances/echeances"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
          >
            <Calendar size={14} className="text-muted" />
            <span>{t("remindersModule.links.dueDates")}</span>
          </Link>
          <Link
            href="/relances/resultats"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
          >
            <UserCheck size={14} className="text-muted" />
            <span>{t("remindersModule.links.results")}</span>
          </Link>
        </div>
      </div>

      {/* 5 Cartes KPIs interactives et cliquables */}
      {isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2/60" />
          ))}
        </div>
      )}

      {!isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {/* KPI 1 : À approuver */}
          <button
            type="button"
            onClick={() => {
              setTab("TO_APPROVE");
              setSelected(new Set());
            }}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              tab === "TO_APPROVE"
                ? "border-status-warn bg-status-warn-bg/30 ring-2 ring-status-warn"
                : "border-border/80 bg-surface hover:border-status-warn hover:bg-surface-2/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("remindersModule.kpis.toApprove")}
              </span>
              <Clock size={16} className="text-status-warn" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {counts.TO_APPROVE}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {t("remindersModule.kpis.toApproveHint")}
            </div>
          </button>

          {/* KPI 2 : Planifiées */}
          <button
            type="button"
            onClick={() => {
              setTab("PLANNED_TODAY");
              setSelected(new Set());
            }}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              tab === "PLANNED_TODAY"
                ? "border-accent bg-accent/10 ring-2 ring-accent"
                : "border-border/80 bg-surface hover:border-accent hover:bg-surface-2/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("remindersModule.kpis.scheduled")}
              </span>
              <Calendar size={16} className="text-accent" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {counts.PLANNED_TODAY}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {t("remindersModule.kpis.scheduledHint")}
            </div>
          </button>

          {/* KPI 3 : Envoyées */}
          <button
            type="button"
            onClick={() => {
              setTab("SENT_TODAY");
              setSelected(new Set());
            }}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              tab === "SENT_TODAY"
                ? "border-status-ok bg-status-ok-bg/30 ring-2 ring-status-ok"
                : "border-border/80 bg-surface hover:border-status-ok hover:bg-surface-2/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("remindersModule.kpis.sent")}
              </span>
              <CheckCircle2 size={16} className="text-status-ok" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {counts.SENT_TODAY}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {t("remindersModule.kpis.sentHint")}
            </div>
          </button>

          {/* KPI 4 : En échec ⚠️ */}
          <button
            type="button"
            onClick={() => {
              setTab("FAILED");
              setSelected(new Set());
            }}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              tab === "FAILED"
                ? "border-status-bad bg-status-bad-bg/40 ring-2 ring-status-bad"
                : "border-border/80 bg-surface hover:border-status-bad hover:bg-status-bad-bg/15"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-status-bad">
                {t("remindersModule.kpis.failed")}
              </span>
              <AlertCircle size={16} className="text-status-bad" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-status-bad">
              {counts.FAILED}
            </div>
            <div className="mt-1 text-[11px] font-medium text-status-bad">
              {counts.FAILED > 0 ? "À réexpédier ou vérifier" : "0 anomalie"}
            </div>
          </button>

          {/* KPI 5 : Opt-Out & Taux de succès */}
          <Link
            href="/relances/resultats"
            className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 text-left shadow-xs transition-all hover:border-accent hover:bg-surface-2/30"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("remindersModule.kpis.optOut")}
              </span>
              <ShieldAlert size={16} className="text-muted" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {stats?.optOutCount ?? 0}
              </span>
              <span className="text-xs text-muted">opt-out</span>
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {t("remindersModule.kpis.optOutHint")}
            </div>
          </Link>
        </div>
      )}

      {/* Onglets de statut avec compteurs dynamiques en temps réel */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
        {TABS.map((value) => {
          const isActive = tab === value;
          const count = counts[value] ?? 0;
          return (
            <button
              key={value}
              onClick={() => {
                setTab(value);
                setSelected(new Set());
              }}
              className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-xs font-semibold transition-all ${
                isActive
                  ? "bg-accent text-accent-fg shadow-xs"
                  : "bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <span>{t(`remindersModule.tabs.${value}`)}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  isActive ? "bg-accent-fg/20 text-accent-fg" : "bg-surface-2 text-muted"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Barre de recherche instantanée multi-champs et filtres rapides */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-3 shadow-xs">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder={t("remindersModule.filters.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-full rounded-lg border border-border/80 bg-surface pl-8 pr-8 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filtre Type rapide */}
            <select
              aria-label={t("remindersModule.types.all")}
              className="h-9 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ReminderTypeInput | "")}
            >
              <option value="">{t("remindersModule.types.all")}</option>
              <option value="INSPECTION">{t("remindersModule.types.INSPECTION")}</option>
              <option value="SERVICE">{t("remindersModule.types.SERVICE")}</option>
              <option value="RECEIVABLE">{t("remindersModule.types.RECEIVABLE")}</option>
              <option value="APPOINTMENT">{t("remindersModule.types.APPOINTMENT")}</option>
              <option value="QUOTE_FOLLOWUP">{t("remindersModule.types.QUOTE_FOLLOWUP")}</option>
              <option value="VEHICLE_READY">{t("remindersModule.types.VEHICLE_READY")}</option>
              <option value="INSURANCE_EXPIRY">{t("remindersModule.types.INSURANCE_EXPIRY")}</option>
              <option value="SATISFACTION">{t("remindersModule.types.SATISFACTION")}</option>
              <option value="RECOMMENDED_WORK">{t("remindersModule.types.RECOMMENDED_WORK")}</option>
              <option value="CUSTOM">{t("remindersModule.types.CUSTOM")}</option>
            </select>

            {/* Filtre Canal rapide */}
            <select
              aria-label={t("remindersModule.channels.all")}
              className="h-9 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as ChannelInput | "")}
            >
              <option value="">{t("remindersModule.channels.all")}</option>
              <option value="WHATSAPP">{t("remindersModule.channels.WHATSAPP")}</option>
              <option value="SMS">{t("remindersModule.channels.SMS")}</option>
              <option value="EMAIL">{t("remindersModule.channels.EMAIL")}</option>
            </select>

            {hasFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-surface-2 px-2.5 text-xs font-medium text-muted hover:text-foreground"
              >
                <X size={13} />
                <span>{t("remindersModule.filters.reset")}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Squelette de chargement */}
      {isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-border bg-surface-2/60"
            />
          ))}
        </div>
      )}

      {/* Message d'erreur */}
      {isError && (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">{t("remindersModule.error.load")}</p>
          <Button variant="secondary" onClick={() => refetch()}>
            {t("remindersModule.error.retry")}
          </Button>
        </div>
      )}

      {/* État vide */}
      {data && data.items.length === 0 && (
        <EmptyState
          title={t("remindersModule.empty.title")}
          description={t("remindersModule.empty.description")}
          action={
            hasFilter ? (
              <Button variant="secondary" onClick={resetFilters}>
                {t("remindersModule.empty.action")}
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Liste des cartes et lignes de relance modernisées */}
      <div className="flex flex-col gap-3">
        {data?.items.map((reminder) => (
          <ModernReminderRow
            key={reminder.id}
            reminder={reminder}
            selected={selected.has(reminder.id)}
            onToggleSelected={() => toggleSelected(reminder.id)}
            onChanged={invalidateAll}
          />
        ))}
      </div>

      {/* Barre flottante d'action multiple pour envoi groupé */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-surface/95 p-4 shadow-xl backdrop-blur-md md:left-64">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg">
              {selected.size}
            </span>
            <p className="text-sm font-semibold text-foreground">
              {t("remindersModule.batch.selectedCount", { count: selected.size })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setSelected(new Set())}>
              {t("remindersModule.batch.cancelSelection")}
            </Button>
            <Button
              onClick={() => approve.mutate({ ids: Array.from(selected), sendNow: true })}
              disabled={approve.isPending || isFetching}
              className="gap-1.5"
            >
              <Send size={14} />
              <span>{t("remindersModule.batch.sendSelected", { count: selected.size })}</span>
            </Button>
          </div>
        </div>
      )}

      {approve.error && <p className="text-sm text-status-bad">{approve.error.message}</p>}
    </div>
  );
}

function ModernReminderRow({
  reminder,
  selected,
  onToggleSelected,
  onChanged,
}: {
  reminder: ReminderCard;
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
  const markWaLinkSent = trpc.reminders.markWaLinkSent.useMutation({ onSuccess: onChanged });

  const canApprove =
    (ACTIONABLE as readonly string[]).includes(reminder.status) && reminder.channel != null;
  const canUpdate = (ACTIONABLE as readonly string[]).includes(reminder.status);
  const canCancel = (CANCELLABLE as readonly string[]).includes(reminder.status);
  const canRetry = reminder.status === "FAILED";
  const canWaLink =
    reminder.channel === "WHATSAPP" && (ACTIONABLE as readonly string[]).includes(reminder.status);
  const phone = reminder.customer.whatsappPhone ?? reminder.customer.phone ?? null;
  const anyPending =
    approve.isPending || update.isPending || snooze.isPending || skip.isPending || retry.isPending;

  return (
    <div
      className={`group flex flex-col gap-3 rounded-xl border p-4 shadow-xs transition-all ${
        selected
          ? "border-accent bg-accent/5 ring-1 ring-accent"
          : "border-border/80 bg-surface hover:border-border hover:bg-surface-2/20"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {canCancel && (
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 rounded border-border text-accent focus:ring-accent"
              checked={selected}
              onChange={onToggleSelected}
              aria-label={t("remindersModule.row.selectAria")}
            />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/clients/${reminder.customerId}`}
                className="font-semibold text-foreground hover:text-accent hover:underline"
              >
                {reminder.customer.displayName}
              </Link>
              <StatusBadge tone={reminder.customer.type === "COMPANY" ? "off" : "ok"}>
                {reminder.customer.type === "COMPANY"
                  ? t("remindersModule.row.company")
                  : t("remindersModule.row.individual")}
              </StatusBadge>
              {reminder.vehicle && (
                <PlateBadge
                  plate={reminder.vehicle.plate}
                  plateType={reminder.vehicle.plateType ?? undefined}
                />
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              {t(`remindersModule.types.${reminder.type}`)} ·{" "}
              {t("remindersModule.row.stepLabel", { step: reminder.stepKey })}
            </p>
          </div>
        </div>

        <div className="text-right text-xs text-muted">
          <p className="font-medium text-foreground">{formatDateTime(reminder.scheduledFor)}</p>
          {reminder.timeOptimized && reminder.originalScheduledFor && (
            <p
              className="mt-0.5 text-xs text-accent"
              title={t("aiInbox.timeOptimizedHint", {
                time: formatDateTime(reminder.originalScheduledFor),
              })}
            >
              {t("aiInbox.timeOptimized", {
                time: new Date(reminder.scheduledFor).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })}
            </p>
          )}
          <div className="mt-1 flex items-center justify-end gap-1.5">
            {reminder.channel === "WHATSAPP" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
                <MessageCircle size={12} />
                <span>{t("remindersModule.channels.WHATSAPP")}</span>
              </span>
            )}
            {reminder.channel === "SMS" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-600">
                <Smartphone size={12} />
                <span>{t("remindersModule.channels.SMS")}</span>
              </span>
            )}
            {reminder.channel === "EMAIL" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
                <Mail size={12} />
                <span>{t("remindersModule.channels.EMAIL")}</span>
              </span>
            )}
            {!reminder.channel && (
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                <AlertTriangle size={12} />
                <span>{t("remindersModule.channels.none")}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bulle de prévisualisation du message WhatsApp/SMS */}
      {reminder.channel && (
        <div className="mt-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            onClick={() => setPreviewOpen((v) => !v)}
          >
            <span>
              {previewOpen
                ? t("remindersModule.row.hidePreview")
                : t("remindersModule.row.preview")}
            </span>
          </button>
          {previewOpen && (
            <div className="mt-2.5 rounded-xl border border-border/70 bg-surface-2/40 p-3.5 text-xs">
              {preview.isLoading && (
                <p className="text-muted">{t("remindersModule.row.loadingPreview")}</p>
              )}
              {preview.isError && (
                <p className="text-status-bad">{t("remindersModule.row.errorPreview")}</p>
              )}
              {preview.data && (
                <div className="flex flex-col gap-2">
                  {preview.data.subject && (
                    <p className="font-semibold text-foreground">{preview.data.subject}</p>
                  )}
                  <div className="rounded-lg border border-border/60 bg-surface p-3 shadow-xs">
                    <p className="whitespace-pre-wrap font-sans text-xs text-foreground">
                      {preview.data.body}
                    </p>
                  </div>
                  {preview.data.sms && (
                    <p className="text-[11px] text-muted">
                      {t("remindersModule.row.smsDetails", {
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
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Barre d'actions rapides */}
      <div className="mt-1 flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
        {canApprove && (
          <Button
            variant="primary"
            className="h-8 gap-1.5 px-3 text-xs"
            disabled={anyPending}
            onClick={() => approve.mutate({ ids: [reminder.id], sendNow: true })}
          >
            <Send size={13} />
            <span>{t("remindersModule.row.actions.sendNow")}</span>
          </Button>
        )}
        {canRetry && (
          <Button
            variant="secondary"
            className="h-8 gap-1.5 px-3 text-xs text-status-bad"
            disabled={anyPending}
            onClick={() => retry.mutate({ id: reminder.id })}
          >
            <RefreshCw size={13} />
            <span>{t("remindersModule.row.actions.retry")}</span>
          </Button>
        )}
        {canUpdate && (
          <Button
            variant="ghost"
            className="h-8 px-2.5 text-xs text-muted hover:text-foreground"
            disabled={anyPending}
            onClick={() => setEditing((v) => !v)}
          >
            {t("remindersModule.row.actions.modify")}
          </Button>
        )}
        {canCancel && (
          <Button
            variant="ghost"
            className="h-8 px-2.5 text-xs text-muted hover:text-foreground"
            disabled={anyPending}
            onClick={() => setSnoozing((v) => !v)}
          >
            {t("remindersModule.row.actions.snooze")}
          </Button>
        )}
        {canCancel && (
          <Button
            variant="ghost"
            className="h-8 px-2.5 text-xs text-muted hover:text-foreground"
            disabled={anyPending}
            onClick={() => setSkipping((v) => !v)}
          >
            {t("remindersModule.row.actions.skip")}
          </Button>
        )}
        {phone ? (
          <a
            href={`tel:${phone}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-2"
          >
            <Phone size={13} className="text-status-ok" />
            <span>{t("remindersModule.row.actions.call")}</span>
          </a>
        ) : (
          <span className="inline-flex h-8 items-center px-2 text-xs text-muted">
            {t("remindersModule.row.actions.callUnknown")}
          </span>
        )}
        {canWaLink && (
          <Button
            variant="ghost"
            className="h-8 gap-1.5 px-2.5 text-xs text-emerald-600 hover:bg-emerald-500/10"
            disabled={anyPending}
            onClick={() => markWaLinkSent.mutate({ id: reminder.id })}
          >
            <ExternalLink size={13} />
            <span>{t("remindersModule.row.actions.openWaLink")}</span>
          </Button>
        )}
      </div>

      {/* Formulaire de modification */}
      {editing && (
        <form
          className="mt-2 flex flex-col gap-2 rounded-xl border border-border/80 bg-surface-2/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            update.mutate({ id: reminder.id, body: body.trim() });
          }}
        >
          <textarea
            className="min-h-20 w-full rounded-lg border border-border bg-surface p-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={update.isPending} className="h-8 text-xs">
              {t("remindersModule.row.editForm.save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setEditing(false)}
            >
              {t("remindersModule.row.editForm.cancel")}
            </Button>
          </div>
          {update.error && <p className="text-xs text-status-bad">{update.error.message}</p>}
        </form>
      )}

      {/* Formulaire de report (Snooze) */}
      {snoozing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-border/80 bg-surface-2/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!until) return;
            snooze.mutate({ ids: [reminder.id], until: new Date(until) });
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            {t("remindersModule.row.snoozeForm.label")}
            <input
              type="datetime-local"
              className="h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={snooze.isPending} className="h-8 text-xs">
            {t("remindersModule.row.snoozeForm.confirm")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => setSnoozing(false)}
          >
            {t("remindersModule.row.snoozeForm.cancel")}
          </Button>
          {snooze.error && <p className="text-xs text-status-bad">{snooze.error.message}</p>}
        </form>
      )}

      {/* Formulaire d'ignorance (Skip avec motif) */}
      {skipping && (
        <form
          className="mt-2 flex flex-wrap items-end gap-3 rounded-xl border border-border/80 bg-surface-2/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            skip.mutate({ ids: [reminder.id], reason, stopSequence });
          }}
        >
          <select
            className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-foreground focus:border-accent focus:outline-none"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {REMINDER_SKIP_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <label className="flex h-8 items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
              checked={stopSequence}
              onChange={(e) => setStopSequence(e.target.checked)}
            />
            <span>{t("remindersModule.row.skipForm.stopSequence")}</span>
          </label>
          <Button type="submit" disabled={skip.isPending} className="h-8 text-xs">
            {t("remindersModule.row.skipForm.confirm")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => setSkipping(false)}
          >
            {t("remindersModule.row.skipForm.cancel")}
          </Button>
          {skip.error && <p className="text-xs text-status-bad">{skip.error.message}</p>}
        </form>
      )}

      {approve.error && <p className="text-xs text-status-bad">{approve.error.message}</p>}
      {retry.error && <p className="text-xs text-status-bad">{retry.error.message}</p>}
      {markWaLinkSent.error && (
        <p className="text-xs text-status-bad">{markWaLinkSent.error.message}</p>
      )}
    </div>
  );
}
