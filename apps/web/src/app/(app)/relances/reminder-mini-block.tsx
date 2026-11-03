"use client";

// PRD M10 §7.4 — bloc « Relances » des fiches client/véhicule : ce qui attend (« À valider »,
// « Planifiées aujourd'hui ») et les dernières relances parties ou terminées
// (`reminders.history` filtré sur la fiche), avec un lien vers les résultats filtrés.
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, StatusBadge } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { formatDate, formatDateTime, reminderStatusTone } from "./reminder-labels";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ReminderMiniItem = RouterOutputs["reminders"]["queue"]["items"][number];
type ReminderHistoryItem = RouterOutputs["reminders"]["history"]["items"][number];

// Toute l'histoire de la fiche : `history` exige une période, on la prend large.
const HISTORY_FROM = new Date("2000-01-01T00:00:00.000Z");

export function ReminderMiniBlock({
  customerId,
  vehicleId,
}: {
  customerId?: string;
  vehicleId?: string;
}) {
  const toApprove = trpc.reminders.queue.useQuery({
    tab: "TO_APPROVE",
    customerId,
    vehicleId,
    limit: 5,
  });
  const planned = trpc.reminders.queue.useQuery({
    tab: "PLANNED_TODAY",
    customerId,
    vehicleId,
    limit: 5,
  });
  const recent = trpc.reminders.history.useQuery({
    from: HISTORY_FROM,
    to: endOfToday(),
    customerId,
    vehicleId,
    limit: 5,
  });

  const queries = [toApprove, planned, recent];
  const loading = queries.some((q) => q.isLoading);
  const failed = queries.some((q) => q.isError);
  const toApproveItems = toApprove.data?.items ?? [];
  const plannedItems = planned.data?.items ?? [];
  const recentItems = recent.data?.items ?? [];
  const empty =
    !loading &&
    !failed &&
    toApproveItems.length === 0 &&
    plannedItems.length === 0 &&
    recentItems.length === 0;

  const filter = customerId
    ? `customerId=${customerId}`
    : vehicleId
      ? `vehicleId=${vehicleId}`
      : "";
  const seeAllHref = filter ? `/relances/resultats?${filter}` : "/relances/resultats";

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{t("reminders.mini.title")}</h2>
        <Link href={seeAllHref} className="text-sm text-accent hover:underline">
          {t("reminders.mini.seeAll")}
        </Link>
      </div>
      {loading && (
        <div className="flex flex-col gap-2" aria-label={t("reminders.mini.loading")}>
          {[0, 1].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-surface-2" aria-hidden="true" />
          ))}
        </div>
      )}
      {!loading && failed && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-status-bad">{t("reminders.mini.error")}</p>
          <Button variant="secondary" onClick={() => queries.forEach((q) => q.refetch())}>
            {t("reminders.mini.retry")}
          </Button>
        </div>
      )}
      {empty && <p className="text-sm text-muted">{t("reminders.mini.empty")}</p>}
      {!loading && !failed && !empty && (
        <div className="flex flex-col gap-4">
          {(toApproveItems.length > 0 || plannedItems.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <PendingList title={t("reminders.mini.toApprove")} items={toApproveItems} />
              <PendingList title={t("reminders.mini.plannedToday")} items={plannedItems} />
            </div>
          )}
          <RecentList items={recentItems} />
        </div>
      )}
    </section>
  );
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function PendingList({ title, items }: { title: string; items: ReminderMiniItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-muted">{title}</p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="text-sm">
            {t("reminders.mini.pendingLine", {
              type: t(`reminders.types.${item.type}`),
              step: item.stepKey,
              date: formatDateTime(item.scheduledFor),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentList({ items }: { items: ReminderHistoryItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-muted">{t("reminders.mini.recent")}</p>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="font-medium">
              {t(`reminders.types.${item.type}`)} · {item.stepKey}
            </span>
            {item.channel && (
              <span className="text-muted">{t(`common.channels.${item.channel}`)}</span>
            )}
            <StatusBadge
              tone={reminderStatusTone(item.status)}
              label={t(`reminders.status.${item.status}`)}
            />
            <span className="tabular text-muted">{formatDate(item.sentAt ?? item.updatedAt)}</span>
            {item.outcome && <span>{t(`reminders.outcomes.${item.outcome}`)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
