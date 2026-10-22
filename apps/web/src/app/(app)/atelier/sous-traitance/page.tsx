"use client";

// M06 US-M06-11 / RG-M06-12 — /atelier/sous-traitance : lignes SUBCONTRACT par statut,
// sous-traitant, retour prévu (rouge si dépassé), alerte « vendue à perte ».
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, ExternalLink, PackageCheck, Search, Send, Truck } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, PageHead, PlateBadge, Select, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay } from "@/components/repair-orders/i18n";
import { tw } from "@/components/workshop/i18n";

type Status = "TO_SEND" | "SENT" | "RETURNED" | "CANCELLED";
const TONE: Record<Status, "ok" | "warn" | "bad" | "off"> = {
  TO_SEND: "warn",
  SENT: "warn",
  RETURNED: "ok",
  CANCELLED: "off",
};

export default function SubcontractPage() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<Status | "">("");
  const [q, setQ] = useState("");
  const list = trpc.workshop.subcontractList.useQuery({ status: status || undefined });
  const [error, setError] = useState<string | null>(null);
  const update = trpc.workshop.subcontractUpdateStatus.useMutation({
    onSuccess() {
      setError(null);
      void utils.workshop.subcontractList.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const lines = useMemo(() => list.data ?? [], [list.data]);

  // Statistiques sous-traitance
  const stats = useMemo(() => {
    const toSend = lines.filter((l) => l.status === "TO_SEND").length;
    const sent = lines.filter((l) => l.status === "SENT").length;
    const active = toSend + sent;
    const overdue = lines.filter((l) => l.overdue).length;
    const loss = lines.filter((l) => l.loss).length;
    const returned = lines.filter((l) => l.status === "RETURNED").length;
    const totalCost = lines
      .filter((l) => l.status !== "CANCELLED" && l.cost !== null)
      .reduce((s, l) => s + (l.cost ?? 0), 0);
    return { active, toSend, sent, overdue, loss, returned, totalCost };
  }, [lines]);

  const filteredLines = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return lines;
    return lines.filter(
      (l) =>
        l.description.toLowerCase().includes(query) ||
        l.repairOrder.number.toLowerCase().includes(query) ||
        l.repairOrder.plate.toLowerCase().includes(query) ||
        (l.supplierName && l.supplierName.toLowerCase().includes(query)),
    );
  }, [lines, q]);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHead title={tw("tabs.subcontract")} description={tw("subcontract.description")} />

      {/* KPI Cards / Synthèse Sous-traitance */}
      {lines.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.subcontractActive")}</span>
              <Truck className="size-4 text-accent" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{stats.active}</span>
            <span className="text-xs text-muted">
              {stats.toSend} à envoyer · {stats.sent} chez prestataire
            </span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-status-bad">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.subcontractOverdue")}</span>
              <Clock className="size-4 text-status-bad" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-bad">{stats.overdue}</span>
            <span className="text-xs text-muted">Date de retour dépassée</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-status-warn">
              <span className="text-xs font-medium uppercase tracking-wider">Vente à perte</span>
              <AlertTriangle className="size-4 text-status-warn" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-warn">{stats.loss}</span>
            <span className="text-xs text-muted">Coût &gt; Prix facturé</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.subcontractCost")}</span>
              <Truck className="size-4 text-muted" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{formatFCFA(stats.totalCost)}</span>
            <span className="text-xs text-muted">Total coût HT</span>
          </div>
        </div>
      ) : null}

      {/* Barre de filtres et recherche */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={q}
            placeholder="Rechercher prestation, OR, plaque ou sous-traitant…"
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="w-full sm:w-auto sm:min-w-48">
          <Select value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
            <option value="">{tw("subcontract.allStatuses")}</option>
            {(["TO_SEND", "SENT", "RETURNED", "CANCELLED"] as const).map((s) => (
              <option key={s} value={s}>
                {tw(`subcontract.statuses.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-status-bad">
          {error}
        </p>
      ) : null}

      {list.isLoading ? (
        <ListSkeleton rows={3} />
      ) : list.isError || !list.data ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void list.refetch()} />
      ) : filteredLines.length === 0 ? (
        <EmptyState title={tw("subcontract.empty")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {filteredLines.map((line) => (
            <li
              key={line.id}
              className={`flex flex-col justify-between gap-3 rounded-xl border bg-surface p-4 shadow-sm md:flex-row md:items-center ${
                line.overdue ? "border-status-bad" : "border-border"
              }`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-base text-foreground">{line.description}</span>
                  {line.loss ? (
                    <StatusBadge tone="bad">
                      <AlertTriangle className="size-3" aria-hidden />
                      {tw("subcontract.loss")}
                    </StatusBadge>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Link href={`/ordres/${line.repairOrder.id}`} className="font-medium text-foreground hover:underline inline-flex items-center gap-1">
                    {line.repairOrder.number}
                    <ExternalLink className="size-3" aria-hidden />
                  </Link>
                  <PlateBadge plate={line.repairOrder.plate} />
                  <span>·</span>
                  <span>{tw("subcontract.supplier")} : <strong className="text-foreground">{line.supplierName ?? tw("none")}</strong></span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted pt-0.5">
                  <span>{tw("subcontract.expected")} : <strong>{formatDay(line.expectedAt)}</strong></span>
                  <span>·</span>
                  <span>{tw("subcontract.cost")} : <strong>{line.cost !== null ? formatFCFA(line.cost) : tw("none")}</strong></span>
                  <span>·</span>
                  <span>{tw("subcontract.sale")} : <strong>{formatFCFA(line.salePrice)}</strong></span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={TONE[line.status]}
                  label={tw(`subcontract.statuses.${line.status}`)}
                />
                {line.overdue ? (
                  <StatusBadge tone="bad">
                    <Clock className="size-3" aria-hidden />
                    {tw("subcontract.overdue")}
                  </StatusBadge>
                ) : null}

                {line.status === "TO_SEND" ? (
                  <Button onClick={() => update.mutate({ lineId: line.id, status: "SENT" })}>
                    <Send className="size-4" aria-hidden /> {tw("subcontract.markSent")}
                  </Button>
                ) : null}
                {line.status === "SENT" ? (
                  <Button onClick={() => update.mutate({ lineId: line.id, status: "RETURNED" })}>
                    <PackageCheck className="size-4" aria-hidden /> {tw("subcontract.markReturned")}
                  </Button>
                ) : null}
                {line.status === "TO_SEND" || line.status === "SENT" ? (
                  <Button
                    variant="secondary"
                    onClick={() => update.mutate({ lineId: line.id, status: "CANCELLED" })}
                  >
                    {tw("subcontract.cancelLine")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
