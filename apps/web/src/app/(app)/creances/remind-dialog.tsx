"use client";

// Relance des créances (M09 §7) : un client (« Relancer ») ou tous les clients à relancer.
// L'utilisateur choisit qui relancer (retard minimum, cases à cocher) et sur quels canaux
// (WhatsApp, SMS, email) ; chaque canal coché donne un message. Le serveur revérifie tout.
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Mail, MessageCircle, MessageSquareText, Send, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "./i18n";

type Channel = "WHATSAPP" | "SMS" | "EMAIL";
type Mode = "auto" | "test" | "manual_only" | "off";

const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  WHATSAPP: MessageCircle,
  SMS: MessageSquareText,
  EMAIL: Mail,
};
const MIN_DAYS = [0, 7, 15, 30, 60] as const;

function sendable(mode: Mode) {
  return mode === "auto" || mode === "test";
}

export function RemindDialog({
  caseIds,
  title,
  onClose,
  onDone,
}: {
  /** Un ou plusieurs dossiers précis ; absent = tous les clients à relancer. */
  caseIds?: string[];
  title: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  // Tous les clients à relancer (filtre de retard) ou une sélection de plusieurs clients.
  const allEligible = !caseIds;
  const bulk = !caseIds || caseIds.length > 1;
  const [minDays, setMinDays] = useState<(typeof MIN_DAYS)[number]>(0);
  const preview = trpc.collections.remindPreview.useQuery(
    allEligible ? { minDaysOverdue: minDays } : { caseIds, minDaysOverdue: 0 },
  );
  const utils = trpc.useUtils();
  const send = trpc.collections.remindBulk.useMutation({
    onSuccess: () => {
      void utils.collections.invalidate();
      onDone?.();
    },
  });

  // Sélections de l'utilisateur ; `null` = valeurs par défaut (tous les clients éligibles,
  // tous les canaux qui peuvent partir).
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [channels, setChannels] = useState<Set<Channel> | null>(null);

  const data = preview.data;
  const eligible = useMemo(() => data?.candidates.filter((c) => c.eligible) ?? [], [data]);
  const selected = picked ?? new Set(eligible.map((c) => c.caseId));
  const defaultChannels = new Set(
    (data?.channels ?? []).filter((c) => sendable(c.mode)).map((c) => c.channel as Channel),
  );
  const chosen = channels ?? defaultChannels;

  const selectedRows = eligible.filter((c) => selected.has(c.caseId));
  const messageCount = selectedRows.reduce(
    (sum, c) => sum + c.reachable.filter((ch) => chosen.has(ch as Channel)).length,
    0,
  );
  const amount = selectedRows.reduce((sum, c) => sum + c.overdueDue, 0);

  function toggleCase(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }
  function toggleChannel(channel: Channel) {
    const next = new Set(chosen);
    if (next.has(channel)) next.delete(channel);
    else next.add(channel);
    setChannels(next);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 md:items-center md:p-4"
    >
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl md:max-w-2xl md:rounded-2xl">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted">{t("bulk.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("actions.cancel")}
            className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-surface-2"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        {send.data ? (
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
            <p className="flex items-start gap-2 rounded-lg bg-status-ok-bg p-4 text-status-ok">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                <strong className="block">
                  {t("bulk.doneTitle", {
                    customers: send.data.customers,
                    messages: send.data.messages,
                  })}
                </strong>
                <span className="text-sm">{t("bulk.doneHint")}</span>
              </span>
            </p>
            {send.data.skipped.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{t("bulk.skippedTitle")}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {send.data.skipped.map((s) => (
                    <li key={s.customerName} className="rounded-md bg-surface-2 px-3 py-2">
                      <span className="font-medium">{s.customerName}</span>
                      <span className="text-muted"> — {s.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Link href="/relances" className="btn btn-secondary min-h-11">
                {t("bulk.seeReminders")}
              </Link>
              <Button onClick={onClose}>{t("bulk.close")}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
              {preview.isLoading && (
                <div className="flex flex-col gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded-md bg-surface-2" />
                  ))}
                </div>
              )}
              {preview.isError && (
                <p className="text-sm text-status-bad">{preview.error.message}</p>
              )}

              {data && !data.ruleActive && (
                <p className="rounded-md bg-status-warn-bg p-3 text-sm text-status-warn">
                  {t("bulk.noRule")}{" "}
                  <Link href="/parametres/relances" className="underline">
                    {t("bulk.noRuleLink")}
                  </Link>
                </p>
              )}

              {data && (
                <section className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">
                      1. {bulk ? t("bulk.whoTitle") : t("bulk.whoSingle")}
                    </h3>
                    {allEligible && (
                      <label className="flex items-center gap-2 text-sm">
                        <span className="text-muted">{t("bulk.minDays")}</span>
                        <select
                          className="min-h-11 rounded-md border border-border bg-surface px-2"
                          value={minDays}
                          onChange={(e) => {
                            setMinDays(Number(e.target.value) as (typeof MIN_DAYS)[number]);
                            setPicked(null);
                          }}
                        >
                          {MIN_DAYS.map((d) => (
                            <option key={d} value={d}>
                              {d === 0
                                ? t("bulk.minDaysAll")
                                : t("bulk.minDaysOption", { days: d })}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {data.candidates.length === 0 ? (
                    <p className="rounded-md bg-surface-2 p-3 text-sm text-muted">
                      {t("bulk.nobody")}
                    </p>
                  ) : (
                    <>
                      {bulk && eligible.length > 1 && (
                        <div className="flex gap-3 text-sm">
                          <button
                            type="button"
                            className="min-h-11 font-medium text-accent"
                            onClick={() => setPicked(new Set(eligible.map((c) => c.caseId)))}
                          >
                            {t("bulk.selectAll")}
                          </button>
                          <button
                            type="button"
                            className="min-h-11 font-medium text-muted"
                            onClick={() => setPicked(new Set())}
                          >
                            {t("bulk.selectNone")}
                          </button>
                        </div>
                      )}
                      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                        {data.candidates.map((c) => (
                          <li key={c.caseId}>
                            <label
                              className={`flex min-h-14 items-center gap-3 px-3 py-2 ${c.eligible ? "cursor-pointer hover:bg-surface-2" : "opacity-70"}`}
                            >
                              <input
                                type="checkbox"
                                className="size-5 shrink-0"
                                disabled={!c.eligible}
                                checked={c.eligible && selected.has(c.caseId)}
                                onChange={() => toggleCase(c.caseId)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{c.customerName}</span>
                                <span className="block text-xs text-muted">
                                  {c.eligible
                                    ? t("bulk.rowInfo", {
                                        amount: formatFCFA(c.overdueDue),
                                        days: c.daysOverdue,
                                      })
                                    : c.reasonMessage}
                                </span>
                              </span>
                              <span
                                className="flex shrink-0 gap-1"
                                aria-label={t("bulk.reachable")}
                              >
                                {(["WHATSAPP", "SMS", "EMAIL"] as const).map((ch) => {
                                  const Icon = CHANNEL_ICON[ch];
                                  const ok = c.reachable.includes(ch);
                                  return (
                                    <Icon
                                      key={ch}
                                      size={15}
                                      className={ok ? "text-foreground" : "text-border"}
                                      aria-label={`${t(`list.channels.${ch}`)} : ${ok ? t("bulk.yes") : t("bulk.no")}`}
                                    />
                                  );
                                })}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              )}

              {data && (
                <section className="flex flex-col gap-2">
                  <h3 className="font-semibold">2. {t("bulk.channelsTitle")}</h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {data.channels.map(({ channel, mode, error }) => {
                      const ch = channel as Channel;
                      const Icon = CHANNEL_ICON[ch];
                      const can = sendable(mode as Mode);
                      const on = can && chosen.has(ch);
                      return (
                        <label
                          key={ch}
                          className={`flex min-h-20 flex-col gap-1 rounded-lg border p-3 ${
                            on ? "border-accent bg-accent/5" : "border-border"
                          } ${can ? "cursor-pointer" : "opacity-60"}`}
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <input
                              type="checkbox"
                              className="size-5"
                              disabled={!can}
                              checked={on}
                              onChange={() => toggleChannel(ch)}
                            />
                            <Icon size={16} aria-hidden />
                            {t(`list.channels.${ch}`)}
                          </span>
                          <span
                            className={`text-xs ${error ? "text-status-bad" : mode === "auto" ? "text-status-ok" : mode === "test" ? "text-status-warn" : "text-muted"}`}
                          >
                            {error
                              ? t("bulk.modeError", { error: error.slice(0, 80) })
                              : t(`bulk.mode.${mode}`)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {data.channels.some((c) => c.mode === "off" || c.mode === "manual_only") && (
                    <p className="text-xs text-muted">
                      {t("bulk.channelsHelp")}{" "}
                      <Link href="/parametres/canaux" className="underline">
                        {t("bulk.channelsLink")}
                      </Link>
                    </p>
                  )}
                </section>
              )}

              <p className="text-xs text-muted">{t("bulk.safety")}</p>
              {send.error && <p className="text-sm text-status-bad">{send.error.message}</p>}
            </div>

            <div className="flex flex-col gap-2 border-t border-border bg-surface px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                {t("bulk.summary", {
                  customers: selectedRows.length,
                  messages: messageCount,
                  amount: formatFCFA(amount),
                })}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  {t("actions.cancel")}
                </Button>
                <Button
                  disabled={
                    !data?.ruleActive ||
                    messageCount === 0 ||
                    send.isPending ||
                    selectedRows.length === 0
                  }
                  onClick={() =>
                    send.mutate({
                      caseIds: selectedRows.map((c) => c.caseId),
                      channels: [...chosen],
                    })
                  }
                >
                  <Send size={16} aria-hidden />
                  {send.isPending
                    ? t("remind.sending")
                    : t("bulk.submit", { count: selectedRows.length })}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
