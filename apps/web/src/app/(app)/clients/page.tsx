"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Building2,
  Car,
  CheckCircle2,
  ChevronRight,
  MapPin,
  Phone,
  Plus,
  Search,
  User,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { PlateBadge, TypeBadge } from "@atelieros/ui";
import { LinkButton } from "@/components/link-button";
import { trpc } from "@/trpc/react";

type FilterTab = "ALL" | "INDIVIDUAL" | "COMPANY" | "IN_MAINTENANCE" | "HAS_BALANCE";

function formatAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
}

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const clean = phone.replace(/\s+/g, "");
  if (clean.startsWith("+225") && clean.length === 14) {
    return `+225 ${clean.slice(4, 6)} ${clean.slice(6, 8)} ${clean.slice(8, 10)} ${clean.slice(10, 12)} ${clean.slice(12)}`;
  }
  return phone;
}

export default function ClientsPage() {
  const [q, setQ] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("ALL");
  const [communeFilter, setCommuneFilter] = useState<string>("ALL");

  const { data, isLoading, isError, refetch } = trpc.customer.list.useQuery({
    q: q.trim() || undefined,
    limit: 100,
  });

  const rawItems = data?.items ?? [];

  // Extraction des communes uniques présentes
  const communes = useMemo(() => {
    const set = new Set<string>();
    rawItems.forEach((c) => {
      if (c.commune?.trim()) set.add(c.commune.trim());
    });
    return Array.from(set).sort();
  }, [rawItems]);

  // Filtrage combiné en mémoire pour réactivité instantanée
  const filteredItems = useMemo(() => {
    return rawItems.filter((c) => {
      if (filterTab === "INDIVIDUAL" && c.type !== "INDIVIDUAL") return false;
      if (filterTab === "COMPANY" && c.type !== "COMPANY") return false;
      if (filterTab === "IN_MAINTENANCE" && (c.stats?.activeRoCount ?? 0) <= 0) return false;
      if (filterTab === "HAS_BALANCE" && (c.stats?.dueBalance ?? 0) <= 0) return false;
      if (communeFilter !== "ALL" && c.commune !== communeFilter) return false;
      return true;
    });
  }, [rawItems, filterTab, communeFilter]);

  // Agrégats calculés sur le portefeuille
  const totals = useMemo(() => {
    let individuals = 0;
    let companies = 0;
    let totalVehicles = 0;
    let activeRos = 0;
    let totalDue = 0;
    let totalOverdue = 0;

    rawItems.forEach((c) => {
      if (c.type === "INDIVIDUAL") individuals++;
      if (c.type === "COMPANY") companies++;
      totalVehicles += c.stats?.vehicleCount ?? 0;
      activeRos += c.stats?.activeRoCount ?? 0;
      totalDue += c.stats?.dueBalance ?? 0;
      totalOverdue += c.stats?.overdueBalance ?? 0;
    });

    return {
      totalClients: rawItems.length,
      individuals,
      companies,
      totalVehicles,
      activeRos,
      totalDue,
      totalOverdue,
    };
  }, [rawItems]);

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* En-tête de la page */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Users size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Clients</h1>
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">
                {rawItems.length}
              </span>
            </div>
            <p className="text-xs text-muted">
              Fichier centralisé des clients particuliers et flottes d&apos;entreprises
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/clients/doublons"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
          >
            <span>Doublons</span>
          </Link>
          <LinkButton href="/clients/nouveau" variant="primary">
            <Plus size={16} className="mr-1 inline" />
            Nouveau client
          </LinkButton>
        </div>
      </div>

      {/* Cartes KPI du portefeuille client */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Total clients</span>
            <Users size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">{totals.totalClients}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
            <span>{totals.individuals} particuliers</span>
            <span>•</span>
            <span>{totals.companies} entreprises</span>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Portefeuille véhicules</span>
            <Car size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-accent">
            {totals.totalVehicles}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {(totals.totalVehicles / Math.max(1, totals.totalClients)).toFixed(1)} véhicule(s) par client
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">En atelier (maintenance)</span>
            <Wrench size={16} className="text-status-warn" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-status-warn">
              {totals.activeRos}
            </span>
            <span className="text-xs text-muted">OR en cours</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {totals.activeRos > 0 ? "Véhicules en cours d'intervention" : "Aucun véhicule en atelier"}
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Encours total</span>
            <Wallet size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">
            {formatAmount(totals.totalDue)}
          </div>
          <div className="mt-1 text-[11px]">
            {totals.totalOverdue > 0 ? (
              <span className="font-semibold text-status-bad">
                dont {formatAmount(totals.totalOverdue)} en retard
              </span>
            ) : (
              <span className="text-status-ok font-medium">À jour des règlements</span>
            )}
          </div>
        </div>
      </div>

      {/* Barre de recherche et filtres intelligents */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-surface/80 p-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Recherche */}
          <div className="relative min-w-[260px] flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              placeholder="Rechercher par nom, téléphone, email..."
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

          {/* Sélecteur de commune */}
          {communes.length > 0 && (
            <div className="flex items-center gap-1.5">
              <MapPin size={14} className="text-muted" />
              <select
                value={communeFilter}
                onChange={(e) => setCommuneFilter(e.target.value)}
                className="h-10 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground outline-none"
              >
                <option value="ALL">Toutes les communes ({communes.length})</option>
                {communes.map((comm) => (
                  <option key={comm} value={comm}>
                    {comm}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Boutons d'onglets de filtrage */}
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
            <span>Tous</span>
            <span className="opacity-75">({rawItems.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab("INDIVIDUAL")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-medium transition-all ${
              filterTab === "INDIVIDUAL"
                ? "bg-accent text-accent-fg font-semibold shadow-xs"
                : "bg-surface-2/60 text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <User size={13} />
            <span>Particuliers</span>
            <span className="opacity-75">({totals.individuals})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab("COMPANY")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-medium transition-all ${
              filterTab === "COMPANY"
                ? "bg-accent text-accent-fg font-semibold shadow-xs"
                : "bg-surface-2/60 text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Building2 size={13} />
            <span>Entreprises / Flottes</span>
            <span className="opacity-75">({totals.companies})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab("IN_MAINTENANCE")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-medium transition-all ${
              filterTab === "IN_MAINTENANCE"
                ? "bg-accent text-accent-fg font-semibold shadow-xs"
                : "bg-surface-2/60 text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Wrench size={13} />
            <span>En maintenance active</span>
            <span className="opacity-75">({totals.activeRos})</span>
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
            <span>Avec encours / impayés</span>
          </button>
        </div>
      </div>

      {/* État de chargement */}
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

      {/* État d'erreur */}
      {isError && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-status-bad/30 bg-status-bad-bg p-8 text-center">
          <AlertCircle size={28} className="text-status-bad" />
          <p className="text-sm font-semibold text-status-bad">Impossible de charger les clients.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg bg-surface px-4 py-2 text-xs font-semibold text-foreground border border-border shadow-xs hover:bg-surface-2"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* État vide */}
      {!isLoading && !isError && filteredItems.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface/50 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <Users size={24} />
          </div>
          <div className="max-w-sm">
            <h3 className="text-base font-semibold">Aucun client trouvé</h3>
            <p className="mt-1 text-xs text-muted">
              {q || filterTab !== "ALL" || communeFilter !== "ALL"
                ? "Aucun client ne correspond à vos filtres actuels. Réinitialisez les filtres pour tout afficher."
                : "Commencez par ajouter votre premier client ou importez votre fichier existant."}
            </p>
          </div>
          {q || filterTab !== "ALL" || communeFilter !== "ALL" ? (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setFilterTab("ALL");
                setCommuneFilter("ALL");
              }}
              className="mt-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
            >
              Réinitialiser les filtres
            </button>
          ) : (
            <LinkButton href="/clients/nouveau" variant="primary">
              Ajouter un client
            </LinkButton>
          )}
        </div>
      )}

      {/* Tableau moderne enrichi */}
      {!isLoading && !isError && filteredItems.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-3.5 pl-4 pr-3">Client</th>
                  <th className="px-3 py-3.5">Coordonnées</th>
                  <th className="px-3 py-3.5">Portefeuille Véhicules</th>
                  <th className="px-3 py-3.5 text-center">En maintenance</th>
                  <th className="px-3 py-3.5 text-center">Déjà réparé</th>
                  <th className="px-3 py-3.5 text-right">Encours financier</th>
                  <th className="py-3.5 pl-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredItems.map((c) => {
                  const vehicles = c.vehicles ?? [];
                  const vehicleCount = c.stats?.vehicleCount ?? vehicles.length;
                  const activeRoCount = c.stats?.activeRoCount ?? 0;
                  const repairedRoCount = c.stats?.repairedRoCount ?? 0;
                  const dueBalance = c.stats?.dueBalance ?? 0;
                  const overdueBalance = c.stats?.overdueBalance ?? 0;

                  return (
                    <tr
                      key={c.id}
                      className="group transition-colors hover:bg-surface-2/40"
                    >
                      {/* Client */}
                      <td className="py-3.5 pl-4 pr-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold text-xs ${
                              c.type === "COMPANY"
                                ? "bg-accent/15 text-accent"
                                : "bg-surface-2 text-foreground"
                            }`}
                          >
                            {c.type === "COMPANY" ? (
                              <Building2 size={18} />
                            ) : (
                              c.displayName.slice(0, 2).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <Link
                              href={`/clients/${c.id}`}
                              className="font-semibold text-foreground group-hover:text-accent group-hover:underline"
                            >
                              {c.displayName}
                            </Link>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              <TypeBadge label={c.type === "COMPANY" ? "Entreprise" : "Particulier"} />
                              {c.commune && (
                                <span className="inline-flex items-center gap-0.5 text-[11px] text-muted">
                                  <MapPin size={11} />
                                  <span>{c.commune}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Coordonnées */}
                      <td className="px-3 py-3.5">
                        <div className="flex flex-col gap-0.5 text-xs">
                          {c.phone ? (
                            <a
                              href={`tel:${c.phone}`}
                              className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-accent"
                              title="Appeler"
                            >
                              <Phone size={12} className="text-muted" />
                              <span>{formatPhone(c.phone)}</span>
                            </a>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                          {c.email && (
                            <a
                              href={`mailto:${c.email}`}
                              className="truncate text-[11px] text-muted hover:text-foreground"
                              title={c.email}
                            >
                              {c.email}
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Portefeuille Véhicules */}
                      <td className="px-3 py-3.5">
                        {vehicleCount > 0 ? (
                          <div className="flex flex-col gap-1.5">
                            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                              <Car size={14} className="text-muted" />
                              <span>
                                {vehicleCount} véhicule{vehicleCount > 1 ? "s" : ""}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {vehicles.slice(0, 2).map((v) => (
                                <PlateBadge
                                  key={v.id}
                                  plate={v.plate}
                                  plateType={v.plateType}
                                  className="scale-90 origin-left"
                                />
                              ))}
                              {vehicles.length > 2 && (
                                <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                                  +{vehicles.length - 2}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted">
                            <Car size={13} className="opacity-50" />
                            <span>Aucun véhicule</span>
                          </span>
                        )}
                      </td>

                      {/* En maintenance active */}
                      <td className="px-3 py-3.5 text-center">
                        {activeRoCount > 0 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-status-warn-bg px-2.5 py-1 text-xs font-bold text-status-warn">
                            <Wrench size={13} className="animate-pulse" />
                            <span>{activeRoCount} en atelier</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted">0</span>
                        )}
                      </td>

                      {/* Déjà réparé */}
                      <td className="px-3 py-3.5 text-center">
                        {repairedRoCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
                            <CheckCircle2 size={13} className="text-status-ok" />
                            <span>{repairedRoCount} terminée{repairedRoCount > 1 ? "s" : ""}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted">0</span>
                        )}
                      </td>

                      {/* Encours financier */}
                      <td className="px-3 py-3.5 text-right">
                        {dueBalance > 0 ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="font-bold text-foreground">
                              {formatAmount(dueBalance)}
                            </span>
                            {overdueBalance > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-status-bad">
                                <AlertCircle size={11} />
                                <span>dont {formatAmount(overdueBalance)} en retard</span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted">Échéance non dépassée</span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                            <CheckCircle2 size={11} className="text-status-ok" />
                            <span>0 FCFA</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 pl-3 pr-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/clients/${c.id}`}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-all hover:bg-surface-2 hover:border-accent"
                          >
                            <span>Détails</span>
                            <ChevronRight size={13} />
                          </Link>
                        </div>
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
