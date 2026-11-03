"use client";

// Échéances › « Relancer » : l'utilisateur choisit les véhicules et les canaux (WhatsApp, SMS,
// email). Les véhicules sont présentés par client et chacun a son propre message ; les autres
// véhicules du client bientôt à échéance sont proposés.
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Mail, MessageCircle, MessageSquareText, Send, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { countDueMessages, groupDueByCustomer } from "@atelieros/core/reminders/dueRemind";
import { Button, PlateBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/i18n/t";
import { formatDate } from "../reminder-labels";

type Channel = "WHATSAPP" | "SMS" | "EMAIL";
type Mode = "auto" | "test" | "manual_only" | "off";
type Kind = "INSPECTION" | "SERVICE" | "INSURANCE";

const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  WHATSAPP: MessageCircle,
  SMS: MessageSquareText,
  EMAIL: Mail,
};

function sendable(mode: Mode) {
  return mode === "auto" || mode === "test";
}

export function DueRemindDialog({
  kind,
  vehicleIds,
  onClose,
  onDone,
}: {
  kind: Kind;
  vehicleIds: string[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const preview = trpc.reminders.dueRemindPreview.useQuery({ kind, vehicleIds });
  const utils = trpc.useUtils();
  const send = trpc.reminders.dueRemind.useMutation({
    onSuccess: () => {
      void utils.reminders.invalidate();
      onDone?.();
    },
  });

  // `null` = valeurs par défaut : véhicules demandés et éligibles, canaux qui peuvent partir.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [channels, setChannels] = useState<Set<Channel> | null>(null);

  const data = preview.data;
  const groups = useMemo(() => groupDueByCustomer(data?.vehicles ?? []), [data]);
  const selected =
    picked ??
    new Set(
      (data?.vehicles ?? []).filter((v) => v.eligible && !v.suggested).map((v) => v.vehicleId),
    );
  const chosen =
    channels ??
    new Set(
      (data?.channels ?? [])
        .filter((c) => sendable(c.mode as Mode))
        .map((c) => c.channel as Channel),
    );
  const totals = countDueMessages(groups, selected, chosen);

  function toggleVehicle(id: string) {
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

  const title = t("reminders.due.remind.title", { kind: t(`reminders.due.tabs.${kind}`) });

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
            <p className="text-sm text-muted">{t("reminders.due.remind.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("reminders.due.remind.cancel")}
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
                  {t("reminders.due.remind.doneTitle", {
                    customers: send.data.customers,
                    vehicles: send.data.vehicles,
                    messages: send.data.messages,
                  })}
                </strong>
                <span className="text-sm">{t("reminders.due.remind.doneHint")}</span>
              </span>
            </p>
            {send.data.skipped.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{t("reminders.due.remind.skippedTitle")}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {send.data.skipped.map((s) => (
                    <li key={s.plate} className="rounded-md bg-surface-2 px-3 py-2">
                      <span className="font-medium">
                        {s.plate} · {s.customerName}
                      </span>
                      <span className="text-muted"> — {s.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Link href="/relances" className="btn btn-secondary min-h-11">
                {t("reminders.due.remind.seeQueue")}
              </Link>
              <Button onClick={onClose}>{t("reminders.due.remind.close")}</Button>
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

              {data && (
                <section className="flex flex-col gap-2">
                  <h3 className="font-semibold">1. {t("reminders.due.remind.whoTitle")}</h3>
                  <ul className="flex flex-col gap-2">
                    {groups.map((group) => {
                      const first = group.vehicles[0]!;
                      const pickedCount = group.vehicles.filter(
                        (v) => v.eligible && selected.has(v.vehicleId),
                      ).length;
                      return (
                        <li
                          key={group.customerId}
                          className="overflow-hidden rounded-lg border border-border"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2 px-3 py-2">
                            <span className="font-medium">{first.customerName}</span>
                            <span className="flex items-center gap-1.5 text-xs text-muted">
                              {(["WHATSAPP", "SMS", "EMAIL"] as const).map((ch) => {
                                const Icon = CHANNEL_ICON[ch];
                                const ok = group.vehicles.some((v) => v.reachable.includes(ch));
                                return (
                                  <Icon
                                    key={ch}
                                    size={15}
                                    className={ok ? "text-foreground" : "text-border"}
                                    aria-label={`${t(`reminders.due.remind.channels.${ch}`)} : ${ok ? t("reminders.due.remind.reachable") : t("reminders.due.remind.unreachable")}`}
                                  />
                                );
                              })}
                            </span>
                          </div>
                          <ul className="divide-y divide-border">
                            {group.vehicles.map((v) => (
                              <li key={v.vehicleId}>
                                <label
                                  className={`flex min-h-14 items-center gap-3 px-3 py-2 ${v.eligible ? "cursor-pointer hover:bg-surface-2" : "opacity-70"}`}
                                >
                                  <input
                                    type="checkbox"
                                    className="size-5 shrink-0"
                                    disabled={!v.eligible}
                                    checked={v.eligible && selected.has(v.vehicleId)}
                                    onChange={() => toggleVehicle(v.vehicleId)}
                                  />
                                  <PlateBadge plate={v.plate} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm">{v.label}</span>
                                    <span className="block text-xs text-muted">
                                      {v.eligible
                                        ? v.dueDate
                                          ? t("reminders.due.remind.dueOn", {
                                              date: formatDate(v.dueDate),
                                            })
                                          : ""
                                        : v.reasonMessage}
                                    </span>
                                  </span>
                                  {v.suggested && (
                                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                                      {t("reminders.due.remind.sameCustomer")}
                                    </span>
                                  )}
                                </label>
                              </li>
                            ))}
                          </ul>
                          {pickedCount > 1 && (
                            <p className="border-t border-border bg-accent/5 px-3 py-2 text-xs">
                              {t("reminders.due.remind.grouped", { count: pickedCount })}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {data && (
                <section className="flex flex-col gap-2">
                  <h3 className="font-semibold">2. {t("reminders.due.remind.channelsTitle")}</h3>
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
                            {t(`reminders.due.remind.channels.${ch}`)}
                          </span>
                          <span
                            className={`text-xs ${error ? "text-status-bad" : mode === "auto" ? "text-status-ok" : mode === "test" ? "text-status-warn" : "text-muted"}`}
                          >
                            {error
                              ? t("reminders.due.remind.modeError", { error: error.slice(0, 80) })
                              : t(`reminders.due.remind.mode.${mode}`)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {data.channels.some((c) => c.mode === "off" || c.mode === "manual_only") && (
                    <p className="text-xs text-muted">
                      {t("reminders.due.remind.channelsHelp")}{" "}
                      <Link href="/parametres/canaux" className="underline">
                        {t("reminders.due.remind.channelsLink")}
                      </Link>
                    </p>
                  )}
                </section>
              )}

              <p className="text-xs text-muted">{t("reminders.due.remind.safety")}</p>
              {send.error && <p className="text-sm text-status-bad">{send.error.message}</p>}
            </div>

            <div className="flex flex-col gap-2 border-t border-border bg-surface px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                {t("reminders.due.remind.summary", {
                  customers: totals.customers,
                  vehicles: totals.vehicles,
                  messages: totals.messages,
                })}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  {t("reminders.due.remind.cancel")}
                </Button>
                <Button
                  disabled={totals.messages === 0 || send.isPending}
                  onClick={() =>
                    send.mutate({
                      kind,
                      vehicleIds: (data?.vehicles ?? [])
                        .filter((v) => v.eligible && selected.has(v.vehicleId))
                        .map((v) => v.vehicleId),
                      channels: [...chosen],
                    })
                  }
                >
                  <Send size={16} aria-hidden />
                  {send.isPending
                    ? t("reminders.due.remind.sending")
                    : t("reminders.due.remind.submit", { count: totals.messages })}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
