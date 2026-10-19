"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Download, ScrollText } from "lucide-react";
import {
  Avatar,
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHead,
  Select,
  StatusBadge,
  type StatusTone,
} from "@atelieros/ui";
import { t, tEntry } from "@/i18n/t";
import { trpc } from "@/trpc/client";

const PAGE_SIZE = 50;

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

function formatAction(action: string): string {
  return tEntry("auditActions", action);
}

function formatEntity(entity: string): string {
  return tEntry("settings.journal.entities", entity);
}

/** Couleur + texte : échec en rouge, désactivation/révocation en orange, création en vert. */
function actionTone(action: string): StatusTone {
  if (/failed|locked/.test(action)) return "bad";
  if (/deactivated|revoked|void|deleted/.test(action)) return "warn";
  if (/created|joined|invited|success|reactivated/.test(action)) return "ok";
  return "off";
}

function endOfDay(value: string): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export default function JournalPage() {
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      action: action || undefined,
      userId: userId || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? endOfDay(to) : undefined,
    }),
    [action, userId, from, to],
  );
  const hasFilters = Boolean(action || userId || from || to);

  const facets = trpc.audit.facets.useQuery();
  const logs = trpc.audit.list.useInfiniteQuery(
    { ...filters, limit: PAGE_SIZE },
    { getNextPageParam: (last) => last.nextCursor },
  );
  const rows = useMemo(() => logs.data?.pages.flatMap((page) => page.items) ?? [], [logs.data]);

  const exportCsv = trpc.audit.export.useMutation({
    onSuccess(result) {
      setExportError(null);
      const link = document.createElement("a");
      link.href = result.fileUrl;
      link.download = "journal-audit.csv";
      link.click();
    },
    onError() {
      setExportError(t("settings.journal.exportError"));
    },
  });

  function resetFilters() {
    setAction("");
    setUserId("");
    setFrom("");
    setTo("");
  }

  return (
    <>
      <PageHead
        title={t("settings.journal.title")}
        description={t("settings.journal.description")}
        actions={
          <Button
            variant="secondary"
            loading={exportCsv.isPending}
            disabled={rows.length === 0 || exportCsv.isPending}
            onClick={() => exportCsv.mutate(filters)}
          >
            <Download size={16} aria-hidden="true" />
            {t("settings.journal.export")}
          </Button>
        }
      />

      <div className="filter-bar">
        <Field label={t("settings.journal.filters.action")}>
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t("settings.journal.filters.allActions")}</option>
            {(facets.data?.actions ?? []).map((value) => (
              <option key={value} value={value}>
                {formatAction(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("settings.journal.filters.user")}>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t("settings.journal.filters.allUsers")}</option>
            {(facets.data?.users ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("settings.journal.filters.from")}>
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label={t("settings.journal.filters.to")}>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        {hasFilters ? (
          <div className="filter-bar-actions">
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              {t("settings.journal.filters.reset")}
            </Button>
          </div>
        ) : null}
      </div>

      {exportError ? (
        <div className="alert alert-warn" role="alert" style={{ marginBottom: 14 }}>
          <AlertCircle size={18} aria-hidden="true" />
          <span>{exportError}</span>
        </div>
      ) : null}

      {logs.isError ? (
        <div className="alert alert-bad" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{t("settings.journal.loadError")}</span>
        </div>
      ) : logs.isLoading ? (
        <div className="table-wrap table-skeleton" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 40 }} />
          ))}
        </div>
      ) : (
        <>
          {rows.length > 0 ? (
            <p className="table-meta">
              <span>{t("settings.journal.shown", { count: rows.length })}</span>
            </p>
          ) : null}
          <DataTable
            columns={[
              {
                key: "date",
                header: t("settings.journal.table.date"),
                primary: true,
                render: (row) => {
                  const date = new Date(row.createdAt);
                  return (
                    <span className="tabular">
                      {DATE_FORMAT.format(date)}
                      <span className="cell-sub">{TIME_FORMAT.format(date)}</span>
                    </span>
                  );
                },
              },
              {
                key: "user",
                header: t("settings.journal.table.user"),
                render: (row) =>
                  row.user ? (
                    <span className="user-cell">
                      <Avatar label={row.user.name} />
                      <span>
                        <span className="name">{row.user.name}</span>
                        {row.user.email ? <span className="sub">{row.user.email}</span> : null}
                      </span>
                    </span>
                  ) : (
                    <span className="muted">{t("settings.journal.unknownUser")}</span>
                  ),
              },
              {
                key: "action",
                header: t("settings.journal.table.action"),
                render: (row) => (
                  <span>
                    <StatusBadge tone={actionTone(row.action)} label={formatAction(row.action)} />
                    {row.reason ? (
                      <span className="cell-sub">
                        {t("settings.journal.table.reason")} : {row.reason}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: "entity",
                header: t("settings.journal.table.entity"),
                render: (row) => (
                  <span>
                    {formatEntity(row.entity)}
                    <span className="cell-sub mono-id" title={row.entityId}>
                      {row.entityId.length > 12 ? `${row.entityId.slice(0, 12)}…` : row.entityId}
                    </span>
                  </span>
                ),
              },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={<ScrollText size={28} />}
                title={t("settings.journal.empty.title")}
                description={t("settings.journal.empty.description")}
                action={
                  hasFilters ? (
                    <Button variant="secondary" size="sm" onClick={resetFilters}>
                      {t("settings.journal.filters.reset")}
                    </Button>
                  ) : undefined
                }
              />
            }
          />
          {logs.hasNextPage ? (
            <div className="table-footer">
              <Button
                variant="secondary"
                size="sm"
                loading={logs.isFetchingNextPage}
                onClick={() => logs.fetchNextPage()}
              >
                {t("settings.journal.loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
