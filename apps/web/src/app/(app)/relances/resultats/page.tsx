"use client";

import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { DataTable, EmptyState, Field, Input, PageHead, Select, StatusBadge } from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type HistoryItem = RouterOutputs["reminders"]["history"]["items"][number];

const STATUSES = ["SENT", "FAILED", "CANCELLED", "SKIPPED"] as const;
const TYPES = [
  "INSPECTION",
  "SERVICE",
  "RECEIVABLE",
  "APPOINTMENT",
  "QUOTE_FOLLOWUP",
  "VEHICLE_READY",
  "INSURANCE_EXPIRY",
  "SATISFACTION",
] as const;

function statusTone(status: string): "ok" | "warn" | "bad" | "off" {
  switch (status) {
    case "SENT":
      return "ok";
    case "FAILED":
      return "bad";
    case "CANCELLED":
    case "SKIPPED":
      return "off";
    default:
      return "warn";
  }
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function ReminderResultsPage() {
  const [from, setFrom] = useState(() => toDateInputValue(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => toDateInputValue(new Date()));
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const range = useMemo(
    () => ({
      from: new Date(`${from}T00:00:00`),
      to: new Date(`${to}T23:59:59`),
    }),
    [from, to],
  );

  const statsQuery = trpc.reminders.stats.useQuery(range);
  const historyQuery = trpc.reminders.history.useQuery({
    ...range,
    status: statusFilter ? (statusFilter as (typeof STATUSES)[number]) : undefined,
    type: typeFilter ? (typeFilter as (typeof TYPES)[number]) : undefined,
    limit: 100,
  });

  const stats = statsQuery.data;

  return (
    <div className="page">
      <PageHead
        title={t("reminders.results.title")}
        description={t("reminders.results.description")}
      />

      <div className="row-actions">
        <Field label={t("reminders.results.fromLabel")}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("reminders.results.toLabel")}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t("reminders.results.statusFilterLabel")}>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t("reminders.results.allStatuses")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`reminders.status.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("reminders.results.typeFilterLabel")}>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{t("reminders.results.allTypes")}</option>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`reminders.types.${ty}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="stats-grid">
        <div className="card">
          <div className="card-kpi">{stats?.sent ?? "—"}</div>
          <div className="card-label">{t("reminders.results.stats.sent")}</div>
        </div>
        <div className="card">
          <div className="card-kpi">{stats?.failed ?? "—"}</div>
          <div className="card-label">{t("reminders.results.stats.failed")}</div>
        </div>
        <div className="card">
          <div className="card-kpi">{stats?.cancelled ?? "—"}</div>
          <div className="card-label">{t("reminders.results.stats.cancelled")}</div>
        </div>
        <div className="card">
          <div className="card-kpi">{stats?.skipped ?? "—"}</div>
          <div className="card-label">{t("reminders.results.stats.skipped")}</div>
        </div>
      </div>

      <div className="card">
        <h3>{t("reminders.results.outcomesTitle")}</h3>
        {stats && stats.outcomes.length === 0 ? (
          <p className="muted">{t("reminders.results.outcomesEmpty")}</p>
        ) : (
          <ul className="simple-list">
            {stats?.outcomes.map((o) => (
              <li key={o.outcome}>
                <span>{o.outcome ? t(`reminders.results.outcomes.${o.outcome}`) : "—"}</span>
                <strong>{o._count}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>

      {historyQuery.isLoading ? (
        <div className="card skeleton" aria-hidden="true" />
      ) : historyQuery.isError ? (
        <EmptyState title={t("reminders.results.error")} />
      ) : historyQuery.data && historyQuery.data.items.length === 0 ? (
        <EmptyState
          title={t("reminders.results.empty.title")}
          description={t("reminders.results.empty.description")}
        />
      ) : (
        <DataTable<HistoryItem>
          rowKey={(row) => row.id}
          rows={historyQuery.data?.items ?? []}
          columns={[
            {
              key: "type",
              header: t("reminders.results.table.type"),
              render: (row) => t(`reminders.types.${row.type}`),
              primary: true,
            },
            {
              key: "customer",
              header: t("reminders.results.table.customer"),
              render: (row) => row.customer.displayName,
            },
            {
              key: "vehicle",
              header: t("reminders.results.table.vehicle"),
              render: (row) => (row.vehicle ? `${row.vehicle.plate}` : "—"),
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
                  tone={statusTone(row.status)}
                  label={t(`reminders.status.${row.status}`)}
                />
              ),
            },
            {
              key: "when",
              header: t("reminders.results.table.when"),
              render: (row) => (row.sentAt ?? row.createdAt).toLocaleDateString("fr-FR"),
            },
            {
              key: "reason",
              header: t("reminders.results.table.reason"),
              render: (row) =>
                row.outcome
                  ? t(`reminders.results.outcomes.${row.outcome}`)
                  : (row.skippedReason ?? t("reminders.results.noReason")),
            },
          ]}
        />
      )}
    </div>
  );
}
