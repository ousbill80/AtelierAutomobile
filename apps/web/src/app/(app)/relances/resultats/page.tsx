"use client";

// PRD M10 §7 — « Résultats des relances » : ce qui est parti (ou non) sur une période et ce que
// cela a produit (issues). Les montants récupérés et le CA généré restent sur le tableau de
// bord (M12, onglet Relances) qui exige `report:read` ; cette page ne demande que `reminder:read`.
import { useMemo, useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHead,
  PlateBadge,
  Select,
  StatusBadge,
  type StatusTone,
} from "@atelieros/ui";
import { t } from "@/i18n/t";
import type { AppRouter } from "@/server/routers/_app";
import { trpc } from "@/trpc/react";
import { formatDate } from "../reminder-labels";

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

const STATUS_TONE: Record<HistoryStatus, StatusTone> = {
  SENT: "ok",
  FAILED: "bad",
  CANCELLED: "off",
  SKIPPED: "warn",
};

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function ReminderResultsPage() {
  const [from, setFrom] = useState(() => toDateInputValue(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => toDateInputValue(new Date()));
  const [status, setStatus] = useState<HistoryStatus | "">("");
  const [type, setType] = useState<ReminderType | "">("");

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
      limit: 50,
    },
    {
      enabled: rangeValid,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = history.data?.pages[0]?.summary ?? null;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title={t("reminders.results.title")}
        description={t("reminders.results.description")}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("reminders.results.fromLabel")}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("reminders.results.toLabel")}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t("reminders.results.statusFilterLabel")}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as HistoryStatus | "")}>
            <option value="">{t("reminders.results.allStatuses")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`reminders.status.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("reminders.results.typeFilterLabel")}>
          <Select value={type} onChange={(e) => setType(e.target.value as ReminderType | "")}>
            <option value="">{t("reminders.results.allTypes")}</option>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`reminders.types.${ty}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {!rangeValid && (
        <p className="text-sm text-status-bad">{t("reminders.results.invalidRange")}</p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-lg border border-border bg-surface p-3">
            {summary ? (
              <p
                className="tabular text-2xl font-semibold"
                aria-label={t("reminders.results.kpiLabel", {
                  label: t(`reminders.status.${s}`),
                  count: summary.byStatus[s],
                })}
              >
                {summary.byStatus[s]}
              </p>
            ) : (
              <div className="h-8 w-12 animate-pulse rounded bg-surface-2" aria-hidden="true" />
            )}
            <StatusBadge tone={STATUS_TONE[s]} label={t(`reminders.status.${s}`)} />
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className="mb-2 text-lg font-semibold">{t("reminders.results.outcomesTitle")}</h2>
        {!summary ? (
          <div className="h-6 animate-pulse rounded bg-surface-2" aria-hidden="true" />
        ) : summary.byOutcome.length === 0 ? (
          <p className="text-sm text-muted">{t("reminders.results.outcomesEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {summary.byOutcome.map((o) => (
              <li key={o.outcome} className="flex justify-between gap-2">
                <span>{t(`reminders.outcomes.${o.outcome}`)}</span>
                <strong className="tabular">{o.count}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      {history.isLoading && rangeValid ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-border bg-surface-2"
            />
          ))}
        </div>
      ) : history.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">{t("reminders.results.error")}</p>
          <Button variant="secondary" onClick={() => history.refetch()}>
            {t("reminders.results.retry")}
          </Button>
        </div>
      ) : (
        <DataTable<HistoryItem>
          rowKey={(row) => row.id}
          rows={items}
          empty={
            <EmptyState
              title={t("reminders.results.empty.title")}
              description={t("reminders.results.empty.description")}
            />
          }
          columns={[
            {
              key: "type",
              header: t("reminders.results.table.type"),
              render: (row) => `${t(`reminders.types.${row.type}`)} · ${row.stepKey}`,
              primary: true,
            },
            {
              key: "customer",
              header: t("reminders.results.table.customer"),
              render: (row) => (
                <Link href={`/clients/${row.customer.id}`} className="underline">
                  {row.customer.displayName}
                </Link>
              ),
            },
            {
              key: "vehicle",
              header: t("reminders.results.table.vehicle"),
              render: (row) =>
                row.vehicle ? (
                  <PlateBadge plate={row.vehicle.plate} plateType={row.vehicle.plateType} />
                ) : (
                  "—"
                ),
            },
            {
              key: "channel",
              header: t("reminders.results.table.channel"),
              render: (row) => (row.channel ? t(`common.channels.${row.channel}`) : "—"),
            },
            {
              key: "status",
              header: t("reminders.results.table.status"),
              render: (row) => (
                <StatusBadge
                  tone={STATUS_TONE[row.status as HistoryStatus] ?? "off"}
                  label={t(`reminders.status.${row.status}`)}
                />
              ),
            },
            {
              key: "when",
              header: t("reminders.results.table.when"),
              render: (row) => formatDate(row.sentAt ?? row.updatedAt),
            },
            {
              key: "reason",
              header: t("reminders.results.table.reason"),
              render: (row) =>
                row.outcome
                  ? t(`reminders.outcomes.${row.outcome}`)
                  : (row.skippedReason ?? t("reminders.results.noReason")),
            },
          ]}
        />
      )}

      {history.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => history.fetchNextPage()}
          disabled={history.isFetchingNextPage}
        >
          {t("reminders.results.loadMore")}
        </Button>
      )}
    </div>
  );
}
