"use client";

// M17 RG-M17-22 — anomalies signalées au gérant (remises, caisse, stock, pièces non facturées,
// ventes à perte, annulations, temps) : lien vers l'objet et « Marquer comme justifiée » avec
// un motif obligatoire, tracé dans le journal d'audit.
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { anomalyObjectLink } from "@atelieros/core/ai";
import { Button, EmptyState, PageHead, StatusBadge } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";

export default function AnomaliesPage() {
  const utils = trpc.useUtils();
  const list = trpc.ai.anomalies.list.useQuery({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const justify = trpc.ai.anomalies.justify.useMutation({
    onSuccess: () => {
      setOpenId(null);
      setComment("");
      void utils.ai.anomalies.list.invalidate();
      void utils.alerts.list.invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHead title={t("aiAnomalies.title")} description={t("aiAnomalies.description")} />
      {justify.isSuccess && (
        <p role="status" className="text-sm text-status-ok">
          {t("aiAnomalies.justified")}
        </p>
      )}
      {list.isError && (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
          <p className="text-sm text-status-bad">{t("aiAnomalies.loadError")}</p>
          <Button variant="secondary" onClick={() => list.refetch()}>
            {t("aiAnomalies.retry")}
          </Button>
        </div>
      )}
      {list.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      )}
      {list.data && list.data.length === 0 && <EmptyState title={t("aiAnomalies.empty")} />}
      <ul className="flex flex-col gap-2">
        {list.data?.map((alert) => (
          <li key={alert.id} className="flex flex-col gap-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-status-warn" />
                {alert.title}
              </p>
              <StatusBadge tone="warn" label={t("aiAnomalies.badge")} />
            </div>
            {alert.body && <p className="text-sm text-muted">{alert.body}</p>}
            <p className="text-xs text-muted">
              {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(
                new Date(alert.createdAt),
              )}
            </p>
            {openId === alert.id ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t("aiAnomalies.commentLabel")}</span>
                  <textarea
                    className="min-h-20 rounded-md border p-3 text-sm"
                    placeholder={t("aiAnomalies.commentPlaceholder")}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </label>
                {justify.error && (
                  <p className="text-sm text-status-bad">{justify.error.message}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="min-h-11"
                    disabled={comment.trim().length < 3}
                    loading={justify.isPending}
                    onClick={() => justify.mutate({ notificationId: alert.id, comment })}
                  >
                    {t("aiAnomalies.confirm")}
                  </Button>
                  <Button variant="ghost" className="min-h-11" onClick={() => setOpenId(null)}>
                    {t("aiAnomalies.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {anomalyObjectLink(alert.dedupeKey) && (
                  <Link
                    href={anomalyObjectLink(alert.dedupeKey)!}
                    className="btn btn-secondary min-h-11"
                  >
                    {t("aiAnomalies.open")}
                  </Link>
                )}
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => {
                    setComment("");
                    setOpenId(alert.id);
                  }}
                >
                  {t("aiAnomalies.justify")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
