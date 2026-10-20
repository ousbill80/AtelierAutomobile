"use client";

// PRD M10 §7.2 — Échéances et relances préventives :
// Vue proactive des visites techniques, révisions kilométriques et assurances avec alertes
// d'imminence (DueBadge), prise de rendez-vous en un clic et enregistrement rapide des contrôles.
import { useState } from "react";
import Link from "next/link";
import {
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, DueBadge, EmptyState, PlateBadge } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { DUE_DATES_FILTER_LABELS, computeDueStatus, formatDate } from "../reminder-labels";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type VehicleDue = RouterOutputs["reminders"]["dueDates"]["items"][number];
type Kind = "INSPECTION" | "SERVICE" | "INSURANCE";
type Filter = "ALL" | "UPCOMING" | "EXPIRED" | "MISSING_DATA";

const KIND_TABS: { value: Kind; label: string; icon: typeof CalendarCheck }[] = [
  { value: "INSPECTION", label: "Visite technique", icon: CalendarCheck },
  { value: "SERVICE", label: "Vidange & Révision", icon: Wrench },
  { value: "INSURANCE", label: "Assurance", icon: ShieldCheck },
];

export default function EcheancesPage() {
  const [kind, setKind] = useState<Kind>("INSPECTION");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.reminders.dueDates.useInfiniteQuery(
      { kind, filter, limit: 30 },
      { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
    );
  const items = data?.pages.flatMap((page) => page.items) ?? [];

  const filteredItems = items.filter((vehicle) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      vehicle.plate.toLowerCase().includes(q) ||
      vehicle.make.toLowerCase().includes(q) ||
      vehicle.model.toLowerCase().includes(q) ||
      vehicle.customer.displayName.toLowerCase().includes(q) ||
      (vehicle.customer.phone ? vehicle.customer.phone.toLowerCase().includes(q) : false)
    );
  });

  function changeKind(next: Kind) {
    setKind(next);
    setFilter("ALL");
  }

  function changeFilter(next: Filter) {
    setFilter(next);
  }

  function refresh() {
    void utils.reminders.dueDates.invalidate();
  }

  return (
    <div className="flex flex-col gap-6 pb-20">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Calendar size={22} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("remindersModule.dueDates.title")}
            </h1>
            <p className="text-xs text-muted">
              {t("remindersModule.dueDates.subtitle")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/relances"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground shadow-xs hover:border-accent hover:bg-surface-2"
          >
            <span>Retour file de relances</span>
          </Link>
        </div>
      </div>

      {/* Onglets par Type d'échéance */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {KIND_TABS.map((tab) => {
            const Icon = tab.icon;
            const isCurrent = kind === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => changeKind(tab.value)}
                className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-semibold transition-all ${
                  isCurrent
                    ? "bg-accent text-accent-fg shadow-sm ring-1 ring-accent"
                    : "bg-surface text-muted hover:border-border hover:bg-surface-2 hover:text-foreground border border-border/70"
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtre d'imminence */}
          <select
            className="h-10 rounded-xl border border-border/80 bg-surface px-3 text-xs text-foreground focus:border-accent focus:outline-none"
            value={filter}
            onChange={(e) => changeFilter(e.target.value as Filter)}
          >
            {Object.entries(DUE_DATES_FILTER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Barre de recherche intelligente instantanée */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Rechercher une immatriculation, un modèle, un nom ou n° de téléphone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-xl border border-border/80 bg-surface pl-9 pr-4 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* États de chargement et erreurs */}
      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-xl border border-border bg-surface-2/60"
            />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-status-bad bg-status-bad-bg p-4 shadow-xs">
          <p className="text-xs font-semibold text-status-bad">
            Impossible de charger les échéances.
          </p>
          <Button variant="secondary" onClick={() => refetch()} className="h-8 text-xs">
            <RefreshCw size={12} className="mr-1" />
            Réessayer
          </Button>
        </div>
      )}

      {/* Liste vide */}
      {!isLoading && !isError && filteredItems.length === 0 && (
        <EmptyState
          title={t("remindersModule.dueDates.empty")}
          description="Aucun véhicule ne correspond aux critères de filtre sélectionnés."
          action={
            filter !== "ALL" || search ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setFilter("ALL");
                  setSearch("");
                }}
              >
                Réinitialiser les filtres
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Grille des véhicules à échéance */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredItems.map((vehicle) => (
          <VehicleDueCard key={vehicle.id} vehicle={vehicle} kind={kind} onChanged={refresh} />
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            variant="secondary"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="h-9 text-xs"
          >
            {isFetchingNextPage ? "Chargement…" : "Charger plus d'échéances"}
          </Button>
        </div>
      )}
    </div>
  );
}

function VehicleDueCard({
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
    <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-4 shadow-xs transition-all hover:border-accent/40">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <PlateBadge plate={vehicle.plate} plateType={vehicle.plateType} />
          <DueBadge status={due.status} daysRemaining={due.daysRemaining} />
        </div>

        <div>
          <h3 className="font-bold text-foreground">
            {vehicle.make} {vehicle.model}
          </h3>
          <div className="mt-1 flex items-center justify-between text-xs">
            <Link
              href={`/clients/${vehicle.customerId}`}
              className="font-medium text-accent hover:underline"
            >
              {vehicle.customer.displayName}
            </Link>
            {vehicle.customer.phone && (
              <a
                href={`tel:${vehicle.customer.phone}`}
                className="font-mono text-muted hover:text-foreground"
              >
                {vehicle.customer.phone}
              </a>
            )}
          </div>
        </div>

        <div className="rounded-lg bg-surface-2/60 p-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted">Échéance calculée :</span>
            <span className="font-semibold text-foreground">
              {formatDate(relevantDate)}
            </span>
          </div>
          {kind === "SERVICE" && vehicle.nextServiceDueMileage && (
            <div className="mt-1 flex items-center justify-between text-muted">
              <span>Kilométrage prévu :</span>
              <span className="font-mono font-medium">{vehicle.nextServiceDueMileage.toLocaleString("fr-FR")} km</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="secondary"
            className="h-8 flex-1 gap-1 text-xs"
            onClick={() => setTakingAppointment((v) => !v)}
          >
            <Calendar size={12} />
            <span>{t("remindersModule.dueDates.actions.markAppointment")}</span>
          </Button>

          {kind === "INSPECTION" && (
            <Button
              variant="secondary"
              className="h-8 flex-1 gap-1 text-xs"
              onClick={() => setDoingInspection((v) => !v)}
            >
              <CheckCircle2 size={12} />
              <span>{t("remindersModule.dueDates.actions.markInspectionDone")}</span>
            </Button>
          )}

          {vehicle.customer.phone && (
            <a
              href={`tel:${vehicle.customer.phone}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-all hover:border-accent hover:text-foreground"
              title="Appeler le client"
            >
              <Phone size={13} />
            </a>
          )}
        </div>

        {takingAppointment && (
          <form
            className="mt-2 flex flex-col gap-2 rounded-lg border border-accent/30 bg-surface-2/40 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              markAppointmentTaken.mutate({
                vehicleId: vehicle.id,
                date: appointmentDate ? new Date(appointmentDate) : undefined,
                createAppointment: false,
              });
            }}
          >
            <label className="text-xs font-medium text-foreground">
              Date du rendez-vous fixé
              <input
                type="date"
                className="mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
              />
            </label>
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <Button
                type="button"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setTakingAppointment(false)}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="h-7 text-xs"
                disabled={markAppointmentTaken.isPending}
              >
                Enregistrer RDV
              </Button>
            </div>
            {markAppointmentTaken.error && (
              <p className="text-[11px] text-status-bad">{markAppointmentTaken.error.message}</p>
            )}
          </form>
        )}

        {doingInspection && (
          <form
            className="mt-2 flex flex-col gap-2 rounded-lg border border-status-ok/30 bg-surface-2/40 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!expiryDate) return;
              markInspectionDone.mutate({
                vehicleId: vehicle.id,
                expiryDate: new Date(expiryDate),
                center: center.trim() || undefined,
              });
            }}
          >
            <label className="text-xs font-medium text-foreground">
              Nouvelle date d&apos;expiration VT *
              <input
                type="date"
                className="mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                required
              />
            </label>
            <label className="text-xs font-medium text-foreground">
              Centre de contrôle
              <input
                type="text"
                placeholder="Ex. SICTA Vridi, Yopougon..."
                className="mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
                value={center}
                onChange={(e) => setCenter(e.target.value)}
              />
            </label>
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <Button
                type="button"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setDoingInspection(false)}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="h-7 text-xs"
                disabled={markInspectionDone.isPending}
              >
                Valider la VT
              </Button>
            </div>
            {markInspectionDone.error && (
              <p className="text-[11px] text-status-bad">{markInspectionDone.error.message}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
