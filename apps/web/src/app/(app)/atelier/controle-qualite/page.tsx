"use client";

// M06 US-M06-10 — /atelier/controle-qualite : OR en QUALITY_CHECK ; la fiche CQ (check-list,
// conforme / reprise avec choix des lignes) est l'écran M04 `/ordres/[id]/controle-qualite`,
// qui enregistre le `QualityCheck` (RG-M06-11).
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ClipboardCheck,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { EmptyState, PageHead, PlateBadge, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { tw } from "@/components/workshop/i18n";

export default function QcQueuePage() {
  const queue = trpc.workshop.qcQueue.useQuery({}, { refetchInterval: 30_000 });
  const [q, setQ] = useState("");

  const orders = useMemo(() => queue.data ?? [], [queue.data]);

  const stats = useMemo(() => {
    const total = orders.length;
    const reworks = orders.filter((o) => o.previousChecks.length > 0).length;
    const firstPass = total - reworks;
    return { total, reworks, firstPass };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return orders;
    return orders.filter(
      (o) =>
        o.number.toLowerCase().includes(query) ||
        o.plate.toLowerCase().includes(query) ||
        o.customerName.toLowerCase().includes(query) ||
        o.vehicle.toLowerCase().includes(query),
    );
  }, [orders, q]);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHead title={tw("tabs.qc")} description={tw("qc.description")} />

      {/* KPI Cards / Synthèse Contrôle Qualité */}
      {orders.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">
                {tw("kpis.qcWaiting")}
              </span>
              <ShieldCheck className="size-4 text-accent" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{stats.total}</span>
            <span className="text-xs text-muted">Véhicule(s) à valider</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-status-ok">
              <span className="text-xs font-medium uppercase tracking-wider">
                Première présentation
              </span>
              <CheckCircle2 className="size-4 text-status-ok" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-ok">
              {stats.firstPass}
            </span>
            <span className="text-xs text-muted">Travaux terminés</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-status-warn">
              <span className="text-xs font-medium uppercase tracking-wider">
                {tw("kpis.qcRework")}
              </span>
              <ShieldAlert className="size-4 text-status-warn" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-warn">
              {stats.reworks}
            </span>
            <span className="text-xs text-muted">Après non-conformité</span>
          </div>
        </div>
      ) : null}

      {/* Recherche rapide */}
      {orders.length > 0 ? (
        <div className="relative max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            placeholder="Rechercher par immatriculation, client ou OR…"
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : null}

      {queue.isLoading ? (
        <ListSkeleton rows={3} />
      ) : queue.isError || !queue.data ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void queue.refetch()} />
      ) : queue.data.length === 0 ? (
        <EmptyState title={tw("qc.empty")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {filteredOrders.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex flex-wrap items-center gap-2 font-semibold text-base text-foreground">
                  {order.number} <PlateBadge plate={order.plate} />
                </span>
                <span className="text-sm font-medium text-foreground">
                  {order.vehicle} · <span className="text-muted">{order.customerName}</span>
                </span>
                <span className="text-xs text-muted">
                  {tw("qc.tasks", { count: order.tasks })} · Finie le{" "}
                  {formatDateTime(order.completedAt)}
                </span>
                {order.previousChecks.length > 0 ? (
                  <span className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
                    <span className="font-medium text-muted">
                      {tw("qc.previous", { count: order.previousChecks.length })} :
                    </span>
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
                className="btn btn-primary inline-flex min-h-11 items-center gap-2 shadow-sm font-medium"
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
