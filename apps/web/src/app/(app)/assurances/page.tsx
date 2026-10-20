"use client";

// M16 §7 — /assurances : encours par compagnie (balance âgée), délai moyen de paiement,
// dossiers bloqués et relances à valider (US-M16-07, US-M16-09).
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { EmptyState } from "@atelieros/ui";
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

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted">{t("dashboardDesc")}</p>
        </div>
        {perms.has("insurance:manage") && (
          <Link href="/assurances/sinistres/nouveau" className="btn btn-primary min-h-11">
            + {t("new")}
          </Link>
        )}
      </div>
      <ClaimsNav />

      <section className="flex flex-wrap gap-3">
        <Link
          href="/assurances/sinistres?bloques=1"
          className="flex min-h-11 flex-col rounded-lg border border-border bg-surface p-3 hover:border-accent"
        >
          <span className="text-xs text-muted">{t("blockedOnly")}</span>
          <span className="text-lg font-semibold">
            {blocked.data ? blocked.data.items.length : "…"}
          </span>
        </Link>
        {perms.has("claim:followup") && (
          <Link
            href="/assurances/relances"
            className="flex min-h-11 flex-col rounded-lg border border-border bg-surface p-3 hover:border-accent"
          >
            <span className="text-xs text-muted">{t("followUpsTitle")}</span>
            <span className="text-lg font-semibold">
              {followUps.data ? followUps.data.length : "…"}
            </span>
          </Link>
        )}
      </section>

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
              <Link href="/assurances/compagnies" className="btn btn-primary min-h-11">
                {t("addInsurer")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("insurersTitle")}>
          {stats.data.map((s) => (
            <li key={s.insurerId}>
              <Link
                href={`/assurances/sinistres?compagnie=${s.insurerId}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm hover:border-accent"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{s.name}</span>
                  <span>
                    {t("fields.outstanding")} <strong>{formatFCFA(s.outstanding)}</strong>
                  </span>
                </span>
                <span className="flex flex-wrap gap-3 text-xs text-muted">
                  <span>
                    {t("fields.openClaims")} : {s.openClaims}
                  </span>
                  <span>
                    {t("fields.avgDaysToPay")} :{" "}
                    {s.avgDaysToPay === null ? "—" : t("fields.days", { days: s.avgDaysToPay })}
                  </span>
                  {s.oldestClaim && (
                    <span>
                      {t("fields.oldest")} : {s.oldestClaim.number}
                    </span>
                  )}
                </span>
                <span className="grid grid-cols-5 gap-1 text-xs">
                  {BUCKETS.map((b) => (
                    <span key={b} className="flex flex-col rounded bg-surface-2 p-1">
                      <span className="text-muted">{t(`aging.${b}`)}</span>
                      <span className="font-semibold">{formatFCFA(s.aging[b])}</span>
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
