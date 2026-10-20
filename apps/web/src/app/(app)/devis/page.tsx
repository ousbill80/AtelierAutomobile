"use client";

// M05 §7 — /devis : onglets À traiter / En attente / Décidés / Expirés / Statistiques,
// recherche et filtres ; tableau sur ordinateur, cartes sur mobile.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { EmptyState, Input, PlateBadge, Select, Tabs } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay } from "@/components/repair-orders/i18n";
import { QuoteStatusBadge } from "@/components/quotes/badges";
import { t } from "@/components/quotes/i18n";
import { QuoteStats } from "./stats";

const TABS = ["todo", "waiting", "decided", "expired", "stats"] as const;
type Tab = (typeof TABS)[number];

export default function QuotesPage() {
  const me = trpc.me.get.useQuery();
  const [tab, setTab] = useState<Tab>("todo");
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("");
  const perms = new Set(me.data?.permissions ?? []);
  const list = trpc.quote.list.useQuery(
    {
      tab: tab === "stats" ? "all" : tab,
      q: q.trim() || undefined,
      origin: (origin || undefined) as "STANDALONE" | undefined,
    },
    { enabled: tab !== "stats" },
  );
  const counts = list.data?.counts;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        {perms.has("quote:create") && (
          <Link href="/devis/nouveau" className="btn btn-primary min-h-11">
            + {t("new")}
          </Link>
        )}
      </div>
      <div className="max-w-full overflow-x-auto">
        <Tabs
          items={TABS.filter((k) => k !== "stats" || perms.has("report:read")).map((key) => ({
            key,
            label:
              counts && key !== "stats" ? `${t(`tabs.${key}`)} (${counts[key]})` : t(`tabs.${key}`),
          }))}
          activeKey={tab}
          onChange={(key) => setTab(key as Tab)}
        />
      </div>
      {tab === "stats" ? (
        <QuoteStats />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1">
              <Input
                aria-label={t("search")}
                placeholder={t("search")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select
              aria-label={t("fields.origin")}
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              className="min-h-11"
            >
              <option value="">{t("filters.allOrigins")}</option>
              {["REPAIR_ORDER", "INSPECTION", "STANDALONE", "APPOINTMENT", "INSURANCE"].map((o) => (
                <option key={o} value={o}>
                  {t(`origin.${o}`)}
                </option>
              ))}
            </Select>
          </div>
          {list.isLoading ? (
            <ListSkeleton rows={4} />
          ) : list.isError || !list.data ? (
            <ErrorBox onRetry={() => list.refetch()} />
          ) : list.data.items.length === 0 ? (
            <EmptyState title={t("empty.title")} description={t("empty.description")} />
          ) : (
            <ul className="flex flex-col gap-2" aria-label={t("title")}>
              {list.data.items.map((quote) => (
                <li key={quote.id}>
                  <Link
                    href={`/devis/${quote.id}`}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm hover:border-accent md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold">
                          {quote.number}
                          {quote.version > 1 ? ` v${quote.version}` : ""}
                        </span>
                        <QuoteStatusBadge status={quote.status} />
                        {quote.discountApprovalStatus === "PENDING" && (
                          <span className="text-xs font-semibold text-status-warn">
                            ⚠ {t("discount.pendingShort")}
                          </span>
                        )}
                      </span>
                      <span className="truncate">
                        {quote.customer.displayName}
                        {quote.vehicle ? ` · ${quote.vehicle.make} ${quote.vehicle.model}` : ""}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        {quote.vehicle && <PlateBadge plate={quote.vehicle.plate} />}
                        <span>{t(`origin.${quote.origin}`)}</span>
                        <span>{formatDay(quote.createdAt, list.data.timeZone)}</span>
                        {quote.advisor && <span>{quote.advisor}</span>}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 md:flex-col md:items-end">
                      <span className="font-semibold">{formatFCFA(quote.total)}</span>
                      {quote.acceptedTotal > 0 && (
                        <span className="text-xs text-status-ok">
                          {t("list.accepted", { amount: formatFCFA(quote.acceptedTotal) })}
                        </span>
                      )}
                      {(quote.status === "SENT" || quote.status === "VIEWED") && (
                        <span className="text-xs text-muted">
                          {quote.viewedAt ? `👁 ${t("list.viewed")}` : t("list.notViewed")} ·{" "}
                          {t("list.followups", { count: quote.followupsSent })} ·{" "}
                          {quote.daysToExpiry >= 0
                            ? t("list.expiresIn", { days: quote.daysToExpiry })
                            : t("status.EXPIRED")}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
