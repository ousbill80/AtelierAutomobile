"use client";

// M05 §7 — /devis : onglets À traiter / En attente / Décidés / Expirés / Statistiques,
// recherche, cartes sur mobile. Toute donnée vient de `quote.list` et `quote.stats`.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { EmptyState, Input, Tabs } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { LinkButton } from "@/components/link-button";
import { DiscountApprovalBadge, QuoteStatusBadge } from "@/components/quotes/badges";
import { ErrorBox, ListSkeleton } from "@/components/quotes/error-box";
import { formatDateTime, formatDay, t } from "@/components/quotes/i18n";
import type { QuoteListItem } from "@/components/quotes/types";

const TABS = ["TODO", "PENDING", "DECIDED", "EXPIRED", "STATS"] as const;
type Tab = (typeof TABS)[number];

export default function QuotesPage() {
  const [tab, setTab] = useState<Tab>("TODO");
  const [q, setQ] = useState("");
  const list = trpc.quote.list.useQuery(
    { tab: tab === "STATS" ? "ALL" : tab, q: q.trim() || undefined, limit: 100 },
    { enabled: tab !== "STATS" },
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <LinkButton href="/devis/nouveau">+ {t("new")}</LinkButton>
      </div>
      <div className="max-w-full overflow-x-auto">
        <Tabs
          items={TABS.map((key) => ({
            key,
            label:
              key !== "STATS" && list.data ? `${t(`tabs.${key}`)} (${list.data.counts[key]})` : t(`tabs.${key}`),
          }))}
          activeKey={tab}
          onChange={(key) => setTab(key as Tab)}
        />
      </div>
      {tab === "STATS" ? (
        <StatsPanel />
      ) : (
        <>
          <Input
            aria-label={t("search")}
            placeholder={t("search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-md"
          />
          {list.isLoading && <ListSkeleton />}
          {list.isError && <ErrorBox onRetry={() => list.refetch()} />}
          {list.data && list.data.items.length === 0 && (
            <EmptyState
              title={q ? t("emptyFiltered") : t("empty")}
              action={<LinkButton href="/devis/nouveau">+ {t("new")}</LinkButton>}
            />
          )}
          {list.data && list.data.items.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label={t("title")}>
              {list.data.items.map((item) => (
                <li key={item.id}>
                  <QuoteCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function QuoteCard({ item }: { item: QuoteListItem }) {
  const pending = item.status === "SENT" || item.status === "VIEWED";
  return (
    <Link
      href={`/devis/${item.id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm hover:bg-surface-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold">{item.number}</span>
          {item.version > 1 && <span className="text-xs text-muted">{t("card.version", { version: item.version })}</span>}
          <QuoteStatusBadge status={item.status} />
          <DiscountApprovalBadge status={item.discountApprovalStatus} />
        </span>
        <span className="font-semibold">{formatFCFA(item.total)}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>{item.customer.displayName}</span>
        {item.vehicle && (
          <span>
            {item.vehicle.make} {item.vehicle.model} · {item.vehicle.plate}
          </span>
        )}
        <span>{t(`origin.${item.origin}`)}</span>
        {item.advisor && <span>{item.advisor.name}</span>}
        <span>{formatDay(item.createdAt)}</span>
        {item.acceptedTotal > 0 && (
          <span className="text-status-ok">
            {t("columns.accepted")} : {formatFCFA(item.acceptedTotal)}
          </span>
        )}
        {pending && (
          <>
            <span>{item.viewedAt ? t("card.viewed", { date: formatDateTime(item.viewedAt) }) : t("card.notViewed")}</span>
            <span>{t("card.reminders", { count: item.remindersSent })}</span>
            <span className={item.daysToExpiry <= 2 ? "text-status-warn" : ""}>
              {item.daysToExpiry < 0
                ? t("card.expired")
                : item.daysToExpiry === 0
                  ? t("card.expiresToday")
                  : t("card.expiresIn", { days: item.daysToExpiry })}
            </span>
          </>
        )}
      </div>
    </Link>
  );
}

function StatsPanel() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const stats = trpc.quote.stats.useQuery({ from: from || undefined, to: to || undefined });
  if (stats.isLoading) return <ListSkeleton />;
  if (stats.isError) return <ErrorBox onRetry={() => stats.refetch()} message={stats.error.message} />;
  const s = stats.data!;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input label={t("stats.period")} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input aria-label={t("stats.period")} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {s.sent === 0 ? (
        <EmptyState title={t("stats.noData")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={t("stats.sent")} value={String(s.sent)} />
            <Kpi label={t("stats.rateCount")} value={`${s.rateCount} %`} hint={`${s.acceptedCount} / ${s.closed}`} />
            <Kpi label={t("stats.rateValue")} value={`${s.rateValue} %`} hint={`${formatFCFA(s.acceptedAmount)} / ${formatFCFA(s.proposedAmount)}`} />
            <Kpi
              label={t("stats.median")}
              value={s.medianDecisionHours == null ? "—" : t("stats.hours", { hours: Math.round(s.medianDecisionHours) })}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-3 text-sm">
              <h2 className="mb-2 font-semibold">{t("stats.byAdvisor")}</h2>
              <ul className="flex flex-col gap-1">
                {s.byAdvisor.map((a) => (
                  <li key={a.key} className="flex justify-between gap-2">
                    <span>{a.label}</span>
                    <span>
                      {a.accepted} / {a.sent} · {a.rateCount} %
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3 text-sm">
              <h2 className="mb-2 font-semibold">{t("stats.declineReasons")}</h2>
              <ul className="flex flex-col gap-1">
                {s.declineReasons.length === 0 && <li className="text-muted">—</li>}
                {s.declineReasons.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-2">
                    <span>{t(`decision.reasons.${r.reason.split(" : ")[0]}`)}</span>
                    <span>{r.count}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                {t("stats.recovered")} : {formatFCFA(s.recoveredByFollowups)}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xl font-semibold">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}
