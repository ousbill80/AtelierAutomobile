"use client";

// M16 §7 — /assurances/sinistres : vue modernisée avec KPIs de dossiers,
// filtres rapides, recherche en temps réel, export CSV et table de suivi complète.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Clock,
  Download,
  FileText,
  Plus,
  Search,
  Shield,
  Wrench,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, PlateBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { BlockerBadge, ClaimStatusBadge, type Blocker } from "@/components/claims/badges";
import { CLAIM_STATUSES, t } from "@/components/claims/i18n";
import { ClaimsNav } from "../nav";

type Status = (typeof CLAIM_STATUSES)[number];

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ClaimsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <ClaimsContent />
    </Suspense>
  );
}

function ClaimsContent() {
  const params = useSearchParams();
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const [insurerId, setInsurerId] = useState(params.get("compagnie") ?? "");
  const [blockedOnly, setBlockedOnly] = useState(params.get("bloques") === "1");

  const insurers = trpc.insurer.list.useQuery();
  const list = trpc.claim.list.useQuery({
    q: q.trim() || undefined,
    status: status || undefined,
    insurerId: insurerId || undefined,
    blockedOnly: blockedOnly || undefined,
    limit: 100,
  });

  const summary = list.data?.summary;

  function exportCsv() {
    if (!list.data) return;
    const head = [
      t("fields.number"),
      t("fields.claimNumber"),
      t("fields.customer"),
      t("fields.plate"),
      t("fields.insurer"),
      t("fields.insurerShare"),
      t("fields.insurerBalance"),
      t("fields.customerShare"),
      t("fields.customerBalance"),
    ];
    const rows = list.data.items.map((c) => [
      c.number,
      c.claimNumber,
      c.customer.displayName,
      c.vehicle.plate,
      c.insurer.name,
      c.insurerTotal,
      c.insurerBalance,
      c.customerTotal,
      c.customerBalance,
    ]);
    const csv = [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\n");
    const url = URL.createObjectURL(
      new Blob([`${String.fromCharCode(0xfeff)}${csv}`], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "sinistres.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasFilter = Boolean(q.trim() || status || insurerId || blockedOnly);

  const resetFilters = () => {
    setQ("");
    setStatus("");
    setInsurerId("");
    setBlockedOnly(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-16">
      {/* En-tête de la page */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Shield size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t("claimsTitle")}
              </h1>
              {summary && summary.blockedCount > 0 && (
                <span className="rounded-full bg-status-bad-bg px-2.5 py-0.5 text-xs font-semibold text-status-bad">
                  {summary.blockedCount} bloqué{summary.blockedCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              Gestion des dossiers assurances, passages d&apos;experts, accords et double
              facturation
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={!list.data?.items.length}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2 disabled:opacity-50"
          >
            <Download size={14} className="text-muted" />
            <span>{t("csv")}</span>
          </button>
          {perms.has("insurance:manage") && (
            <Link
              href="/assurances/sinistres/nouveau"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-medium text-accent-fg shadow-sm transition-all hover:brightness-105"
            >
              <Plus size={14} strokeWidth={2.5} />
              <span>{t("new")}</span>
            </Link>
          )}
        </div>
      </div>

      {/* Sous-navigation des assurances */}
      <ClaimsNav />

      {/* Cartes KPI dynamiques et interactives */}
      {list.isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2/60" />
          ))}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {/* Total dossiers sinistres */}
          <button
            type="button"
            onClick={resetFilters}
            className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 text-left shadow-xs transition-all hover:border-accent hover:bg-surface-2/30"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">{t("claimsModule.kpis.total")}</span>
              <FileText size={16} className="text-muted" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {summary.totalClaims}
            </div>
            <div className="mt-1 text-[11px] text-muted">Tous les dossiers suivis</div>
          </button>

          {/* En attente d'expertise ou d'accord */}
          <button
            type="button"
            onClick={() => {
              setBlockedOnly(false);
              setStatus("ESTIMATE_SENT");
            }}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              status === "ESTIMATE_SENT" || status === "OPENED" || status === "EXPERT_SCHEDULED"
                ? "border-accent bg-accent/10 ring-2 ring-accent"
                : "border-border/80 bg-surface hover:border-accent hover:bg-surface-2/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("claimsModule.kpis.waiting")}
              </span>
              <Clock size={16} className="text-accent" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {summary.waitingApprovalCount}
            </div>
            <div className="mt-1 text-[11px] text-muted">Expertise ou accord attendu</div>
          </button>

          {/* Réparations autorisées */}
          <button
            type="button"
            onClick={() => {
              setBlockedOnly(false);
              setStatus("REPAIRING");
            }}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              status === "REPAIRING" || status === "APPROVED"
                ? "border-status-ok bg-status-ok-bg/30 ring-2 ring-status-ok"
                : "border-border/80 bg-surface hover:border-status-ok hover:bg-surface-2/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("claimsModule.kpis.repairing")}
              </span>
              <Wrench size={16} className="text-status-ok" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {summary.authorizedCount}
            </div>
            <div className="mt-1 text-[11px] text-muted">{summary.inRepairCount} en atelier</div>
          </button>

          {/* Facturés / En attente de règlement assureur */}
          <button
            type="button"
            onClick={() => {
              setBlockedOnly(false);
              setStatus("INVOICED");
            }}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              status === "INVOICED"
                ? "border-status-warn bg-status-warn-bg/30 ring-2 ring-status-warn"
                : "border-border/80 bg-surface hover:border-status-warn hover:bg-surface-2/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                {t("claimsModule.kpis.invoiced")}
              </span>
              <Building2 size={16} className="text-status-warn" />
            </div>
            <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
              {formatFCFA(summary.totalInsurerDue)}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {summary.invoicedPendingCount} dossier(s) en attente
            </div>
          </button>

          {/* Dossiers en retard / bloqués */}
          <button
            type="button"
            onClick={() => setBlockedOnly(!blockedOnly)}
            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left shadow-xs transition-all ${
              blockedOnly
                ? "border-status-bad bg-status-bad-bg/40 ring-2 ring-status-bad"
                : "border-border/80 bg-surface hover:border-status-bad hover:bg-status-bad-bg/15"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-status-bad">
                {t("claimsModule.kpis.blocked")}
              </span>
              <AlertCircle size={16} className="text-status-bad" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-status-bad">
              {summary.blockedCount}
            </div>
            <div className="mt-1 text-[11px] font-medium text-status-bad">
              {blockedOnly
                ? "Filtre actif (cliquer pour réinitialiser)"
                : "Expert, franchise ou solde"}
            </div>
          </button>
        </div>
      )}

      {/* Barre d'outils et filtres */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-3 shadow-xs">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder={t("claimsModule.filters.searchPlaceholder")}
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

          <div className="flex flex-wrap items-center gap-2">
            {/* Filtre Statut */}
            <select
              aria-label={t("allStatuses")}
              value={status}
              onChange={(e) => setStatus(e.target.value as Status | "")}
              className="h-9 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
            >
              <option value="">{t("allStatuses")}</option>
              {CLAIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>

            {/* Filtre Compagnie */}
            <select
              aria-label={t("allInsurers")}
              value={insurerId}
              onChange={(e) => setInsurerId(e.target.value)}
              className="h-9 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
            >
              <option value="">{t("allInsurers")}</option>
              {insurers.data?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>

            {/* Filtre Bloqués */}
            <button
              type="button"
              onClick={() => setBlockedOnly(!blockedOnly)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all ${
                blockedOnly
                  ? "border-status-bad bg-status-bad-bg text-status-bad shadow-xs"
                  : "border-border/80 bg-surface text-muted hover:text-foreground"
              }`}
            >
              <AlertCircle size={13} />
              <span>{t("blockedOnly")}</span>
            </button>

            {hasFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-surface-2 px-2.5 text-xs font-medium text-muted hover:text-foreground"
              >
                <X size={13} />
                <span>{t("claimsModule.filters.reset")}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Contenu principal : Liste ou Tableau */}
      {list.isLoading ? (
        <ListSkeleton rows={5} />
      ) : list.isError || !list.data ? (
        <ErrorBox onRetry={() => list.refetch()} message={t("loadError")} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={t("claimsModule.empty.title")}
          description={hasFilter ? t("claimsModule.empty.description") : t("empty.description")}
          action={
            hasFilter ? (
              <Button variant="secondary" onClick={resetFilters}>
                {t("claimsModule.empty.action")}
              </Button>
            ) : perms.has("insurance:manage") ? (
              <Link href="/assurances/sinistres/nouveau">
                <Button variant="primary">+ {t("claimsModule.empty.create")}</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-3.5 pl-4 pr-3">{t("claimsModule.table.claim")}</th>
                  <th className="px-3 py-3.5">{t("claimsModule.table.vehicleCustomer")}</th>
                  <th className="px-3 py-3.5">{t("claimsModule.table.insurer")}</th>
                  <th className="px-3 py-3.5">{t("claimsModule.table.status")}</th>
                  <th className="px-3 py-3.5 text-right">{t("claimsModule.table.insurerShare")}</th>
                  <th className="px-3 py-3.5 text-right">
                    {t("claimsModule.table.customerShare")}
                  </th>
                  <th className="py-3.5 pl-3 pr-4 text-right">{t("claimsModule.table.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {list.data.items.map((c) => {
                  return (
                    <tr key={c.id} className="group transition-colors hover:bg-surface-2/40">
                      {/* Numéro dossier */}
                      <td className="py-3.5 pl-4 pr-3">
                        <div className="flex flex-col gap-0.5">
                          <Link
                            href={`/assurances/sinistres/${c.id}`}
                            className="font-mono font-semibold text-foreground group-hover:text-accent group-hover:underline"
                          >
                            {c.number}
                          </Link>
                          {c.claimNumber && (
                            <span className="font-mono text-xs text-muted">
                              Ref: {c.claimNumber}
                            </span>
                          )}
                          {c.blockers.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {(c.blockers as Blocker[]).map((b) => (
                                <BlockerBadge key={b.code} blocker={b} />
                              ))}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Assuré & Véhicule */}
                      <td className="px-3 py-3.5">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-foreground">
                            {c.customer.displayName}
                          </span>
                          <div className="flex items-center gap-1.5 text-xs text-muted">
                            <PlateBadge plate={c.vehicle.plate} />
                            <span>
                              {c.vehicle.make} {c.vehicle.model}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Compagnie & Expert */}
                      <td className="px-3 py-3.5">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                              <Building2 size={14} />
                            </div>
                            <span className="text-xs font-semibold text-foreground">
                              {c.insurer.name}
                            </span>
                          </div>
                          {c.expertName && (
                            <span className="text-[11px] text-muted">Expert : {c.expertName}</span>
                          )}
                        </div>
                      </td>

                      {/* Statut */}
                      <td className="px-3 py-3.5">
                        <ClaimStatusBadge status={c.status} />
                      </td>

                      {/* Part Assureur */}
                      <td className="px-3 py-3.5 text-right tabular-nums">
                        {c.insurerTotal !== null ? (
                          <div className="flex flex-col items-end">
                            <span className="font-semibold text-foreground">
                              {formatFCFA(c.insurerTotal)}
                            </span>
                            {c.insurerBalance !== null && c.insurerBalance > 0 ? (
                              <span className="text-xs font-medium text-status-bad">
                                Dû: {formatFCFA(c.insurerBalance)}
                              </span>
                            ) : (
                              <span className="text-[11px] text-status-ok font-medium">Réglé</span>
                            )}
                          </div>
                        ) : c.approvedAmount !== null ? (
                          <div className="flex flex-col items-end">
                            <span className="text-xs font-medium text-accent">
                              Accord: {formatFCFA(c.approvedAmount)}
                            </span>
                            <span className="text-[11px] text-muted">Non facturé</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">En chiffrage</span>
                        )}
                      </td>

                      {/* Part Assuré */}
                      <td className="px-3 py-3.5 text-right tabular-nums">
                        {c.customerTotal !== null ? (
                          <div className="flex flex-col items-end">
                            <span className="font-medium text-foreground">
                              {formatFCFA(c.customerTotal)}
                            </span>
                            {c.customerBalance !== null && c.customerBalance > 0 ? (
                              <span className="text-xs font-medium text-status-warn">
                                Solde: {formatFCFA(c.customerBalance)}
                              </span>
                            ) : (
                              <span className="text-[11px] text-status-ok">Réglé</span>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col items-end">
                            <span className="text-xs text-muted">
                              Franchise: {formatFCFA(c.deductible)}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 pl-3 pr-4 text-right">
                        <Link
                          href={`/assurances/sinistres/${c.id}`}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-all hover:border-accent hover:bg-surface-2"
                        >
                          <span>{t("claimsModule.table.view")}</span>
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
    </div>
  );
}
