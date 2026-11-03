"use client";

// M05 §7 — /devis : onglets À traiter / En attente / Décidés / Expirés / Statistiques,
// mini-indicateurs expliqués, recherche et filtres ; tableau sur ordinateur, cartes sur mobile.
import { useState } from "react";
import Link from "next/link";
import { EduTip } from "@/components/edu-tip";
import { formatFCFA } from "@atelieros/core/money";
import { EmptyState, Input, PlateBadge, Select, Tabs } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime, formatDay } from "@/components/repair-orders/i18n";
import { QuoteStatusBadge } from "@/components/quotes/badges";
import { t } from "@/components/quotes/i18n";
import { GuideLink } from "@/components/guide-link";
import { QuoteStats } from "./stats";

const TABS = ["todo", "waiting", "decided", "expired", "stats"] as const;
type Tab = (typeof TABS)[number];
const WIDGETS = ["todo", "waiting", "decided", "expired"] as const;
type WidgetKey = (typeof WIDGETS)[number];
const ORIGINS = ["REPAIR_ORDER", "INSPECTION", "STANDALONE", "APPOINTMENT", "INSURANCE"] as const;
type Origin = (typeof ORIGINS)[number];

const COLS =
  "lg:grid-cols-[11rem_minmax(9.5rem,1.5fr)_8.6rem_6.2rem_minmax(6.5rem,8rem)_minmax(6.5rem,1fr)_6.4rem_5.6rem]";

export default function QuotesPage() {
  const me = trpc.me.get.useQuery();
  const [tab, setTab] = useState<Tab>("todo");
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("");
  const perms = new Set(me.data?.permissions ?? []);
  const listTab = tab === "stats" ? "all" : tab;
  const list = trpc.quote.list.useInfiniteQuery(
    {
      tab: listTab,
      q: q.trim() || undefined,
      origin: (origin || undefined) as Origin | undefined,
      limit: 30,
    },
    {
      enabled: tab !== "stats",
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    },
  );
  const summary = trpc.quote.list.useQuery({ tab: "all", limit: 1 }, { enabled: tab === "stats" });
  const snap = tab === "stats" ? summary.data : list.data?.pages[0];
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const timeZone = list.data?.pages[0]?.timeZone;
  const filtered = Boolean(q.trim() || origin);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          <GuideLink href="/devis/guide" />
          {perms.has("quote:create") && (
            <Link href="/devis/nouveau" className="btn btn-primary min-h-11">
              + {t("new")}
            </Link>
          )}
        </div>
      </div>

      {snap ? (
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {WIDGETS.map((key) => (
            <QuoteWidget
              key={key}
              widget={key}
              active={tab === key}
              count={snap.counts[key]}
              amount={formatFCFA(snap.amounts[key])}
              pending={key === "todo" ? snap.pendingDiscounts : 0}
              onSelect={() => setTab(key)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {WIDGETS.map((key) => (
            <div key={key} className="h-[4.75rem] animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      )}

      <div className="max-w-full overflow-x-auto">
        <Tabs
          items={TABS.filter((k) => k !== "stats" || perms.has("report:read")).map((key) => ({
            key,
            label:
              snap && key !== "stats"
                ? `${t(`tabs.${key}`)} (${snap.counts[key]})`
                : t(`tabs.${key}`),
          }))}
          activeKey={tab}
          onChange={(key) => setTab(key as Tab)}
        />
      </div>

      {tab === "stats" ? (
        <QuoteStats />
      ) : (
        <>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <Input
                aria-label={t("search")}
                placeholder={t("search")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="md:w-64 md:shrink-0">
              <Select
                aria-label={t("fields.origin")}
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="min-h-11"
              >
                <option value="">{t("filters.allOrigins")}</option>
                {ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {t(`origin.${o}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {list.isLoading ? (
            <ListSkeleton rows={4} />
          ) : list.isError || !list.data ? (
            <ErrorBox onRetry={() => list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              title={filtered ? t("empty.filtered.title") : t(`empty.${tab}.title`)}
              description={
                filtered ? t("empty.filtered.description") : t(`empty.${tab}.description`)
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">{t("list.count", { count: items.length })}</p>
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <div className="min-w-0 lg:min-w-[980px]">
                  <div
                    className={`hidden gap-3 border-b border-border bg-surface-2 px-4 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase lg:grid ${COLS}`}
                  >
                    <span>{t("list.columns.number")}</span>
                    <span>{t("list.columns.customer")}</span>
                    <span>{t("list.columns.origin")}</span>
                    <span>{t("list.columns.date")}</span>
                    <span>{t("list.columns.status")}</span>
                    <span>{t("list.columns.advisor")}</span>
                    <span className="text-right">{t("list.columns.total")}</span>
                    <span className="text-right">{t("list.columns.accepted")}</span>
                  </div>
                  <ul aria-label={t("title")}>
                    {items.map((quote) => (
                      <li key={quote.id} className="border-b border-border last:border-b-0">
                        <QuoteRow quote={quote} timeZone={timeZone} />
                      </li>
                    ))}
                  </ul>
                </div>
                {list.hasNextPage && (
                  <div className="border-t border-border p-3 text-center">
                    <button
                      type="button"
                      className="btn btn-secondary min-h-11"
                      onClick={() => list.fetchNextPage()}
                      disabled={list.isFetchingNextPage}
                    >
                      {t("list.more")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuoteWidget({
  widget,
  active,
  count,
  amount,
  pending,
  onSelect,
}: {
  widget: WidgetKey;
  active: boolean;
  count: number;
  amount: string;
  pending: number;
  onSelect: () => void;
}) {
  return (
    <div
      className={`relative flex items-stretch rounded-lg border bg-surface ${
        active ? "border-accent ring-1 ring-accent" : "border-border"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 px-3 py-2 text-left"
      >
        <span className="text-xs font-medium text-muted">{t(`tabs.${widget}`)}</span>
        <span className="text-xl font-semibold leading-none tabular-nums">{count}</span>
        <span className="max-w-full truncate text-xs text-muted">{amount}</span>
        {pending > 0 && (
          <span className="text-xs font-medium text-status-warn">
            {t("widgets.pending", { count: pending })}
          </span>
        )}
      </button>
      <EduTip text={t(`widgets.${widget}.help`)} example={t(`widgets.${widget}.example`)} />
    </div>
  );
}

type QuoteItem = {
  id: string;
  number: string;
  version: number;
  status: string;
  origin: string;
  createdAt: Date;
  viewedAt: Date | null;
  validUntil: Date;
  daysToExpiry: number;
  total: number;
  acceptedTotal: number;
  customer: { displayName: string };
  vehicle: { plate: string; make: string; model: string } | null;
  advisor: string | null;
  followupsSent: number;
  discountApprovalStatus: string | null;
  lastAction: Date;
};

function QuoteRow({ quote, timeZone }: { quote: QuoteItem; timeZone?: string }) {
  const waiting = quote.status === "SENT" || quote.status === "VIEWED";
  const soon = quote.daysToExpiry <= 2;
  return (
    <Link
      href={`/devis/${quote.id}`}
      className={`block p-3 text-sm hover:bg-surface-2 lg:grid lg:items-center lg:gap-3 lg:px-4 lg:py-2.5 ${COLS}`}
    >
      <span className="flex items-baseline justify-between gap-3 lg:block">
        <span className="font-mono text-[13px] font-semibold">
          {quote.number}
          {quote.version > 1 ? ` v${quote.version}` : ""}
        </span>
        <span className="font-semibold tabular-nums lg:hidden">{formatFCFA(quote.total)}</span>
      </span>

      <span className="mt-1 min-w-0 lg:mt-0">
        <span className="block font-medium leading-snug">{quote.customer.displayName}</span>
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted">
          {quote.vehicle ? (
            <>
              <PlateBadge plate={quote.vehicle.plate} />
              <span className="truncate">
                {quote.vehicle.make} {quote.vehicle.model}
              </span>
            </>
          ) : (
            <span>{t("list.noVehicle")}</span>
          )}
        </span>
      </span>

      <span className="mt-1 text-xs text-muted lg:mt-0 lg:text-sm lg:leading-snug">
        {t(`origin.${quote.origin}`)}
        <span className="lg:hidden"> · {formatDay(quote.createdAt, timeZone)}</span>
      </span>
      {quote.advisor && (
        <span className="mt-0.5 block text-xs text-muted lg:hidden">{quote.advisor}</span>
      )}

      <span className="hidden text-xs text-muted lg:block">
        <span className="block text-sm text-fg">{formatDay(quote.createdAt, timeZone)}</span>
        <span className="mt-0.5 block text-[11px]" title={t("list.columns.lastAction")}>
          {formatDateTime(quote.lastAction, timeZone)}
        </span>
      </span>

      <span className="mt-1.5 flex flex-col items-start gap-1 lg:mt-0">
        <span className="flex flex-wrap items-center gap-1">
          <QuoteStatusBadge status={quote.status} />
          {quote.discountApprovalStatus === "PENDING" && (
            <span className="text-xs font-semibold text-status-warn">
              ⚠ {t("discount.pendingShort")}
            </span>
          )}
        </span>
        {waiting && (
          <span
            className={`text-[11px] leading-snug ${soon ? "font-medium text-status-warn" : "text-muted"}`}
          >
            {quote.viewedAt ? `👁 ${t("list.viewed")}` : t("list.notViewed")}
            {" · "}
            {t("list.followups", { count: quote.followupsSent })}
            {" · "}
            {quote.daysToExpiry >= 0
              ? t("list.expiresIn", { days: quote.daysToExpiry })
              : t("status.EXPIRED")}
          </span>
        )}
      </span>

      <span className="hidden text-xs leading-snug text-muted lg:block">
        {quote.advisor ?? "—"}
      </span>

      <span className="hidden font-semibold tabular-nums lg:block lg:text-right">
        {formatFCFA(quote.total)}
      </span>
      <span
        className={`tabular-nums lg:text-right ${
          quote.acceptedTotal > 0
            ? "mt-1 block text-xs font-medium text-status-ok lg:mt-0 lg:text-sm"
            : "hidden text-muted lg:block"
        }`}
      >
        {quote.acceptedTotal > 0 ? formatFCFA(quote.acceptedTotal) : "—"}
      </span>
    </Link>
  );
}
