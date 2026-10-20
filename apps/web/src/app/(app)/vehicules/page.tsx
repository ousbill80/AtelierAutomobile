"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  Car,
  ChevronRight,
  Gauge,
  Plus,
  Search,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { DueBadge, PlateBadge } from "@atelieros/ui";
import { LinkButton } from "@/components/link-button";
import { trpc } from "@/trpc/react";

type FilterTab = "ALL" | "IN_WORKSHOP" | "INSPECTION_DUE" | "SERVICE_DUE" | "HAS_BALANCE";

function formatAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function VehiclesPage() {
  const [q, setQ] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("ALL");

  const { data, isLoading, isError, refetch } = trpc.vehicle.list.useQuery({
    q: q.trim() || undefined,
    limit: 100,
  });

  const rawItems = data?.items ?? [];

  // Filtrage combiné en mémoire pour réactivité instantanée
  const filteredItems = useMemo(() => {
    return rawItems.filter((v) => {
      if (filterTab === "IN_WORKSHOP" && (v.stats?.activeRoCount ?? 0) <= 0) return false;
      if (
        filterTab === "INSPECTION_DUE" &&
        v.status.inspection !== "EXPIRED" &&
        v.status.inspection !== "DUE_SOON"
      ) {
        return false;
      }
      if (
        filterTab === "SERVICE_DUE" &&
        v.status.service !== "OVERDUE" &&
        v.status.service !== "DUE_SOON"
      ) {
        return false;
      }
      if (filterTab === "HAS_BALANCE" && (v.stats?.dueBalance ?? 0) <= 0) return false;
      return true;
    });
  }, [rawItems, filterTab]);

  // Agrégats globaux
  const totals = useMemo(() => {
    let inWorkshop = 0;
    let inspectionDue = 0;
    let serviceDue = 0;
    let totalDue = 0;

    rawItems.forEach((v) => {
      if ((v.stats?.activeRoCount ?? 0) > 0) inWorkshop++;
      if (v.status.inspection === "EXPIRED" || v.status.inspection === "DUE_SOON") inspectionDue++;
      if (v.status.service === "OVERDUE" || v.status.service === "DUE_SOON") serviceDue++;
      totalDue += v.stats?.dueBalance ?? 0;
    });

    return {
      totalVehicles: rawItems.length,
      inWorkshop,
      inspectionDue,
      serviceDue,
      totalDue,
    };
  }, [rawItems]);

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* En-tête de la page */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Car size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Véhicules</h1>
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">
                {rawItems.length}
              </span>
            </div>
            <p className="text-xs text-muted">
              Suivi du parc automobile, contrôles techniques, révisions et historique d&apos;atelier
            </p>
          </div>
        </div>

        <LinkButton href="/vehicules/nouveau" variant="primary">
          <Plus size={16} className="mr-1 inline" />
          Ajouter un véhicule
        </LinkButton>
      </div>

      {/* Cartes KPI intelligentes */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Parc de véhicules</span>
            <Car size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">{totals.totalVehicles}</div>
          <div className="mt-1 text-[11px] text-muted">Véhicules suivis dans l&apos;atelier</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">En atelier (maintenance)</span>
            <Wrench size={16} className="text-status-warn" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-status-warn">
              {totals.inWorkshop}
            </span>
            <span className="text-xs text-muted">en cours</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {totals.inWorkshop > 0 ? "Ordres de réparation actifs" : "Aucun véhicule en atelier"}
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Visites techniques (VT)</span>
            <AlertTriangle
              size={16}
              className={totals.inspectionDue > 0 ? "text-status-bad" : "text-muted"}
            />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold tracking-tight ${
                totals.inspectionDue > 0 ? "text-status-bad" : ""
              }`}
            >
              {totals.inspectionDue}
            </span>
            <span className="text-xs text-muted">à renouveler</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {totals.inspectionDue > 0 ? "Expirées ou dans les 30 jours" : "Toutes les dates à jour"}
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Révisions à prévoir</span>
            <CalendarClock
              size={16}
              className={totals.serviceDue > 0 ? "text-status-warn" : "text-muted"}
            />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold tracking-tight ${
                totals.serviceDue > 0 ? "text-status-warn" : ""
              }`}
            >
              {totals.serviceDue}
            </span>
            <span className="text-xs text-muted">dues</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">Basé sur le km estimé et l&apos;intervalle</div>
        </div>
      </div>

      {/* Barre de recherche et filtres */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-surface/80 p-3 shadow-xs">
        <div className="relative w-full">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            placeholder="Rechercher par plaque, marque, modèle, VIN, n° de parc..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-9 text-sm text-foreground outline-none transition-all focus:border-accent"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              title="Effacer la recherche"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2.5 text-xs">
          <button
            type="button"
            onClick={() => setFilterTab("ALL")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-medium transition-all ${
              filterTab === "ALL"
                ? "bg-accent text-accent-fg font-semibold shadow-xs"
                : "bg-surface-2/60 text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <span>Tous les véhicules</span>
            <span className="opacity-75">({rawItems.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab("IN_WORKSHOP")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-medium transition-all ${
              filterTab === "IN_WORKSHOP"
                ? "bg-accent text-accent-fg font-semibold shadow-xs"
                : "bg-surface-2/60 text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Wrench size={13} />
            <span>En atelier (intervention)</span>
            <span className="opacity-75">({totals.inWorkshop})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab("INSPECTION_DUE")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-medium transition-all ${
              filterTab === "INSPECTION_DUE"
                ? "bg-accent text-accent-fg font-semibold shadow-xs"
                : "bg-surface-2/60 text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <AlertTriangle size={13} />
            <span>VT à renouveler</span>
            <span className="opacity-75">({totals.inspectionDue})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab("SERVICE_DUE")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-medium transition-all ${
              filterTab === "SERVICE_DUE"
                ? "bg-accent text-accent-fg font-semibold shadow-xs"
                : "bg-surface-2/60 text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <CalendarClock size={13} />
            <span>Révision due</span>
            <span className="opacity-75">({totals.serviceDue})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab("HAS_BALANCE")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-medium transition-all ${
              filterTab === "HAS_BALANCE"
                ? "bg-accent text-accent-fg font-semibold shadow-xs"
                : "bg-surface-2/60 text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Wallet size={13} />
            <span>Avec encours</span>
          </button>
        </div>
      </div>

      {/* Chargement */}
      {isLoading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-border bg-surface-2/50"
            />
          ))}
        </div>
      )}

      {/* Erreur */}
      {isError && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-status-bad/30 bg-status-bad-bg p-8 text-center">
          <AlertCircle size={28} className="text-status-bad" />
          <p className="text-sm font-semibold text-status-bad">
            Impossible de charger les véhicules.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg bg-surface px-4 py-2 text-xs font-semibold text-foreground border border-border shadow-xs hover:bg-surface-2"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Aucun résultat */}
      {!isLoading && !isError && filteredItems.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface/50 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <Car size={24} />
          </div>
          <div className="max-w-sm">
            <h3 className="text-base font-semibold">Aucun véhicule trouvé</h3>
            <p className="mt-1 text-xs text-muted">
              {q || filterTab !== "ALL"
                ? "Aucun véhicule ne correspond aux filtres appliqués."
                : "Enregistrez les véhicules de vos clients pour suivre leur historique et relancer les visites techniques."}
            </p>
          </div>
          {q || filterTab !== "ALL" ? (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setFilterTab("ALL");
              }}
              className="mt-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
            >
              Réinitialiser les filtres
            </button>
          ) : (
            <LinkButton href="/vehicules/nouveau" variant="primary">
              Ajouter un véhicule
            </LinkButton>
          )}
        </div>
      )}

      {/* Tableau complet enrichi */}
      {!isLoading && !isError && filteredItems.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-3.5 pl-4 pr-3">Véhicule</th>
                  <th className="px-3 py-3.5">Propriétaire</th>
                  <th className="px-3 py-3.5">Km estimé</th>
                  <th className="px-3 py-3.5">Visite Technique (VT)</th>
                  <th className="px-3 py-3.5">Révision prévue</th>
                  <th className="px-3 py-3.5 text-center">Réparations</th>
                  <th className="px-3 py-3.5">Dernier passage</th>
                  <th className="px-3 py-3.5 text-right">Facturation & Solde</th>
                  <th className="py-3.5 pl-3 pr-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredItems.map((v) => {
                  const repairCount = v.stats?.repairCount ?? 0;
                  const activeRoCount = v.stats?.activeRoCount ?? 0;
                  const lastRepairDate = v.stats?.lastRepairDate;
                  const lastRepairNumber = v.stats?.lastRepairNumber;
                  const invoicesTotal = v.stats?.invoicesTotal ?? 0;
                  const dueBalance = v.stats?.dueBalance ?? 0;
                  const overdueBalance = v.stats?.overdueBalance ?? 0;
                  const estimatedMileage = v.status.estimatedMileage ?? v.currentMileage;

                  return (
                    <tr
                      key={v.id}
                      className="group transition-colors hover:bg-surface-2/40"
                    >
                      {/* Véhicule */}
                      <td className="py-3.5 pl-4 pr-3">
                        <div className="flex items-center gap-3">
                          <Link href={`/vehicules/${v.id}`} className="shrink-0">
                            <PlateBadge plate={v.plate} plateType={v.plateType} />
                          </Link>
                          <div className="min-w-0">
                            <Link
                              href={`/vehicules/${v.id}`}
                              className="font-semibold text-foreground group-hover:text-accent group-hover:underline"
                            >
                              {v.make} {v.model}
                            </Link>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                              {v.year && <span>{v.year}</span>}
                              {v.year && v.fuel && <span>•</span>}
                              {v.fuel && <span className="capitalize">{v.fuel.toLowerCase()}</span>}
                              {v.fleetNumber && (
                                <span className="rounded bg-surface-2 px-1 text-[10px] font-medium text-foreground">
                                  Parc #{v.fleetNumber}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Propriétaire */}
                      <td className="px-3 py-3.5">
                        {v.customer ? (
                          <div className="flex flex-col gap-0.5">
                            <Link
                              href={`/clients/${v.customer.id}`}
                              className="font-medium text-foreground hover:text-accent hover:underline"
                            >
                              {v.customer.displayName}
                            </Link>
                            <span className="text-[11px] text-muted">
                              {v.customer.type === "COMPANY" ? "Entreprise" : "Particulier"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>

                      {/* Km estimé */}
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <Gauge size={13} className="text-muted" />
                          <span className="font-semibold tabular-nums text-foreground">
                            {estimatedMileage != null
                              ? `${estimatedMileage.toLocaleString("fr-FR")} km`
                              : "—"}
                          </span>
                        </div>
                      </td>

                      {/* Visite Technique (VT) */}
                      <td className="px-3 py-3.5">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold tabular-nums">
                              {formatDate(v.inspectionExpiryDate)}
                            </span>
                            <DueBadge status={v.status.inspection} />
                          </div>
                          {v.status.inspection === "EXPIRED" && (
                            <span className="text-[10px] font-bold text-status-bad">
                              Expirée !
                            </span>
                          )}
                          {v.status.inspection === "DUE_SOON" && (
                            <span className="text-[10px] font-medium text-status-warn">
                              Expire bientôt
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Révision prévue */}
                      <td className="px-3 py-3.5">
                        <div className="flex flex-col gap-0.5 text-xs">
                          {v.nextServiceDueDate || v.nextServiceDueMileage ? (
                            <>
                              <span className="font-medium text-foreground">
                                {formatDate(v.nextServiceDueDate)}
                              </span>
                              {v.nextServiceDueMileage && (
                                <span className="text-[11px] text-muted">
                                  ≈ {v.nextServiceDueMileage.toLocaleString("fr-FR")} km
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </div>
                      </td>

                      {/* Réparations (OR) */}
                      <td className="px-3 py-3.5 text-center">
                        <div className="flex flex-col items-center gap-1">
                          {activeRoCount > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-status-warn-bg px-2 py-0.5 text-xs font-bold text-status-warn">
                              <Wrench size={11} className="animate-pulse" />
                              <span>En atelier</span>
                            </span>
                          ) : null}
                          <span className="text-xs text-muted">
                            {repairCount} OR {repairCount > 1 ? "enregistrés" : "enregistré"}
                          </span>
                        </div>
                      </td>

                      {/* Dernier passage */}
                      <td className="px-3 py-3.5">
                        {lastRepairDate ? (
                          <div className="flex flex-col gap-0.5 text-xs">
                            <span className="font-medium text-foreground">
                              {formatDate(lastRepairDate)}
                            </span>
                            {lastRepairNumber && (
                              <span className="text-[11px] text-muted">{lastRepairNumber}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted">Jamais venu</span>
                        )}
                      </td>

                      {/* Facturation & Solde */}
                      <td className="px-3 py-3.5 text-right">
                        <div className="flex flex-col items-end gap-0.5 text-xs">
                          <span className="text-muted">
                            Facturé : {formatAmount(invoicesTotal)}
                          </span>
                          {dueBalance > 0 ? (
                            <div className="flex flex-col items-end">
                              <span className="font-bold text-status-bad">
                                Dû : {formatAmount(dueBalance)}
                              </span>
                              {overdueBalance > 0 && (
                                <span className="text-[10px] font-semibold text-status-bad">
                                  dont {formatAmount(overdueBalance)} en retard
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="font-medium text-status-ok">Solde réglé</span>
                          )}
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-3.5 pl-3 pr-4 text-right">
                        <Link
                          href={`/vehicules/${v.id}`}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-all hover:bg-surface-2 hover:border-accent"
                        >
                          <span>Voir</span>
                          <ChevronRight size={13} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
