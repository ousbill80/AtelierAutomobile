"use client";

// M08 §7 `/caisse/sessions` — historique des sessions, écarts, clôtures tardives ; validation
// de l'écart par le propriétaire (`cash:review`).
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, Modal, StatusBadge, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t, tc } from "@/components/billing/i18n";

export default function CashSessionsPage() {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const q = trpc.cash.sessions.useQuery({});
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const review = trpc.cash.review.useMutation({
    onSuccess: () => {
      setReviewing(null);
      setComment("");
      void q.refetch();
    },
  });
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4">
      <Link href="/caisse" className="text-sm text-accent">
        ← {t("back")}
      </Link>
      <h1 className="text-xl font-semibold">{tc("sessions.title")}</h1>
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError || !q.data ? (
        <ErrorBox onRetry={() => q.refetch()} message={t("loadError")} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title={tc("sessions.empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data.items.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{s.site}</span>
                <span>{formatDateTime(s.openedAt, q.data.timeZone)}</span>
                {!s.closedAt ? (
                  <StatusBadge tone="warn" label={tc("sessions.open")} />
                ) : s.reviewedAt ? (
                  <StatusBadge tone="ok" label={`✓ ${tc("sessions.reviewed")}`} />
                ) : (
                  <StatusBadge tone="off" label={tc("sessions.closed")} />
                )}
                {s.lateClose && <StatusBadge tone="bad" label={`⚠ ${tc("sessions.late")}`} />}
              </div>
              <span className="text-muted">
                {s.openedBy}
                {s.closedBy ? ` → ${s.closedBy}` : ""}
              </span>
              {s.closedAt && (
                <span>
                  {tc("expected")} {formatFCFA(s.expectedCash ?? 0)} · {tc("closeForm.counted")}{" "}
                  {formatFCFA(s.countedCash ?? 0)} ·{" "}
                  <strong className={s.difference ? "text-status-warn" : "text-status-ok"}>
                    {tc("sessions.difference")} {formatFCFA(s.difference ?? 0)}
                  </strong>
                </span>
              )}
              {s.notes && <span className="text-muted">« {s.notes} »</span>}
              {s.closedAt && !s.reviewedAt && perms.has("cash:review") && (
                <Button variant="secondary" size="sm" onClick={() => setReviewing(s.id)}>
                  {tc("sessions.review")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {reviewing && (
        <Modal
          open
          title={tc("sessions.review")}
          onClose={() => setReviewing(null)}
          footer={
            <Button
              loading={review.isPending}
              disabled={comment.trim().length < 3}
              onClick={() => review.mutate({ id: reviewing, comment })}
            >
              {tc("sessions.review")}
            </Button>
          }
        >
          <label className="flex flex-col gap-1 text-sm">
            {tc("sessions.reviewComment")}
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
          </label>
          {review.error && (
            <p role="alert" className="text-sm text-status-bad">
              ⚠ {review.error.message}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
