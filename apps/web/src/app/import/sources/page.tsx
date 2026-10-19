"use client";

// M13 §7 — `/import/sources` : liste des sources de synchronisation (partie 2, étape 6.4).
import Link from "next/link";
import { Database, Plus } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { DataTable } from "@atelieros/ui/src/data-table";
import { EmptyState } from "@atelieros/ui/src/empty-state";
import { StatusBadge } from "@atelieros/ui/src/status-badge";
import type { AppRouter } from "@/server/routers/_app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { trpc } from "@/trpc/client";
import { formatDateTime, scheduleLabel, sourceStatus } from "./shared";

type Source = inferRouterOutputs<AppRouter>["dataSources"]["list"][number];

export default function SourcesPage() {
  const query = trpc.dataSources.list.useQuery();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("import.sources.title")}</h1>
          <p className="text-sm text-muted">{t("import.sources.description")}</p>
        </div>
        <Button asChild>
          <Link href="/import/sources/nouvelle">
            <Plus className="size-4" />
            {t("import.sources.new")}
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5 text-accent" />
            {t("import.sources.title")}
          </CardTitle>
          <CardDescription>{t("import.sources.form.readOnlyHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {query.isError ? (
            <EmptyState
              icon={Database}
              title={t("import.sources.error")}
              action={
                <Button variant="outline" onClick={() => query.refetch()}>
                  {t("import.sources.retry")}
                </Button>
              }
            />
          ) : (
            <DataTable<Source>
              columns={[
                {
                  key: "name",
                  header: t("import.sources.columns.name"),
                  render: (s) => (
                    <Link href={`/import/sources/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                  ),
                },
                {
                  key: "type",
                  header: t("import.sources.columns.type"),
                  render: (s) => t(`import.sources.dbTypes.${s.connection.dbType}`),
                },
                {
                  key: "schedule",
                  header: t("import.sources.columns.schedule"),
                  render: (s) => scheduleLabel(s.schedule),
                },
                {
                  key: "lastRun",
                  header: t("import.sources.columns.lastRun"),
                  render: (s) => formatDateTime(s.lastRunAt),
                },
                {
                  key: "status",
                  header: t("import.sources.columns.status"),
                  render: (s) => {
                    const status = sourceStatus(s);
                    return (
                      <StatusBadge tone={status.tone} icon={status.icon}>
                        {t(`import.sources.status.${status.key}`)}
                      </StatusBadge>
                    );
                  },
                },
              ]}
              rows={query.data ?? []}
              rowKey={(s) => s.id}
              isLoading={query.isLoading}
              emptyState={
                <EmptyState
                  icon={Database}
                  title={t("import.sources.emptyTitle")}
                  description={t("import.sources.emptyDescription")}
                />
              }
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
