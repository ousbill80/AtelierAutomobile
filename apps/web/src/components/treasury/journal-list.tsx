"use client";

// M18 — liste du grand livre (journal global et détail d'un compte) : totaux de la sélection,
// pagination, lien vers la source, contre-passation des mouvements manuels et virements.
import { useState } from "react";
import { ExternalLink, List, Undo2 } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { signedFCFA } from "@/components/cash/cash-ui";
import { tt } from "./i18n";
import { ReverseModal, SignedAmount } from "./treasury-ui";
import type { TreasuryJournalInput } from "./types";

export function JournalList({
  input,
  showAccount,
}: {
  input: TreasuryJournalInput;
  showAccount: boolean;
}) {
  const me = trpc.me.get.useQuery();
  const canManage = (me.data?.permissions ?? []).includes("treasury:manage");
  const utils = trpc.useUtils();
  const [reversing, setReversing] = useState<{ id: string; label: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const q = trpc.treasury.journal.useInfiniteQuery(
    { ...input, limit: 30 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  if (q.isLoading) return <ListSkeleton rows={5} />;
  if (q.isError || !q.data)
    return <ErrorBox onRetry={() => q.refetch()} message={tt("loadError")} />;
  const first = q.data.pages[0]!;
  const items = q.data.pages.flatMap((p) => p.items);
  const net = first.totals.inflow - first.totals.outflow;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-status-ok bg-status-ok-bg p-3 text-sm text-status-ok"
        >
          {notice}
        </p>
      )}
      <div
        className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
        data-testid="journal-totals"
      >
        <span className="text-muted">{tt("journal.count", { count: first.totals.count })}</span>
        <span>
          {tt("journal.totalIn")}{" "}
          <strong className="text-status-ok tabular-nums">
            +{formatFCFA(first.totals.inflow)}
          </strong>
        </span>
        <span>
          {tt("journal.totalOut")}{" "}
          <strong className="tabular-nums">−{formatFCFA(first.totals.outflow)}</strong>
        </span>
        <span>
          {tt("journal.net")} <strong className="tabular-nums">{signedFCFA(net)}</strong>
        </span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface">
          <EmptyState icon={<List size={28} aria-hidden />} title={tt("journal.empty")} />
        </div>
      ) : (
        <ul
          className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface"
          data-testid="treasury-journal"
        >
          {items.map((m) => (
            <li key={m.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="min-w-0 break-words">{m.label}</span>
                  {m.isReversal && <span className="pill pill-off">{tt("journal.reversal")}</span>}
                  {m.reversed && <span className="pill pill-off">{tt("journal.reversed")}</span>}
                </span>
                <span className="text-xs text-muted">
                  {formatDateTime(m.occurredAt, first.timeZone)}
                  {showAccount ? ` · ${m.account}` : ""} · {tt(`kinds.${m.kind}`)}
                  {m.categoryLabel ? ` · ${m.categoryLabel}` : ""}
                  {m.reference ? ` · ${m.reference}` : ""}
                </span>
                {(m.href || (canManage && m.reversible)) && (
                  <span className="mt-1 flex flex-wrap items-center gap-3">
                    {m.href && (
                      <a
                        href={m.href}
                        target={m.href.startsWith("/api/") ? "_blank" : undefined}
                        rel="noreferrer"
                        className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-accent hover:underline"
                      >
                        <ExternalLink size={13} aria-hidden /> {tt("journal.source")}
                      </a>
                    )}
                    {canManage && m.reversible && (
                      <button
                        type="button"
                        onClick={() => setReversing({ id: m.id, label: m.label })}
                        className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-muted hover:text-status-bad"
                      >
                        <Undo2 size={13} aria-hidden /> {tt("actions.reverse")}
                      </button>
                    )}
                  </span>
                )}
              </div>
              <SignedAmount direction={m.direction} amount={m.amount} muted={m.reversed} />
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
          {tt("journal.loadMore")}
        </Button>
      )}
      {reversing && (
        <ReverseModal
          movementId={reversing.id}
          label={reversing.label}
          onClose={() => setReversing(null)}
          onDone={(text) => {
            setReversing(null);
            setNotice(text);
            void utils.treasury.invalidate();
          }}
        />
      )}
    </div>
  );
}
