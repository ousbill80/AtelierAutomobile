"use client";

// M16 §7 — /assurances : tableau de bord de gestion des assurances,
// encours par compagnie (balance âgée interactive), délai moyen de règlement,
// dossiers bloqués et relances à valider (US-M16-07, US-M16-09).
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Clock,
  Plus,
  Send,
  Shield,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/claims/i18n";
import { ClaimsNav } from "./nav";

const BUCKETS = ["b0_30", "b31_60", "b61_90", "b91_120", "b120p"] as const;

export default function InsuranceDashboardPage() {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const stats = trpc.insurer.stats.useQuery({});
  const blocked = trpc.claim.list.useQuery({ blockedOnly: true, limit: 50 });
  const followUps = trpc.claim.followUps.useQuery({}, { enabled: perms.has("claim:followup") });

  const totalOutstanding =
    stats.data?.reduce((sum, item) => sum + item.outstanding, 0) ?? 0;
  const totalOpenClaims =
    stats.data?.reduce((sum, item) => sum + item.openClaims, 0) ?? 0;

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-16">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Shield size={22} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
            <p className="text-xs text-muted">{t("dashboardDesc")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {perms.has("insurer:edit") && (
            <Link
              href="/assurances/compagnies"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
            >
              <Building2 size={14} className="text-muted" />
              <span>{t("insurersTitle")}</span>
            </Link>
          )}
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

      {/* Navigation onglets */}
      <ClaimsNav />

      {/* Cartes KPI intelligentes */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total Encours Assureurs */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Encours total assureurs</span>
            <Building2 size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {formatFCFA(totalOutstanding)}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            Réparti sur {stats.data?.length ?? 0} compagnies
          </div>
        </div>

        {/* Dossiers ouverts */}
        <Link
          href="/assurances/sinistres"
          className="group flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm transition-all hover:border-accent hover:bg-surface-2/40"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Dossiers en cours</span>
            <ArrowRight size={14} className="text-muted group-hover:text-accent" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {totalOpenClaims}
          </div>
          <div className="mt-1 text-[11px] text-muted">Consulter tous les sinistres</div>
        </Link>

        {/* Dossiers bloqués avec alerte */}
        <Link
          href="/assurances/sinistres?bloques=1"
          className="group flex flex-col justify-between rounded-xl border border-status-bad/40 bg-status-bad-bg/10 p-3.5 shadow-sm transition-all hover:border-status-bad hover:bg-status-bad-bg/25"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-status-bad">{t("blockedOnly")}</span>
            <AlertCircle size={16} className="text-status-bad" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-status-bad">
            {blocked.data ? blocked.data.items.length : "…"}
          </div>
          <div className="mt-1 text-[11px] font-medium text-status-bad">
            Franchises, expert ou retards
          </div>
        </Link>

        {/* Relances à valider */}
        {perms.has("claim:followup") ? (
          <Link
            href="/assurances/relances"
            className="group flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm transition-all hover:border-accent hover:bg-surface-2/40"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">{t("followUpsTitle")}</span>
              <Send size={15} className="text-muted group-hover:text-accent" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {followUps.data ? followUps.data.length : "…"}
            </div>
            <div className="mt-1 text-[11px] text-muted">Relances programmées aujourd&apos;hui</div>
          </Link>
        ) : (
          <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Délai moyen règlement</span>
              <Clock size={16} className="text-muted" />
            </div>
            <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
              {stats.data?.[0]?.avgDaysToPay ? `${stats.data[0].avgDaysToPay} jours` : "—"}
            </div>
            <div className="mt-1 text-[11px] text-muted">Moyenne générale</div>
          </div>
        )}
      </div>

      {/* Balance âgée et statistiques par compagnie */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {t("insurersTitle")} — Balance âgée & Encours
            </h2>
            <p className="text-xs text-muted">
              Délais de paiement, encours et créances échues par assureur
            </p>
          </div>
        </div>

        {stats.isLoading ? (
          <ListSkeleton rows={3} />
        ) : stats.isError || !stats.data ? (
          <ErrorBox onRetry={() => stats.refetch()} message={t("loadError")} />
        ) : stats.data.length === 0 ? (
          <EmptyState
            title={t("noInsurer")}
            description={t("emptyInsurers.description")}
            action={
              perms.has("insurer:edit") ? (
                <Link href="/assurances/compagnies">
                  <Button variant="primary">{t("addInsurer")}</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {stats.data.map((s) => (
              <div
                key={s.insurerId}
                className="group flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-4 shadow-xs transition-all hover:border-accent/80 hover:bg-surface-2/20"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-foreground">
                      <Building2 size={18} />
                    </div>
                    <div>
                      <Link
                        href={`/assurances/sinistres?compagnie=${s.insurerId}`}
                        className="text-base font-bold text-foreground group-hover:text-accent group-hover:underline"
                      >
                        {s.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted">
                        <span>
                          {t("fields.openClaims")} :{" "}
                          <strong className="text-foreground">{s.openClaims}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          {t("fields.avgDaysToPay")} :{" "}
                          <strong className="text-foreground">
                            {s.avgDaysToPay === null
                              ? "—"
                              : t("fields.days", { days: s.avgDaysToPay })}
                          </strong>
                        </span>
                        {s.oldestClaim && (
                          <>
                            <span>•</span>
                            <span>
                              {t("fields.oldest")} :{" "}
                              <strong className="text-foreground">{s.oldestClaim.number}</strong>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <div className="text-left sm:text-right">
                      <span className="block text-xs text-muted">{t("fields.outstanding")}</span>
                      <span className="text-lg font-bold text-foreground">
                        {formatFCFA(s.outstanding)}
                      </span>
                    </div>
                    <Link
                      href={`/assurances/sinistres?compagnie=${s.insurerId}`}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-all hover:bg-surface-2 hover:border-accent"
                    >
                      <span>Voir dossiers</span>
                      <ArrowRight size={13} />
                    </Link>
                  </div>
                </div>

                {/* Tranches de balance âgée */}
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2/40 p-2 sm:grid-cols-5">
                  {BUCKETS.map((b) => {
                    const amount = s.aging[b];
                    const isAlert = (b === "b91_120" || b === "b120p") && amount > 0;

                    return (
                      <div
                        key={b}
                        className={`flex flex-col justify-between rounded-md border p-2 ${
                          isAlert
                            ? "border-status-bad/30 bg-status-bad-bg/20"
                            : "border-border/60 bg-surface"
                        }`}
                      >
                        <span
                          className={`text-[11px] font-medium ${
                            isAlert ? "text-status-bad" : "text-muted"
                          }`}
                        >
                          {t(`aging.${b}`)}
                        </span>
                        <span
                          className={`mt-1 text-xs font-bold tabular-nums ${
                            isAlert ? "text-status-bad" : "text-foreground"
                          }`}
                        >
                          {formatFCFA(amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
