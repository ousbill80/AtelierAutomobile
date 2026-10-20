"use client";

// M06 US-M06-10 — /atelier/controle-qualite : OR en QUALITY_CHECK ; la fiche CQ (check-list,
// conforme / reprise avec choix des lignes) est l'écran M04 `/ordres/[id]/controle-qualite`,
// qui enregistre le `QualityCheck` (RG-M06-11).
import Link from "next/link";
import { ClipboardCheck, RotateCcw } from "lucide-react";
import { EmptyState, PageHead, PlateBadge, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { tw } from "@/components/workshop/i18n";

export default function QcQueuePage() {
  const queue = trpc.workshop.qcQueue.useQuery({}, { refetchInterval: 30_000 });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead title={tw("tabs.qc")} description={tw("qc.description")} />
      {queue.isLoading ? (
        <ListSkeleton rows={3} />
      ) : queue.isError || !queue.data ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void queue.refetch()} />
      ) : queue.data.length === 0 ? (
        <EmptyState title={tw("qc.empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {queue.data.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {order.number} <PlateBadge plate={order.plate} />
                </span>
                <span className="text-sm">
                  {order.vehicle} · {order.customerName}
                </span>
                <span className="text-xs text-muted">
                  {tw("qc.tasks", { count: order.tasks })} · {formatDateTime(order.completedAt)}
                </span>
                {order.previousChecks.length > 0 ? (
                  <span className="flex flex-wrap items-center gap-1 text-xs">
                    {tw("qc.previous", { count: order.previousChecks.length })}
                    {order.previousChecks.map((c) => (
                      <StatusBadge key={c.id} tone={c.result === "PASSED" ? "ok" : "warn"}>
                        <RotateCcw className="size-3" aria-hidden />
                        {tw(`qc.results.${c.result}`)}
                      </StatusBadge>
                    ))}
                  </span>
                ) : null}
              </div>
              <Link
                href={`/ordres/${order.id}/controle-qualite`}
                className="btn btn-primary inline-flex min-h-11 items-center gap-2"
              >
                <ClipboardCheck className="size-4" aria-hidden />
                {tw("qc.open")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
