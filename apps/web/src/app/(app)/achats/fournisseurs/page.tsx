"use client";

// M07 §7 — /achats/fournisseurs : annuaire enrichi des fournisseurs de pièces & consommables,
// recherche en temps réel, filtres actifs/inactifs, fiches synthétiques et création rapide (téléphones +225).
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Clock,
  MessageCircle,
  Package,
  Plus,
  Search,
  Truck,
  X,
} from "lucide-react";
import { Button, EmptyState, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton, ModuleNav, useCan } from "../../stock/_lib/components";
import { t } from "../../stock/_lib/i18n";
import { SupplierFormModal } from "./supplier-form";

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const clean = phone.replace(/\s+/g, "");
  if (clean.startsWith("+225") && clean.length === 14) {
    return `${clean.slice(0, 4)} ${clean.slice(4, 6)} ${clean.slice(6, 8)} ${clean.slice(8, 10)} ${clean.slice(10, 12)} ${clean.slice(12)}`;
  }
  return phone;
}

export default function SuppliersPage() {
  const router = useRouter();
  const can = useCan();
  const [q, setQ] = useState("");
  const [filterActive, setFilterActive] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [creating, setCreating] = useState(false);

  const list = trpc.supplier.list.useQuery({ q: q.trim() || undefined, includeInactive: true });

  const items = useMemo(() => {
    if (!list.data) return [];
    if (filterActive === "ACTIVE") return list.data.filter((s) => s.isActive);
    if (filterActive === "INACTIVE") return list.data.filter((s) => !s.isActive);
    return list.data;
  }, [list.data, filterActive]);

  const activeCount = useMemo(() => list.data?.filter((s) => s.isActive).length ?? 0, [list.data]);
  const totalProductsCount = useMemo(
    () => list.data?.reduce((acc, s) => acc + s.products, 0) ?? 0,
    [list.data],
  );

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* Navigation Achats / Stock */}
      <ModuleNav section="purchases" />

      {/* En-tête de la page */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Truck size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t("suppliers.title")}
              </h1>
              {list.data && (
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">
                  {list.data.length} fournisseurs
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              Gestion des fournisseurs de pièces détachées, conditions de paiement et catalogues
            </p>
          </div>
        </div>

        {can("supplier:manage") && (
          <Button
            className="h-9 gap-1.5 text-xs font-medium"
            onClick={() => setCreating(true)}
          >
            <Plus size={14} strokeWidth={2.5} />
            <span>{t("suppliers.new")}</span>
          </Button>
        )}
      </div>

      {/* Cartes KPI intelligentes */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Fournisseurs actifs</span>
            <Truck size={16} className="text-status-ok" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {activeCount}
          </div>
          <div className="mt-1 text-[11px] text-muted">Partenaires réguliers</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Références associées</span>
            <Package size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {totalProductsCount}
          </div>
          <div className="mt-1 text-[11px] text-muted">Articles au catalogue</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Délai moyen règlement</span>
            <Clock size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {list.data && list.data.length > 0
              ? `${Math.round(
                  list.data.reduce((acc, s) => acc + s.paymentTermsDays, 0) / list.data.length,
                )} j`
              : "0 j"}
          </div>
          <div className="mt-1 text-[11px] text-muted">Conditions négociées</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Commandes en attente</span>
            <Building2 size={16} className="text-accent" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-accent">
            <Link href="/achats" className="hover:underline">
              Voir les achats
            </Link>
          </div>
          <div className="mt-1 text-[11px] text-muted">Suivi des bons de commande</div>
        </div>
      </div>

      {/* Barre d'outils et recherche */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder={t("common.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 w-full rounded-lg border border-border/80 bg-surface pl-8 pr-8 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-surface-2/40 p-1">
          <button
            type="button"
            onClick={() => setFilterActive("ALL")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              filterActive === "ALL"
                ? "bg-accent text-accent-fg shadow-xs"
                : "text-muted hover:text-foreground"
            }`}
          >
            Tous ({list.data?.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setFilterActive("ACTIVE")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              filterActive === "ACTIVE"
                ? "bg-accent text-accent-fg shadow-xs"
                : "text-muted hover:text-foreground"
            }`}
          >
            Actifs ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterActive("INACTIVE")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              filterActive === "INACTIVE"
                ? "bg-accent text-accent-fg shadow-xs"
                : "text-muted hover:text-foreground"
            }`}
          >
            Inactifs ({(list.data?.length ?? 0) - activeCount})
          </button>
        </div>
      </div>

      {list.isLoading ? (
        <ListSkeleton rows={4} />
      ) : list.isError ? (
        <ErrorBox onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("suppliers.empty")}
          description="Aucun fournisseur trouvé pour ces critères de recherche."
          action={
            can("supplier:manage") ? (
              <Button onClick={() => setCreating(true)}>{t("suppliers.new")}</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-3.5 pl-4 pr-3">{t("suppliers.name")}</th>
                  <th className="px-3 py-3.5">Téléphone / WhatsApp</th>
                  <th className="px-3 py-3.5">{t("suppliers.email")}</th>
                  <th className="px-3 py-3.5 text-center">{t("suppliers.paymentTermsDays")}</th>
                  <th className="px-3 py-3.5 text-center">Catalogue</th>
                  <th className="px-3 py-3.5 text-center">{t("common.status")}</th>
                  <th className="py-3.5 pl-3 pr-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.map((s) => {
                  const phoneToShow = s.whatsappPhone ?? s.phone;

                  return (
                    <tr
                      key={s.id}
                      className="group transition-colors hover:bg-surface-2/40"
                    >
                      {/* Nom Fournisseur */}
                      <td className="py-3.5 pl-4 pr-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-foreground font-bold">
                            <Truck size={16} />
                          </div>
                          <div>
                            <Link
                              href={`/achats/fournisseurs/${s.id}`}
                              className="font-semibold text-foreground group-hover:text-accent group-hover:underline"
                            >
                              {s.name}
                            </Link>
                          </div>
                        </div>
                      </td>

                      {/* Téléphone / WhatsApp */}
                      <td className="px-3 py-3.5 text-xs">
                        {phoneToShow ? (
                          <div className="flex items-center gap-2">
                            {s.whatsappPhone && (
                              <a
                                href={`https://wa.me/${s.whatsappPhone.replace(/[^0-9]/g, "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="WhatsApp"
                                className="inline-flex size-6 items-center justify-center rounded-md bg-status-ok-bg text-status-ok transition hover:opacity-80"
                              >
                                <MessageCircle size={13} />
                              </a>
                            )}
                            <a
                              href={`tel:${phoneToShow}`}
                              className="font-medium text-foreground hover:underline"
                            >
                              {formatPhone(phoneToShow)}
                            </a>
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>

                      {/* Email */}
                      <td className="px-3 py-3.5 text-xs text-muted">
                        {s.email ? (
                          <a
                            href={`mailto:${s.email}`}
                            className="hover:text-foreground hover:underline"
                          >
                            {s.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>

                      {/* Règlement */}
                      <td className="px-3 py-3.5 text-center">
                        <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-semibold text-foreground">
                          {s.paymentTermsDays === 0 ? "Comptant" : `${s.paymentTermsDays} j`}
                        </span>
                      </td>

                      {/* Produits */}
                      <td className="px-3 py-3.5 text-center text-xs">
                        <span className="font-semibold text-foreground">{s.products}</span>{" "}
                        <span className="text-muted">réf.</span>
                      </td>

                      {/* Statut */}
                      <td className="px-3 py-3.5 text-center">
                        <StatusBadge
                          tone={s.isActive ? "ok" : "off"}
                          label={s.isActive ? t("suppliers.active") : t("suppliers.inactive")}
                        />
                      </td>

                      {/* Action */}
                      <td className="py-3.5 pl-3 pr-4 text-right">
                        <Link
                          href={`/achats/fournisseurs/${s.id}`}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-all hover:border-accent hover:bg-surface-2"
                        >
                          <span>Fiche</span>
                          <ArrowRight size={13} />
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

      {creating ? (
        <SupplierFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => router.push(`/achats/fournisseurs/${id}`)}
        />
      ) : null}
    </div>
  );
}
