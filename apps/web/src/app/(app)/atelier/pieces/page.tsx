"use client";

// M06 US-M06-07 — /atelier/pieces : demandes de pièces des tablettes, traitées par le magasin
// (M07, `stock:issue`) : préparer, commander, livrer (ajout à l'OR), refuser avec motif.
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  PackageCheck,
  PackageOpen,
  Search,
  ShoppingCart,
  X,
} from "lucide-react";
import { Button, EmptyState, Field, Modal, PageHead, PlateBadge, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { tw } from "@/components/workshop/i18n";

type Status = "REQUESTED" | "PREPARING" | "ORDERED" | "DELIVERED" | "REJECTED" | "CANCELLED";
const TONE: Record<Status, "ok" | "warn" | "bad" | "off"> = {
  REQUESTED: "warn",
  PREPARING: "warn",
  ORDERED: "warn",
  DELIVERED: "ok",
  REJECTED: "bad",
  CANCELLED: "off",
};

export default function PartRequestsPage() {
  const utils = trpc.useUtils();
  const list = trpc.partRequest.list.useQuery({}, { refetchInterval: 30_000 });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [q, setQ] = useState("");

  const update = trpc.partRequest.updateStatus.useMutation({
    onSuccess() {
      setRejecting(null);
      setReason("");
      setError(null);
      void utils.partRequest.list.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const rawList = useMemo(() => list.data ?? [], [list.data]);

  // Statistiques demandes de pièces
  const stats = useMemo(() => {
    const requested = rawList.filter((r) => r.status === "REQUESTED").length;
    const preparing = rawList.filter((r) => r.status === "PREPARING").length;
    const ordered = rawList.filter((r) => r.status === "ORDERED").length;
    const delivered = rawList.filter((r) => r.status === "DELIVERED").length;
    const urgent = rawList.filter(
      (r) =>
        (r.urgency === "HIGH" || r.urgency === "URGENT") &&
        r.status !== "DELIVERED" &&
        r.status !== "REJECTED" &&
        r.status !== "CANCELLED",
    ).length;
    return { requested, preparing, ordered, delivered, urgent, total: rawList.length };
  }, [rawList]);

  const filteredList = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rawList.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (query) {
        const matchesLabel = r.label.toLowerCase().includes(query);
        const matchesOrder = r.repairOrder.number.toLowerCase().includes(query);
        const matchesPlate = r.repairOrder.plate.toLowerCase().includes(query);
        const matchesMech = r.requestedBy.toLowerCase().includes(query);
        if (!matchesLabel && !matchesOrder && !matchesPlate && !matchesMech) return false;
      }
      return true;
    });
  }, [rawList, statusFilter, q]);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHead title={tw("tabs.parts")} description={tw("parts.description")} />

      {/* KPI Cards / Synthèse Demandes de pièces */}
      {rawList.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => setStatusFilter("REQUESTED")}
            className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
              statusFilter === "REQUESTED"
                ? "border-status-warn bg-status-warn/10 shadow-sm"
                : "border-border bg-surface hover:border-status-warn/50"
            }`}
          >
            <div className="flex items-center justify-between text-status-warn">
              <span className="text-xs font-medium uppercase tracking-wider">
                {tw("kpis.partsRequested")}
              </span>
              <PackageOpen className="size-4 text-status-warn" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-warn">
              {stats.requested}
            </span>
            <span className="text-xs text-muted">À traiter par le magasin</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("PREPARING")}
            className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
              statusFilter === "PREPARING"
                ? "border-accent bg-accent/10 shadow-sm"
                : "border-border bg-surface hover:border-accent/50"
            }`}
          >
            <div className="flex items-center justify-between text-accent">
              <span className="text-xs font-medium uppercase tracking-wider">
                {tw("kpis.partsPreparing")}
              </span>
              <Clock className="size-4 text-accent" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-accent">{stats.preparing}</span>
            <span className="text-xs text-muted">En cours de préparation</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("ORDERED")}
            className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
              statusFilter === "ORDERED"
                ? "border-foreground bg-surface-2 shadow-sm"
                : "border-border bg-surface hover:border-foreground/30"
            }`}
          >
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">Commandées</span>
              <ShoppingCart className="size-4 text-muted" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{stats.ordered}</span>
            <span className="text-xs text-muted">Attente fournisseur</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("DELIVERED")}
            className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
              statusFilter === "DELIVERED"
                ? "border-status-ok bg-status-ok/10 shadow-sm"
                : "border-border bg-surface hover:border-status-ok/50"
            }`}
          >
            <div className="flex items-center justify-between text-status-ok">
              <span className="text-xs font-medium uppercase tracking-wider">Livrées</span>
              <CheckCircle2 className="size-4 text-status-ok" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-ok">
              {stats.delivered}
            </span>
            <span className="text-xs text-muted">Remises aux mécaniciens</span>
          </button>
        </div>
      ) : null}

      {/* Barre de recherche et filtres */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            placeholder="Rechercher pièce, OR, mécanicien ou plaque…"
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter("")}
            className={`inline-flex min-h-8 items-center rounded-lg px-2.5 py-1 font-medium transition ${
              statusFilter === ""
                ? "bg-foreground text-background font-semibold"
                : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
            }`}
          >
            Toutes ({rawList.length})
          </button>
          {(["REQUESTED", "PREPARING", "ORDERED", "DELIVERED"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`inline-flex min-h-8 items-center rounded-lg px-2.5 py-1 font-medium transition ${
                statusFilter === s
                  ? "bg-foreground text-background font-semibold"
                  : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
              }`}
            >
              {tw(`parts.statuses.${s}`)}
            </button>
          ))}
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
      ) : filteredList.length === 0 ? (
        <EmptyState title={tw("parts.empty")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {filteredList.map((r) => (
            <li
              key={r.id}
              className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm md:flex-row md:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-base text-foreground">{r.label}</span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-foreground">
                    × {r.quantity}
                  </span>
                  {r.urgency === "HIGH" || r.urgency === "URGENT" ? (
                    <StatusBadge tone="bad">
                      <AlertTriangle className="size-3" aria-hidden />
                      {tw(`priorityLabels.${r.urgency}`)}
                    </StatusBadge>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Link
                    href={`/ordres/${r.repairOrder.id}`}
                    className="font-medium text-foreground hover:underline inline-flex items-center gap-1"
                  >
                    {r.repairOrder.number}
                    <ExternalLink className="size-3" aria-hidden />
                  </Link>
                  <PlateBadge plate={r.repairOrder.plate} />
                  <span>·</span>
                  <span>{tw("parts.requestedBy", { name: r.requestedBy })}</span>
                  <span>·</span>
                  <span>{formatDateTime(r.createdAt)}</span>
                </div>

                {r.rejectReason ? (
                  <span className="text-xs font-medium text-status-bad">
                    Motif : {r.rejectReason}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={TONE[r.status]} label={tw(`parts.statuses.${r.status}`)} />

                {r.status === "REQUESTED" ? (
                  <>
                    <Button onClick={() => update.mutate({ id: r.id, status: "PREPARING" })}>
                      <PackageOpen className="size-4" aria-hidden />
                      {tw("parts.prepare")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => update.mutate({ id: r.id, status: "ORDERED" })}
                    >
                      <ShoppingCart className="size-4" aria-hidden />
                      {tw("parts.ordered")}
                    </Button>
                  </>
                ) : null}
                {r.status === "PREPARING" || r.status === "ORDERED" ? (
                  <Button onClick={() => update.mutate({ id: r.id, status: "DELIVERED" })}>
                    <PackageCheck className="size-4" aria-hidden />
                    {tw("parts.deliver")}
                  </Button>
                ) : null}
                {r.status === "REQUESTED" || r.status === "PREPARING" ? (
                  <Button variant="secondary" onClick={() => setRejecting(r.id)}>
                    <X className="size-4" aria-hidden />
                    {tw("parts.reject")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!rejecting}
        title={tw("parts.reject")}
        onClose={() => setRejecting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              {tw("cancel")}
            </Button>
            <Button
              disabled={!reason.trim()}
              onClick={() =>
                rejecting && update.mutate({ id: rejecting, status: "REJECTED", reason })
              }
            >
              {tw("confirm")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <Field label={tw("parts.rejectReason")}>
            <input
              type="text"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
              value={reason}
              placeholder="ex. Référence non disponible, pièce déjà fournie…"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
