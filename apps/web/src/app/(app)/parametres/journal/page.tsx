"use client";

import { useState } from "react";
import { Button, DataTable, EmptyState, Field, Input, PageHead } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString("fr-FR");
}

function formatAction(action: string): string {
  try {
    return t(`auditActions.${action}`);
  } catch {
    return action;
  }
}

export default function JournalPage() {
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters = {
    action: action.trim() || undefined,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };

  const logs = trpc.audit.list.useQuery({ ...filters, limit: 50 });
  const exportCsv = trpc.audit.export.useMutation({
    onSuccess(result) {
      const link = document.createElement("a");
      link.href = result.fileUrl;
      link.download = "journal-audit.csv";
      link.click();
    },
  });

  return (
    <>
      <PageHead
        title={t("settings.journal.title")}
        description={t("settings.journal.description")}
        actions={
          <Button loading={exportCsv.isPending} onClick={() => exportCsv.mutate(filters)}>
            {t("settings.journal.export")}
          </Button>
        }
      />
      <div className="row-actions">
        <Field label={t("settings.journal.filters.action")}>
          <Input value={action} onChange={(e) => setAction(e.target.value)} />
        </Field>
        <Field label={t("settings.journal.filters.period")}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label=" ">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
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
            render: (row) => row.userId ?? "—",
          },
          {
            key: "action",
            header: t("settings.journal.table.action"),
            render: (row) => formatAction(row.action),
          },
          {
            key: "entity",
            header: t("settings.journal.table.entity"),
            render: (row) => `${row.entity} ${row.entityId}`,
          },
        ]}
        rows={logs.data?.items ?? []}
        rowKey={(row) => row.id}
        empty={<EmptyState title={t("common.genericError")} />}
      />
    </>
  );
}
