"use client";

// PRD M10 §7.1 — file du jour. Simplifications documentées : pas de bandeau de mode (rodage/pause,
// relève de reminderSettings — hors écope de cette étape), pas de geste de balayage sur mobile (une
// rangée de boutons classique suffit), pas de filtre site/palier/conseiller (non essentiel ici).
import { useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, EmptyState, StatusBadge } from "@atelieros/ui";
import { REMINDER_SKIP_REASONS, type ReminderTypeInput } from "@atelieros/validators";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import {
  REMINDER_CHANNEL_LABELS,
  REMINDER_TAB_LABELS,
  REMINDER_TYPE_LABELS,
  formatDateTime,
} from "./reminder-labels";

type RouterOutputs = inferRouterOutputs<AppRouter>;

type Tab = keyof typeof REMINDER_TAB_LABELS;
const TABS = Object.keys(REMINDER_TAB_LABELS) as Tab[];

type ReminderCard = RouterOutputs["reminders"]["queue"]["items"][number];
type ChannelInput = "WHATSAPP" | "SMS" | "EMAIL";

const ACTIONABLE = ["NEEDS_APPROVAL", "PLANNED"] as const;
const CANCELLABLE = ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] as const;

export default function RelancesPage() {
  const [tab, setTab] = useState<Tab>("TO_APPROVE");
  const [typeFilter, setTypeFilter] = useState<ReminderTypeInput | "">("");
  const [channelFilter, setChannelFilter] = useState<ChannelInput | "">("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch, isFetching } = trpc.reminders.queue.useQuery({
    tab,
    types: typeFilter ? [typeFilter] : undefined,
    channels: channelFilter ? [channelFilter] : undefined,
    limit: 30,
  });

  function invalidateAll() {
    utils.reminders.queue.invalidate();
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

  return (
    <div className="flex flex-col gap-4 pb-20">
      <h1 className="text-2xl font-semibold">Relances</h1>

      <div className="flex flex-wrap gap-2 text-sm">
        {TABS.map((value) => (
          <button
            key={value}
            onClick={() => {
              setTab(value);
              setSelected(new Set());
            }}
            className={`min-h-11 rounded-md px-3 ${tab === value ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}
          >
            {REMINDER_TAB_LABELS[value]}
            {data && <span className="ml-1.5 opacity-80">({data.counts[value] ?? 0})</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ReminderTypeInput | "")}
        >
          <option value="">Tous les types</option>
          {Object.entries(REMINDER_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value as ChannelInput | "")}
        >
          <option value="">Tous les canaux</option>
          {Object.entries(REMINDER_CHANNEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg border border-border bg-surface-2"
            />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">Impossible de charger les relances.</p>
          <Button variant="secondary" onClick={() => refetch()}>
            Réessayer
          </Button>
        </div>
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          title="Aucune relance dans cet onglet."
          description="Revenez plus tard ou changez de filtre."
        />
      )}

      <div className="flex flex-col gap-3">
        {data?.items.map((reminder) => (
          <ReminderRow
            key={reminder.id}
            reminder={reminder}
            selected={selected.has(reminder.id)}
            onToggleSelected={() => toggleSelected(reminder.id)}
            onChanged={invalidateAll}
          />
        ))}
      </div>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border bg-surface p-3 shadow-lg md:left-56">
          <p className="text-sm">{selected.size} sélectionnée(s)</p>
          <Button
            onClick={() => approve.mutate({ ids: Array.from(selected), sendNow: true })}
            disabled={approve.isPending || isFetching}
          >
            Envoyer la sélection
          </Button>
        </div>
      )}
      {approve.error && <p className="text-sm text-status-bad">{approve.error.message}</p>}
    </div>
  );
}

function ReminderRow({
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
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {canCancel && (
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={selected}
              onChange={onToggleSelected}
              aria-label="Sélectionner cette relance"
            />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/clients/${reminder.customerId}`}
                className="font-medium hover:underline"
              >
                {reminder.customer.displayName}
              </Link>
              <StatusBadge tone={reminder.customer.type === "COMPANY" ? "off" : "ok"}>
                {reminder.customer.type === "COMPANY" ? "Entreprise" : "Particulier"}
              </StatusBadge>
              {reminder.vehicle && (
                <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs">
                  {reminder.vehicle.plate}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
              {REMINDER_TYPE_LABELS[reminder.type] ?? reminder.type} · palier {reminder.stepKey}
            </p>
          </div>
        </div>
        <div className="text-right text-sm text-muted">
          <p>{formatDateTime(reminder.scheduledFor)}</p>
          {/* M17 RG-M17-16 / US-M17-09 : heure décalée selon les habitudes du client. */}
          {reminder.timeOptimized && reminder.originalScheduledFor && (
            <p
              className="text-xs text-accent"
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
          <p>{reminder.channel ? REMINDER_CHANNEL_LABELS[reminder.channel] : "Sans canal"}</p>
        </div>
      </div>

      {reminder.channel && (
        <div>
          <button
            className="min-h-11 text-sm text-accent hover:underline"
            onClick={() => setPreviewOpen((v) => !v)}
          >
            {previewOpen ? "Masquer l'aperçu" : "Aperçu"}
          </button>
          {previewOpen && (
            <div className="mt-2 rounded-md bg-surface-2 p-3 text-sm">
              {preview.isLoading && <p className="text-muted">Chargement de l&apos;aperçu…</p>}
              {preview.isError && <p className="text-status-bad">Aperçu indisponible.</p>}
              {preview.data && (
                <>
                  {preview.data.subject && (
                    <p className="mb-1 font-medium">{preview.data.subject}</p>
                  )}
                  <p className="whitespace-pre-wrap">{preview.data.body}</p>
                  {preview.data.sms && (
                    <p className="mt-2 text-xs text-muted">
                      {preview.data.sms.chars} car. · {preview.data.sms.segments} SMS ·{" "}
                      {preview.data.sms.encoding}
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
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <Button
            variant="secondary"
            disabled={anyPending}
            onClick={() => approve.mutate({ ids: [reminder.id], sendNow: true })}
          >
            Envoyer
          </Button>
        )}
        {canRetry && (
          <Button
            variant="secondary"
            disabled={anyPending}
            onClick={() => retry.mutate({ id: reminder.id })}
          >
            Réessayer
          </Button>
        )}
        {canUpdate && (
          <Button variant="ghost" disabled={anyPending} onClick={() => setEditing((v) => !v)}>
            Modifier
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" disabled={anyPending} onClick={() => setSnoozing((v) => !v)}>
            Reporter
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" disabled={anyPending} onClick={() => setSkipping((v) => !v)}>
            Ignorer
          </Button>
        )}
        {phone ? (
          <a
            href={`tel:${phone}`}
            className="inline-flex min-h-11 items-center rounded-md bg-surface-2 px-4 text-sm font-medium hover:bg-border"
          >
            Appeler
          </a>
        ) : (
          <span className="inline-flex min-h-11 items-center px-4 text-sm text-muted">
            Appeler (numéro inconnu)
          </span>
        )}
        {canWaLink && (
          <Button
            variant="ghost"
            disabled={anyPending}
            onClick={() => markWaLinkSent.mutate({ id: reminder.id })}
          >
            Ouvrir dans WhatsApp (envoyé manuellement)
          </Button>
        )}
      </div>

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
            className="min-h-24 rounded-md border border-border bg-surface p-3 text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={update.isPending}>
              Enregistrer
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Annuler
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
            Reporter au
            <input
              type="datetime-local"
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={snooze.isPending}>
            Confirmer
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSnoozing(false)}>
            Annuler
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
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={stopSequence}
              onChange={(e) => setStopSequence(e.target.checked)}
            />
            Arrêter la séquence
          </label>
          <Button type="submit" disabled={skip.isPending}>
            Confirmer
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSkipping(false)}>
            Annuler
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
