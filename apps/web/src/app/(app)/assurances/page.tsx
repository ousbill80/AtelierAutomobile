"use client";

// M16 §7 — /assurances : encours par compagnie (balance âgée), délai moyen de paiement,
// dossiers bloqués et relances à valider (US-M16-07, US-M16-09).
import type { ComponentType } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  BellRing,
  Building2,
  FolderOpen,
  Wallet,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/claims/i18n";
import { ClaimsNav } from "./nav";

const BUCKETS = ["b0_30", "b31_60", "b61_90", "b91_120", "b120p"] as const;
type Bucket = (typeof BUCKETS)[number];

// Du plus récent (vert) au plus ancien (rouge) ; la légende reprend les mêmes libellés.
const BUCKET_COLOR: Record<Bucket, string> = {
  b0_30: "bg-status-ok",
  b31_60: "bg-chan-sms",
  b61_90: "bg-status-warn",
  b91_120: "bg-accent",
  b120p: "bg-status-bad",
};

function Tile({
  icon: Icon,
  label,
  value,
  href,
  tone,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href?: string;
  tone?: "accent" | "warn" | "bad";
}) {
  const iconClass =
    tone === "bad"
      ? "bg-status-bad-bg text-status-bad"
      : tone === "warn"
        ? "bg-status-warn-bg text-status-warn"
        : "bg-accent/10 text-accent";
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs font-medium text-muted">
        <span
          aria-hidden
          className={`flex size-7 items-center justify-center rounded-md ${iconClass}`}
        >
          <Icon className="size-4" />
        </span>
        {label}
      </span>
      <span className="text-xl font-bold tracking-tight">{value}</span>
    </>
  );
  const className =
    "flex min-h-24 min-w-0 flex-col justify-between gap-2 rounded-xl border border-border bg-surface p-3 shadow-brand-sm";
  return href ? (
    <Link
      href={href}
      className={`${className} transition-colors hover:border-accent/40 hover:bg-surface-2`}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function AgingBar({ aging, total }: { aging: Record<Bucket, number>; total: number }) {
  if (total <= 0) return <span aria-hidden className="h-2.5 rounded-full bg-surface-2" />;
  return (
    <span aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
      {BUCKETS.map((b) =>
        aging[b] > 0 ? (
          <span
            key={b}
            className={BUCKET_COLOR[b]}
            style={{ width: `${(aging[b] / total) * 100}%` }}
          />
        ) : null,
      )}
    </span>
  );
}

function AgingLegend() {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-hidden>
      {BUCKETS.map((b) => (
        <span key={b} className="inline-flex items-center gap-1">
          <span className={`size-2.5 rounded-sm ${BUCKET_COLOR[b]}`} />
          {t(`aging.${b}`)}
        </span>
      ))}
    </span>
  );
}

export default function InsuranceDashboardPage() {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const stats = trpc.insurer.stats.useQuery({});
  const blocked = trpc.claim.list.useQuery({ blockedOnly: true, limit: 50 });
  const followUps = trpc.claim.followUps.useQuery({}, { enabled: perms.has("claim:followup") });
  // Compagnies actives, ou désactivées mais avec un encours ou des dossiers ; plus gros encours d'abord.
  const insurers = (stats.data ?? [])
    .filter((s) => s.isActive || s.outstanding > 0 || s.openClaims > 0)
    .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  const totals = insurers.reduce(
    (acc, s) => ({
      outstanding: acc.outstanding + s.outstanding,
      openClaims: acc.openClaims + s.openClaims,
      over60: acc.over60 + s.aging.b61_90 + s.aging.b91_120 + s.aging.b120p,
    }),
    { outstanding: 0, openClaims: 0, over60: 0 },
  );

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

      {stats.data && stats.data.length > 0 && (
        <section
          aria-label={t("title")}
          className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
        >
          <Tile
            icon={Wallet}
            label={t("kpi.outstanding")}
            value={formatFCFA(totals.outstanding)}
            tone="accent"
          />
          <Tile icon={FolderOpen} label={t("kpi.openClaims")} value={String(totals.openClaims)} />
          <Tile
            icon={AlertTriangle}
            label={t("kpi.overdue")}
            value={formatFCFA(totals.over60)}
            tone={totals.over60 > 0 ? "bad" : undefined}
          />
          <Tile
            icon={Ban}
            label={t("kpi.blocked")}
            value={blocked.data ? String(blocked.data.items.length) : "…"}
            href="/assurances/sinistres?bloques=1"
            tone={blocked.data?.items.length ? "warn" : undefined}
          />
          {perms.has("claim:followup") && (
            <Tile
              icon={BellRing}
              label={t("kpi.followUps")}
              value={followUps.data ? String(followUps.data.length) : "…"}
              href="/assurances/relances"
              tone={followUps.data?.length ? "warn" : undefined}
            />
          )}
        </section>
      )}

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
        <section aria-labelledby="insurers-heading" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="insurers-heading" className="font-semibold">
              {t("agingTitle")}
            </h2>
            <AgingLegend />
          </div>
          <ul className="grid gap-3 lg:grid-cols-2" aria-label={t("insurersTitle")}>
            {insurers.map((s) => (
              <li key={s.insurerId}>
                <Link
                  href={`/assurances/sinistres?compagnie=${s.insurerId}`}
                  className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm shadow-brand-sm transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-brand-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <span className="flex flex-wrap items-start justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold">
                      <span
                        aria-hidden
                        className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent"
                      >
                        <Building2 className="size-5" />
                      </span>
                      {s.name}
                    </span>
                    <span className="text-right">
                      <span className="block text-xs text-muted">{t("fields.outstanding")}</span>
                      <strong className="text-lg">{formatFCFA(s.outstanding)}</strong>
                    </span>
                  </span>
                  <AgingBar aging={s.aging} total={s.outstanding} />
                  <span className="grid grid-cols-5 gap-1 text-xs">
                    {BUCKETS.map((b) => (
                      <span key={b} className="flex min-w-0 flex-col">
                        <span className="text-muted">{t(`aging.${b}`)}</span>
                        <span
                          className={`truncate font-semibold ${s.aging[b] ? "" : "text-muted"}`}
                        >
                          {s.aging[b] ? formatFCFA(s.aging[b]) : "—"}
                        </span>
                      </span>
                    ))}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-xs text-muted">
                    <span>
                      {t("fields.openClaims")} :{" "}
                      <strong className="text-foreground">{s.openClaims}</strong>
                    </span>
                    <span>
                      {t("fields.avgDaysToPay")} :{" "}
                      <strong className="text-foreground">
                        {s.avgDaysToPay === null ? "—" : t("fields.days", { days: s.avgDaysToPay })}
                      </strong>
                    </span>
                    {s.oldestClaim && (
                      <span>
                        {t("fields.oldest")} :{" "}
                        <span className="font-mono text-foreground">{s.oldestClaim.number}</span>
                      </span>
                    )}
                    <span className="ml-auto inline-flex items-center gap-1 font-medium text-accent">
                      {t("seeClaims")}
                      <ArrowRight
                        className="size-3.5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
