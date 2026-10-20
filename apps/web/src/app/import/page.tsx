"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { DataTable } from "@atelieros/ui/src/data-table";
import { EmptyState } from "@atelieros/ui/src/empty-state";
import { StatusBadge, type StatusTone } from "@atelieros/ui/src/status-badge";
import type { AppRouter } from "@/server/routers/_app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { trpc } from "@/trpc/client";
import type { inferRouterOutputs } from "@trpc/server";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ImportJob = RouterOutputs["import"]["list"]["jobs"][number];

const STATUS_CONFIG: Record<string, { tone: StatusTone; icon: typeof Clock }> = {
  PENDING: { tone: "off", icon: Clock },
  VALIDATING: { tone: "info", icon: Loader2 },
  READY: { tone: "info", icon: Clock },
  RUNNING: { tone: "info", icon: Loader2 },
  COMPLETED: { tone: "ok", icon: CheckCircle2 },
  FAILED: { tone: "bad", icon: AlertTriangle },
  CANCELLED: { tone: "off", icon: Ban },
  ROLLED_BACK: { tone: "warn", icon: RotateCcw },
};

const TEMPLATE_ENTITIES = ["customers", "vehicles", "invoices", "payments"] as const;

function formatDate(value: string | Date): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export default function ImportPage() {
  const jobsQuery = trpc.import.list.useQuery({});
  const templateMutation = trpc.import.template.useMutation();
  const [downloadingEntity, setDownloadingEntity] = useState<string | null>(null);

  async function handleDownloadTemplate(entity: (typeof TEMPLATE_ENTITIES)[number]) {
    setDownloadingEntity(entity);
    try {
      const { url } = await templateMutation.mutateAsync({ entity });
      window.open(url, "_blank");
    } finally {
      setDownloadingEntity(null);
    }
  }

  const jobs = jobsQuery.data?.jobs ?? [];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold text-foreground">{t("import.list.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-accent" />
            {t("import.list.fileImportCardTitle")}
          </CardTitle>
          <CardDescription>{t("import.list.fileImportCardDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/import/fichier">{t("import.list.fileImportCardCta")}</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5 text-accent" />
            {t("import.list.syncCardTitle")}
          </CardTitle>
          <CardDescription>{t("import.list.syncCardDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/import/sources">{t("import.list.syncCardCta")}</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("import.list.templatesTitle")}</CardTitle>
          <CardDescription>{t("import.list.templatesDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {TEMPLATE_ENTITIES.map((entity) => (
            <Button
              key={entity}
              variant="outline"
              size="sm"
              disabled={downloadingEntity === entity}
              onClick={() => handleDownloadTemplate(entity)}
            >
              {downloadingEntity === entity ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {t(`import.list.entity.${entity}`)} — {t("import.list.downloadTemplate")}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("import.list.historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<ImportJob>
            columns={[
              {
                key: "date",
                header: t("import.list.columnDate"),
                render: (job) => formatDate(job.createdAt),
              },
              {
                key: "entity",
                header: t("import.list.columnEntity"),
                render: (job) => t(`import.list.entity.${job.entity}`),
              },
              {
                key: "created",
                header: t("import.list.columnCreated"),
                render: (job) => job.createdCount,
              },
              {
                key: "updated",
                header: t("import.list.columnUpdated"),
                render: (job) => job.updatedCount,
              },
              {
                key: "unchanged",
                header: t("import.list.columnUnchanged"),
                render: (job) => job.unchangedCount,
              },
              {
                key: "errors",
                header: t("import.list.columnErrors"),
                render: (job) => job.errorCount,
              },
              {
                key: "status",
                header: t("import.list.columnStatus"),
                render: (job) => {
                  const config = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.PENDING!;
                  return (
                    <StatusBadge tone={config.tone} icon={config.icon}>
                      {t(`import.list.status.${job.status}`)}
                    </StatusBadge>
                  );
                },
              },
            ]}
            rows={jobs}
            rowKey={(job) => job.id}
            isLoading={jobsQuery.isLoading}
            emptyState={
              <EmptyState
                icon={FileSpreadsheet}
                title={t("import.list.historyEmptyTitle")}
                description={t("import.list.historyEmptyDescription")}
              />
            }
          />
        </CardContent>
      </Card>
    </main>
  );
}
