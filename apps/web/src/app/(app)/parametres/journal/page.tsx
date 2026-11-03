"use client";

// M15 §7 `/parametres/journal` — journal d'audit : filtres (action, période en jours civils
// inclus, fuseau de l'organisation), pagination « Charger plus » par curseur, export CSV.
import { useState } from "react";
import { Button, DataTable, EmptyState, Field, Input, PageHead, Select } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import fr from "../../../../../messages/fr.json";

const PAGE_SIZE = 50;

/** Actions journalisées connues (libellés de `auditActions`), triées par libellé. */
const ACTION_OPTIONS = Object.entries(fr.auditActions as Record<string, string>)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, "fr"));

function formatAction(action: string): string {
  try {
    return t(`auditActions.${action}`);
  } catch {
    return action;
  }
}

function formatEntity(entity: string): string {
  try {
    return t(`auditEntities.${entity}`);
  } catch {
    return entity;
  }
}

function makeDateTimeFormatter(timeZone: string | undefined) {
  try {
    const formatter = new Intl.DateTimeFormat("fr-FR", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return (value: string | Date) => formatter.format(new Date(value));
  } catch {
    return (value: string | Date) => new Date(value).toLocaleString("fr-FR");
  }
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("common.loading")}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

export default function JournalPage() {
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);

  const org = trpc.org.get.useQuery();
  const formatDateTime = makeDateTimeFormatter(org.data?.timezone);

  const filters = {
    action: action || undefined,
    fromDate: from || undefined,
    toDate: to || undefined,
  };
  const rangeInvalid = Boolean(from && to && from > to);

  const logs = trpc.audit.list.useInfiniteQuery(
    { ...filters, limit: PAGE_SIZE },
    { getNextPageParam: (last) => last.nextCursor ?? undefined, enabled: !rangeInvalid },
  );
  const items = logs.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(action || from || to);

  const exportCsv = trpc.audit.export.useMutation({
    onSuccess(result) {
      setExportError(null);
      const link = document.createElement("a");
      link.href = result.fileUrl;
      link.download = "journal-audit.csv";
      link.click();
    },
    onError(err) {
      setExportError(err.message);
    },
  });

  return (
    <>
      <PageHead
        title={t("settings.journal.title")}
        description={t("settings.journal.description")}
        actions={
          <Button
            className="min-h-11"
            loading={exportCsv.isPending}
            disabled={rangeInvalid}
            onClick={() => {
              setExportError(null);
              exportCsv.mutate(filters);
            }}
          >
            {t("settings.journal.export")}
          </Button>
        }
      />
      {exportError ? (
        <p role="alert" className="text-sm text-status-bad">
          ✕ {exportError}
        </p>
      ) : null}
      <div className="row-actions flex-wrap">
        <Field label={t("settings.journal.filters.action")}>
          <Select className="min-h-11" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t("settings.journal.filters.allActions")}</option>
            {ACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("settings.journal.filters.from")}
          error={rangeInvalid ? t("settings.journal.filters.rangeInvalid") : null}
        >
          <Input
            className="min-h-11"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label={t("settings.journal.filters.to")}>
          <Input
            className="min-h-11"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        {filtered ? (
          <Button
            variant="secondary"
            className="min-h-11 self-end"
            onClick={() => {
              setAction("");
              setFrom("");
              setTo("");
            }}
          >
            {t("settings.journal.filters.reset")}
          </Button>
        ) : null}
      </div>

      {logs.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
          <p className="text-sm text-status-bad">✕ {t("settings.journal.loadError")}</p>
          <Button variant="secondary" className="min-h-11" onClick={() => void logs.refetch()}>
            {t("settings.journal.retry")}
          </Button>
        </div>
      ) : logs.isPending && !rangeInvalid ? (
        <TableSkeleton />
      ) : (
        <>
          <DataTable
            columns={[
              {
                key: "date",
                header: t("settings.journal.table.date"),
                primary: true,
                render: (row) => formatDateTime(row.createdAt),
              },
              {
                key: "user",
                header: t("settings.journal.table.user"),
                render: (row) =>
                  row.user?.name ??
                  (row.userId ? t("settings.journal.unknownUser") : t("settings.journal.system")),
              },
              {
                key: "action",
                header: t("settings.journal.table.action"),
                render: (row) => formatAction(row.action),
              },
              {
                key: "entity",
                header: t("settings.journal.table.entity"),
                render: (row) => (
                  <span title={row.entityId}>
                    {formatEntity(row.entity)}{" "}
                    <span className="font-mono text-xs text-muted">#{row.entityId.slice(-6)}</span>
                  </span>
                ),
              },
              {
                key: "reason",
                header: t("settings.journal.table.reason"),
                render: (row) => row.reason ?? "—",
              },
            ]}
            rows={items}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title={
                  filtered
                    ? t("settings.journal.emptyFilteredTitle")
                    : t("settings.journal.emptyTitle")
                }
                description={t("settings.journal.emptyDescription")}
              />
            }
          />
          {logs.hasNextPage ? (
            <Button
              variant="secondary"
              className="min-h-11 self-center"
              loading={logs.isFetchingNextPage}
              onClick={() => void logs.fetchNextPage()}
            >
              {t("settings.journal.loadMore")}
            </Button>
          ) : null}
        </>
      )}
    </>
  );
}
