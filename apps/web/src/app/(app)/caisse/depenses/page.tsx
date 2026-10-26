"use client";

// M08 `/caisse/depenses` — dépenses de caisse : onglets par statut (en attente d'abord pour le
// gérant), filtres catégorie et période, totaux par catégorie, justificatifs ; décision du
// gérant (`cash:expense_approve`) sur les dépenses en attente (RG-M08-30).
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, HandCoins, Paperclip, X } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t, tc } from "@/components/billing/i18n";
import {
  ExpenseDecisionModal,
  ExpenseStatusBadge,
  Section,
  type ExpenseStatus,
} from "@/components/cash/cash-ui";

type Tab = ExpenseStatus | "ALL";
const TABS: Tab[] = ["PENDING", "APPROVED", "REJECTED", "ALL"];

export default function CashExpensesPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <CashExpenses />
    </Suspense>
  );
}

function CashExpenses() {
  const router = useRouter();
  const params = useSearchParams();
  const me = trpc.me.get.useQuery();
  const canApprove = (me.data?.permissions ?? []).includes("cash:expense_approve");
  const initial = params.get("status");
  const [tab, setTab] = useState<Tab>(
    initial && TABS.includes(initial as Tab) ? (initial as Tab) : "ALL",
  );
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [decision, setDecision] = useState<{ id: string; decision: "approve" | "reject" } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const input = {
    status: tab === "ALL" ? undefined : tab,
    category: category || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: 30,
  };
  const q = trpc.cash.expenses.useInfiniteQuery(input, {
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(category || from || to);

  const selectTab = (next: Tab) => {
    setTab(next);
    router.replace(next === "ALL" ? "/caisse/depenses" : `/caisse/depenses?status=${next}`, {
      scroll: false,
    });
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pb-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/caisse"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={16} aria-hidden /> {tc("title")}
        </Link>
        <h1 className="text-2xl font-semibold">{tc("expensesPage.title")}</h1>
        <p className="text-sm text-muted">{tc("expensesPage.subtitle")}</p>
      </header>

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-status-ok bg-status-ok-bg p-3 text-sm text-status-ok"
        >
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1 self-start" role="tablist">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => selectTab(k)}
              className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
                tab === k
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {tc(`expensesPage.tabs.${k}`)}
              {k === "PENDING" && (first?.pendingCount ?? 0) > 0 && (
                <span className="rounded-full bg-status-warn px-1.5 text-xs leading-5 font-semibold text-white">
                  {first?.pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">
            <span className="font-medium">{tc("expensesPage.category")}</span>
            <select
              className="h-11 rounded-md border border-border bg-surface pr-9 pl-3 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">{tc("expensesPage.allCategories")}</option>
              {(first?.categories ?? []).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{tc("expensesPage.from")}</span>
            <input
              type="date"
              className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{tc("expensesPage.to")}</span>
            <input
              type="date"
              className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {filtered && (
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setCategory("");
                setFrom("");
                setTo("");
              }}
            >
              <X size={16} aria-hidden /> {tc("expensesPage.reset")}
            </Button>
          )}
        </div>
      </div>

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError || !first ? (
        <ErrorBox onRetry={() => q.refetch()} message={t("loadError")} />
      ) : (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          <div className="flex min-w-0 flex-col gap-2">
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-surface">
                <EmptyState
                  icon={<HandCoins size={28} aria-hidden />}
                  title={
                    tab === "PENDING" ? tc("expensesPage.emptyPending") : tc("expensesPage.empty")
                  }
                />
              </div>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="expense-list">
                {items.map((e) => (
                  <li
                    key={e.id}
                    className={`flex flex-wrap items-start gap-3 rounded-lg border bg-surface p-4 ${
                      e.status === "PENDING" ? "border-status-warn" : "border-border"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{e.category}</span>
                        <ExpenseStatusBadge status={e.status} />
                        {e.sessionClosed && (
                          <span className="pill pill-off">{tc("expensesPage.closedSession")}</span>
                        )}
                      </span>
                      <span className="text-sm break-words">{e.description}</span>
                      <span className="text-xs text-muted">
                        {formatDateTime(e.paidAt, first.timeZone)} · {e.site}
                        {e.createdByName
                          ? ` · ${tc("expensesPage.createdBy", { name: e.createdByName })}`
                          : ""}
                      </span>
                      {(e.approvedByName || e.rejectedByName) && e.status !== "PENDING" && (
                        <span className="text-xs text-muted">
                          {tc("expensesPage.decidedBy", {
                            status: tc(`status.${e.status}`),
                            name:
                              (e.status === "REJECTED" ? e.rejectedByName : e.approvedByName) ??
                              "—",
                          })}
                          {e.decisionComment ? ` — « ${e.decisionComment} »` : ""}
                        </span>
                      )}
                      {e.receiptUrl && (
                        <a
                          href={e.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-9 items-center gap-1 self-start text-xs font-medium text-accent hover:underline"
                        >
                          <Paperclip size={13} aria-hidden /> {tc("journal.proof")}
                        </a>
                      )}
                    </div>
                    <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end">
                      <span
                        className={`text-base font-semibold tabular-nums ${
                          e.status === "REJECTED" ? "text-muted line-through" : ""
                        }`}
                      >
                        {formatFCFA(e.amount)}
                      </span>
                      {canApprove && e.status === "PENDING" && !e.sessionClosed && (
                        <span className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-11"
                            onClick={() => setDecision({ id: e.id, decision: "reject" })}
                          >
                            {tc("expensesPage.reject")}
                          </Button>
                          <Button
                            size="sm"
                            className="min-h-11"
                            onClick={() => setDecision({ id: e.id, decision: "approve" })}
                          >
                            {tc("expensesPage.approve")}
                          </Button>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {q.hasNextPage && (
              <Button
                variant="secondary"
                className="min-h-11 self-center"
                loading={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {tc("expensesPage.loadMore")}
              </Button>
            )}
          </div>
          <Section title={tc("expensesPage.byCategory")}>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                {first.totalStatus === "PENDING"
                  ? tc("expensesPage.totalPending")
                  : first.totalStatus === "REJECTED"
                    ? tc("expensesPage.totalRejected")
                    : tc("expensesPage.total")}
              </span>
              <span className="text-2xl font-semibold tabular-nums" data-testid="expenses-total">
                {formatFCFA(first.total)}
              </span>
            </div>
            {first.byCategory.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {first.byCategory.map((c) => {
                  const share = first.total > 0 ? Math.round((c.amount / first.total) * 100) : 0;
                  return (
                    <li key={c.category} className="flex flex-col gap-1">
                      <span className="flex items-baseline justify-between gap-3 text-sm">
                        <span>
                          {c.category} <span className="text-muted">({c.count})</span>
                        </span>
                        <span className="font-medium tabular-nums">{formatFCFA(c.amount)}</span>
                      </span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${share}%` }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      )}

      {decision && (
        <ExpenseDecisionModal
          expenseId={decision.id}
          decision={decision.decision}
          onClose={() => setDecision(null)}
          onDone={(d) => {
            setDecision(null);
            setNotice(d === "approve" ? tc("expensesPage.approved") : tc("expensesPage.rejected"));
            void utils.cash.invalidate();
          }}
        />
      )}
    </div>
  );
}
