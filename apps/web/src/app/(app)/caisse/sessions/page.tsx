"use client";

// M08 §7 `/caisse/sessions` — historique filtrable des sessions (période, statut, caissier) :
// synthèse de la sélection, écarts par caissier (M08 §11), Z de caisse, validation de l'écart
// par le propriétaire (`cash:review`).
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clock,
  FileText,
  Lock,
  LockOpen,
  Scale,
  TriangleAlert,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t, tc } from "@/components/billing/i18n";
import { Kpi, ReviewModal, Section, differenceTone, signedFCFA } from "@/components/cash/cash-ui";

const STATUSES = ["", "open", "to_review", "variance", "reviewed", "late"] as const;
type StatusFilter = (typeof STATUSES)[number];

export default function CashSessionsPage() {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const [status, setStatus] = useState<StatusFilter>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cashier, setCashier] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const q = trpc.cash.sessions.useInfiniteQuery(
    {
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
      openedById: cashier || undefined,
      limit: 30,
    },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(status || from || to || cashier);

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pb-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/caisse"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={16} aria-hidden /> {tc("title")}
        </Link>
        <h1 className="text-2xl font-semibold">{tc("sessions.title")}</h1>
        <p className="text-sm text-muted">{tc("sessions.subtitle")}</p>
      </header>

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-status-ok bg-status-ok-bg p-3 text-sm text-status-ok"
        >
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{tc("sessions.filters.status")}</span>
          <select
            className="h-11 rounded-md border border-border bg-surface pr-9 pl-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tc(`sessions.filters.${s || "all"}`)}
              </option>
            ))}
          </select>
        </label>
        {(first?.cashiers.length ?? 0) > 1 && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{tc("sessions.filters.cashier")}</span>
            <select
              className="h-11 rounded-md border border-border bg-surface pr-9 pl-3 text-sm"
              value={cashier}
              onChange={(e) => setCashier(e.target.value)}
            >
              <option value="">{tc("sessions.filters.allCashiers")}</option>
              {first?.cashiers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
              setStatus("");
              setFrom("");
              setTo("");
              setCashier("");
            }}
          >
            <X size={16} aria-hidden /> {tc("expensesPage.reset")}
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError || !first ? (
        <ErrorBox onRetry={() => q.refetch()} message={t("loadError")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              icon={CalendarDays}
              label={tc("sessions.kpi.sessions")}
              value={String(first.totals.sessions)}
            />
            <Kpi
              icon={TriangleAlert}
              label={tc("sessions.kpi.withVariance")}
              value={String(first.totals.withVariance)}
              tone={first.totals.withVariance > 0 ? "warn" : "neutral"}
            />
            <Kpi
              icon={Scale}
              label={tc("sessions.kpi.net")}
              value={signedFCFA(first.totals.netDifference)}
              tone={differenceTone(first.totals.netDifference)}
            />
            <Kpi
              icon={Clock}
              label={tc("sessions.kpi.toReview")}
              value={String(first.toReview)}
              tone={first.toReview > 0 ? "bad" : "neutral"}
            />
          </div>

          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
            <div className="flex min-w-0 flex-col gap-2">
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface">
                  <EmptyState icon={<Lock size={28} aria-hidden />} title={tc("sessions.empty")} />
                </div>
              ) : (
                <ul className="flex flex-col gap-2" data-testid="session-list">
                  {items.map((s) => {
                    const tone = differenceTone(s.difference);
                    return (
                      <li
                        key={s.id}
                        className={`flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-4 ${
                          s.closedAt && !s.reviewedAt && s.difference
                            ? "border-status-warn"
                            : "border-border"
                        }`}
                      >
                        <Link
                          href={`/caisse/sessions/${s.id}`}
                          className="group flex min-w-0 basis-full items-center gap-3"
                        >
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                              s.closedAt ? "bg-surface-2" : "bg-status-ok-bg text-status-ok"
                            }`}
                          >
                            {s.closedAt ? (
                              <Lock size={17} aria-hidden />
                            ) : (
                              <LockOpen size={17} aria-hidden />
                            )}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="flex flex-wrap items-center gap-x-2 font-semibold">
                              {formatDateTime(s.openedAt, first.timeZone)}
                              <span className="font-normal text-muted">{s.site}</span>
                            </span>
                            <span className="text-sm text-muted">
                              {s.openedBy}
                              {s.closedBy && s.closedBy !== s.openedBy ? ` → ${s.closedBy}` : ""}
                            </span>
                            <span className="flex flex-wrap gap-1.5">
                              {!s.closedAt ? (
                                <span className="pill pill-ok">
                                  <LockOpen size={12} aria-hidden /> {tc("sessions.open")}
                                </span>
                              ) : s.reviewedAt ? (
                                <span className="pill pill-ok">
                                  <CircleCheck size={12} aria-hidden /> {tc("sessions.reviewed")}
                                </span>
                              ) : (
                                <span className="pill pill-off">
                                  <Lock size={12} aria-hidden /> {tc("sessions.closed")}
                                </span>
                              )}
                              {s.lateClose && (
                                <span className="pill pill-bad">
                                  <TriangleAlert size={12} aria-hidden /> {tc("sessions.late")}
                                </span>
                              )}
                            </span>
                          </span>
                          <ChevronRight
                            size={18}
                            aria-hidden
                            className="shrink-0 text-muted group-hover:text-accent"
                          />
                        </Link>
                        {s.closedAt && (
                          <dl className="grid min-w-0 basis-full grid-cols-3 gap-x-4 gap-y-0.5 text-sm whitespace-nowrap sm:max-w-md sm:flex-1 sm:basis-auto">
                            <dt className="text-xs text-muted">{tc("sessions.received")}</dt>
                            <dt className="text-xs text-muted">{tc("sessions.counted")}</dt>
                            <dt className="text-xs text-muted">{tc("sessions.difference")}</dt>
                            <dd className="tabular-nums">
                              {s.totalReceived !== null ? formatFCFA(s.totalReceived) : "—"}
                            </dd>
                            <dd className="tabular-nums">{formatFCFA(s.countedCash ?? 0)}</dd>
                            <dd
                              className={`font-semibold tabular-nums ${
                                tone === "ok"
                                  ? "text-status-ok"
                                  : tone === "bad"
                                    ? "text-status-bad"
                                    : "text-status-warn"
                              }`}
                            >
                              {s.difference === 0
                                ? tc("sessions.noVariance")
                                : signedFCFA(s.difference ?? 0)}
                            </dd>
                          </dl>
                        )}
                        <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
                          {s.closedAt && (
                            <a
                              href={`/api/caisse/sessions/${s.id}/z`}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-secondary btn-sm min-h-11"
                            >
                              <FileText size={14} aria-hidden /> {tc("sessions.z")}
                            </a>
                          )}
                          {s.closedAt && !s.reviewedAt && perms.has("cash:review") && (
                            <Button
                              size="sm"
                              className="min-h-11"
                              onClick={() => setReviewing(s.id)}
                            >
                              {tc("sessions.review")}
                            </Button>
                          )}
                        </span>
                        {s.notes && <p className="w-full text-sm text-muted">« {s.notes} »</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {q.hasNextPage && (
                <Button
                  variant="secondary"
                  className="min-h-11 self-center"
                  loading={q.isFetchingNextPage}
                  onClick={() => void q.fetchNextPage()}
                >
                  {tc("sessions.loadMore")}
                </Button>
              )}
            </div>

            {first.byCashier.length > 0 && (
              <Section title={tc("sessions.byCashier")}>
                <p className="mb-3 text-xs text-muted">{tc("sessions.byCashierHint")}</p>
                <div className="-mx-4 overflow-x-auto px-4">
                  <table className="w-full min-w-[340px] text-sm" data-testid="variance-by-cashier">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="py-2 pr-2 font-medium">{tc("sessions.cashierCols.name")}</th>
                        <th className="py-2 pr-2 text-right font-medium whitespace-nowrap">
                          {tc("sessions.cashierCols.withVariance")}
                        </th>
                        <th className="py-2 pr-2 text-right font-medium whitespace-nowrap">
                          {tc("sessions.cashierCols.net")}
                        </th>
                        <th className="py-2 text-right font-medium">
                          {tc("sessions.cashierCols.worst")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {first.byCashier.map((c) => (
                        <tr key={c.cashierId}>
                          <td className="py-2.5 pr-2 font-medium">{c.cashierName}</td>
                          <td className="py-2.5 pr-2 text-right tabular-nums">
                            {c.withVariance} / {c.sessions}
                          </td>
                          <td
                            className={`py-2.5 pr-2 text-right whitespace-nowrap tabular-nums ${
                              c.net < 0
                                ? "text-status-bad"
                                : c.net > 0
                                  ? "text-status-warn"
                                  : "text-status-ok"
                            }`}
                          >
                            {signedFCFA(c.net)}
                          </td>
                          <td className="py-2.5 text-right whitespace-nowrap tabular-nums">
                            {c.worstShortage < 0 ? signedFCFA(c.worstShortage) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
          </div>
        </>
      )}

      {reviewing && (
        <ReviewModal
          id={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            setNotice(tc("sessions.reviewDone"));
            void utils.cash.invalidate();
          }}
        />
      )}
    </div>
  );
}
