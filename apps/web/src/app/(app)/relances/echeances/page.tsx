"use client";

// PRD M10 §7.2 — échéances. Simplification documentée : vue liste uniquement, pas de calendrier
// mensuel (points colorés par jour) — pas essentiel pour valider le moteur de relances.
import { useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, DueBadge, EmptyState, PlateBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { DUE_DATES_FILTER_LABELS, computeDueStatus, formatDate } from "../reminder-labels";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type VehicleDue = RouterOutputs["reminders"]["dueDates"]["items"][number];
type Kind = "INSPECTION" | "SERVICE" | "INSURANCE";
type Filter = "ALL" | "UPCOMING" | "EXPIRED" | "MISSING_DATA";

const KIND_TABS: { value: Kind; label: string }[] = [
  { value: "INSPECTION", label: "Visite technique" },
  { value: "SERVICE", label: "Révision" },
  { value: "INSURANCE", label: "Assurance" },
];

export default function EcheancesPage() {
  const [kind, setKind] = useState<Kind>("INSPECTION");
  const [filter, setFilter] = useState<Filter>("ALL");

  const utils = trpc.useUtils();
  // `useInfiniteQuery` (plutôt qu'un état local accumulé manuellement) : chaque changement
  // d'onglet/filtre change la clé de requête et repart donc naturellement d'une seule page.
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.reminders.dueDates.useInfiniteQuery(
      { kind, filter, limit: 30 },
      { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
    );
  const items = data?.pages.flatMap((page) => page.items) ?? [];

  function changeKind(next: Kind) {
    setKind(next);
    setFilter("ALL");
  }

  function changeFilter(next: Filter) {
    setFilter(next);
  }

  function refresh() {
    utils.reminders.dueDates.invalidate();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Échéances</h1>

      <div className="flex flex-wrap gap-2 text-sm">
        {KIND_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => changeKind(t.value)}
            className={`min-h-11 rounded-md px-3 ${kind === t.value ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <select
        className="min-h-11 w-fit rounded-md border border-border bg-surface px-2 text-sm"
        value={filter}
        onChange={(e) => changeFilter(e.target.value as Filter)}
      >
        {Object.entries(DUE_DATES_FILTER_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-border bg-surface-2"
            />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">Impossible de charger les échéances.</p>
          <Button variant="secondary" onClick={() => refetch()}>
            Réessayer
          </Button>
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState title="Aucune échéance dans ce filtre." />
      )}

      <div className="flex flex-col gap-3">
        {items.map((vehicle) => (
          <VehicleDueRow key={vehicle.id} vehicle={vehicle} kind={kind} onChanged={refresh} />
        ))}
      </div>

      {hasNextPage && (
        <Button variant="secondary" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          Charger plus
        </Button>
      )}
    </div>
  );
}

function VehicleDueRow({
  vehicle,
  kind,
  onChanged,
}: {
  vehicle: VehicleDue;
  kind: Kind;
  onChanged: () => void;
}) {
  const [takingAppointment, setTakingAppointment] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState("");
  const [doingInspection, setDoingInspection] = useState(false);
  const [expiryDate, setExpiryDate] = useState("");
  const [lastDate, setLastDate] = useState("");
  const [center, setCenter] = useState("");

  const markAppointmentTaken = trpc.reminders.markAppointmentTaken.useMutation({
    onSuccess: () => {
      setTakingAppointment(false);
      onChanged();
    },
  });
  const markInspectionDone = trpc.reminders.markInspectionDone.useMutation({
    onSuccess: () => {
      setDoingInspection(false);
      onChanged();
    },
  });

  const relevantDate =
    kind === "INSPECTION"
      ? vehicle.inspectionExpiryDate
      : kind === "SERVICE"
        ? vehicle.nextServiceDueDate
        : vehicle.insuranceExpiryDate;
  const due = computeDueStatus(relevantDate);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <PlateBadge plate={vehicle.plate} plateType={vehicle.plateType} />
          <div>
            <p className="font-medium">
              {vehicle.make} {vehicle.model}
            </p>
            <Link
              href={`/clients/${vehicle.customerId}`}
              className="text-sm text-accent hover:underline"
            >
              {vehicle.customer.displayName}
            </Link>
          </div>
        </div>
        <div className="text-right">
          <DueBadge status={due.status} daysRemaining={due.daysRemaining} />
          <p className="mt-1 text-sm text-muted">
            {kind === "INSPECTION" && `Expire le ${formatDate(relevantDate)}`}
            {kind === "SERVICE" &&
              `Due le ${formatDate(relevantDate)}${vehicle.nextServiceDueMileage ? ` (≈ ${vehicle.nextServiceDueMileage} km)` : ""}`}
            {kind === "INSURANCE" && `Expire le ${formatDate(relevantDate)}`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => setTakingAppointment((v) => !v)}>
          RDV pris
        </Button>
        {kind === "INSPECTION" && (
          <Button variant="ghost" onClick={() => setDoingInspection((v) => !v)}>
            VT effectuée
          </Button>
        )}
      </div>

      {takingAppointment && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            markAppointmentTaken.mutate({
              vehicleId: vehicle.id,
              date: appointmentDate ? new Date(appointmentDate) : undefined,
              createAppointment: false,
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Date du RDV (facultatif)
            <input
              type="date"
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={appointmentDate}
              onChange={(e) => setAppointmentDate(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={markAppointmentTaken.isPending}>
            Confirmer
          </Button>
          <Button type="button" variant="ghost" onClick={() => setTakingAppointment(false)}>
            Annuler
          </Button>
          {markAppointmentTaken.error && (
            <p className="text-xs text-status-bad">{markAppointmentTaken.error.message}</p>
          )}
        </form>
      )}

      {doingInspection && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!expiryDate) return;
            markInspectionDone.mutate({
              vehicleId: vehicle.id,
              expiryDate: new Date(expiryDate),
              lastDate: lastDate ? new Date(lastDate) : undefined,
              center: center.trim() || undefined,
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Nouvelle expiration
            <input
              type="date"
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            VT effectuée le (facultatif)
            <input
              type="date"
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={lastDate}
              onChange={(e) => setLastDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Centre (facultatif)
            <input
              type="text"
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={center}
              onChange={(e) => setCenter(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={markInspectionDone.isPending}>
            Confirmer
          </Button>
          <Button type="button" variant="ghost" onClick={() => setDoingInspection(false)}>
            Annuler
          </Button>
          {markInspectionDone.error && (
            <p className="text-xs text-status-bad">{markInspectionDone.error.message}</p>
          )}
        </form>
      )}
    </div>
  );
}
