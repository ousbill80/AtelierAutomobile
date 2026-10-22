"use client";

// M08 `/caisse/sessions/[id]` — détail d'une session : statut, totaux par mode (figés à la
// clôture), calcul des espèces, comptage par coupures, écart et validation, journal ; Z de
// caisse (PDF) et validation de l'écart (`cash:review`).
import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, FileText, Lock, LockOpen, TriangleAlert } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime, formatDay } from "@/components/repair-orders/i18n";
import { t, tc } from "@/components/billing/i18n";
import {
  AmountRow,
  CashJournal,
  MethodTotals,
  ReviewModal,
  Section,
  differenceTone,
  timeOf,
} from "@/components/cash/cash-ui";

export default function CashSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const q = trpc.cash.session.useQuery({ id });
  const utils = trpc.useUtils();
  const [reviewing, setReviewing] = useState(false);

  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.isError || !q.data)
    return (
      <ErrorBox
        onRetry={() => q.refetch()}
        message={q.error?.data?.code === "NOT_FOUND" ? tc("detail.notFound") : t("loadError")}
      />
    );
  const s = q.data;
  const tz = s.timeZone;
  const closing = s.closing;
  const byMethod = closing?.byMethod ?? s.summary.byMethod;
  const tone = differenceTone(s.difference);
  const denominations = Object.entries((s.denominations ?? {}) as Record<string, number>)
    .map(([value, count]) => ({ value: Number(value), count }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pb-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/caisse/sessions"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={16} aria-hidden /> {tc("detail.back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">
              {tc("detail.title", { date: formatDay(s.openedAt, tz) })}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {s.site} ·{" "}
              {tc("detail.openedBy", { name: s.openedByName, time: timeOf(s.openedAt, tz) })}
              {s.closedAt && s.closedByName
                ? ` · ${tc("detail.closedBy", { name: s.closedByName, date: formatDateTime(s.closedAt, tz) })}`
                : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {!s.closedAt ? (
                <span className="pill pill-ok">
                  <LockOpen size={12} aria-hidden /> {tc("detail.notClosed")}
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
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/caisse/sessions/${s.id}/z`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary min-h-11"
            >
              <FileText size={16} aria-hidden /> {tc("sessions.z")}
            </a>
            {s.closedAt && !s.reviewedAt && perms.has("cash:review") && (
              <Button className="min-h-11" onClick={() => setReviewing(true)}>
                {tc("sessions.review")}
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-3">
        <Section title={tc("detail.byMethod")}>
          <MethodTotals byMethod={byMethod} emptyLabel={t("payments.empty")} />
          {closing && <p className="mt-2 text-xs text-muted">{tc("detail.frozen")}</p>}
        </Section>
        <Section title={tc("detail.cash")}>
          <AmountRow label={tc("float")} amount={s.openingFloat} />
          <AmountRow
            label={`+ ${tc("cashIn")}`}
            amount={closing?.cashPayments ?? s.summary.cashPayments}
          />
          <AmountRow
            label={`− ${tc("expenses")}`}
            amount={closing?.expensesTotal ?? s.summary.expensesTotal}
          />
          <AmountRow
            label={`− ${tc("refunds")}`}
            amount={closing?.cashRefunds ?? s.summary.cashRefunds}
          />
          <AmountRow
            label={`− ${tc("drops")}`}
            amount={closing?.dropsTotal ?? s.summary.dropsTotal}
          />
          <AmountRow
            label={tc("expected")}
            amount={s.expectedCash ?? s.summary.expectedCash}
            strong
          />
          {s.countedCash !== null && (
            <AmountRow label={tc("detail.counted")} amount={s.countedCash} />
          )}
          {s.difference !== null && (
            <AmountRow
              label={tc("detail.difference")}
              amount={s.difference}
              tone={tone}
              strong
              signed
              testId="session-difference"
            />
          )}
        </Section>
        <Section title={tc("detail.review")}>
          {s.notes && (
            <div className="mb-3 flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted">{tc("detail.notes")}</span>
              <span>« {s.notes} »</span>
            </div>
          )}
          {s.reviewedAt ? (
            <p className="flex items-start gap-2 text-sm text-status-ok">
              <CircleCheck size={16} aria-hidden className="mt-0.5 shrink-0" />
              <span>
                {tc("detail.reviewBy", {
                  name: s.reviewedByName ?? "—",
                  date: formatDateTime(s.reviewedAt, tz),
                })}
                {s.reviewComment ? ` — « ${s.reviewComment} »` : ""}
              </span>
            </p>
          ) : s.closedAt ? (
            <p className="text-sm text-muted">{tc("detail.reviewPending")}</p>
          ) : (
            <p className="text-sm text-muted">{tc("detail.notClosed")}</p>
          )}
          {denominations.length > 0 && (
            <div className="mt-4 flex flex-col">
              <span className="mb-1 text-xs text-muted">{tc("detail.denominations")}</span>
              {denominations.map((d) => (
                <div key={d.value} className="flex justify-between py-1 text-sm">
                  <span>
                    {d.count} × {formatFCFA(d.value)}
                  </span>
                  <span className="tabular-nums">{formatFCFA(d.value * d.count)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <CashJournal session={s.summary} timeZone={tz} />

      {reviewing && (
        <ReviewModal
          id={s.id}
          onClose={() => setReviewing(false)}
          onDone={() => {
            setReviewing(false);
            void utils.cash.invalidate();
          }}
        />
      )}
    </div>
  );
}
