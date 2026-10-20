"use client";

// M17 US-M17-03 / §7 — « Proposer un devis » sur la fiche OR : panneau des lignes proposées
// (justification, case à cocher par ligne), « Créer le brouillon » après validation humaine.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import { Button, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { tAi } from "./i18n";

export function QuoteDraftPanel({ repairOrderId }: { repairOrderId: string }) {
  const router = useRouter();
  const status = trpc.ai.status.useQuery(undefined, { staleTime: 60_000 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const draft = trpc.ai.draftQuote.useMutation({
    onSuccess: (r) => {
      setError(null);
      setSelected(new Set(r.lines.map((l) => l.key)));
    },
    onError: (e) => setError(e.message || tAi("draft.error")),
  });
  const accept = trpc.ai.suggestion.accept.useMutation({
    onSuccess: (r) => {
      const quoteId = (r as { quoteId?: string }).quoteId;
      if (quoteId) router.push(`/devis/${quoteId}`);
    },
    onError: (e) => setError(e.message),
  });
  const dismiss = trpc.ai.suggestion.dismiss.useMutation({ onSuccess: () => draft.reset() });

  const availability = status.data?.quote_draft;
  const unavailable = availability && !availability.available ? availability.reason : null;
  const data = draft.data;

  return (
    <section className="flex flex-col gap-2" aria-label={tAi("draft.title")}>
      {!data && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="min-h-11"
            loading={draft.isPending}
            disabled={Boolean(unavailable)}
            title={unavailable ? tAi("unavailable", { reason: unavailable }) : undefined}
            onClick={() => draft.mutate({ repairOrderId })}
          >
            ✨ {tAi("draft.button")}
          </Button>
          {unavailable && (
            <span className="text-xs text-muted">
              {tAi("unavailable", { reason: unavailable })}
            </span>
          )}
        </div>
      )}
      {draft.isPending && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3" aria-busy="true">
          <p className="text-sm text-muted">{tAi("preparing")}</p>
          <div className="h-4 w-3/4 animate-pulse rounded bg-border" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-border" />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
      )}
      {data && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
          data-testid="ai-quote-draft"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{tAi("draft.title")}</h3>
            <StatusBadge tone="off" label={`✨ ${tAi("proposedBy")}`} />
          </div>
          <p className="text-xs text-muted">{tAi("draft.intro")}</p>
          {data.fallbackReason && (
            <p className="text-xs text-status-warn">
              ⚠ {tAi("fallback", { reason: data.fallbackReason })}
            </p>
          )}
          {!data.compatibilityChecked && (
            <p className="text-xs text-status-warn">⚠ {tAi("draft.compatibilityUnchecked")}</p>
          )}
          {data.rejected > 0 && (
            <p className="text-xs text-muted">{tAi("draft.rejected", { count: data.rejected })}</p>
          )}
          {data.lines.length === 0 ? (
            <p className="text-sm text-muted">{tAi("draft.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.lines.map((line) => (
                <li key={line.key}>
                  <label className="flex min-h-11 cursor-pointer gap-3 rounded-md border border-border p-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0"
                      checked={selected.has(line.key)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(line.key);
                        else next.delete(line.key);
                        setSelected(next);
                      }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{line.description}</span>
                        {line.priority && (
                          <StatusBadge
                            tone={line.priority === "URGENT" ? "bad" : "warn"}
                            label={`${line.priority === "URGENT" ? "⚠" : "👁"} ${tAi(`draft.priority.${line.priority}`)}`}
                          />
                        )}
                        {line.optional && <StatusBadge tone="off" label={tAi("draft.optional")} />}
                        {line.toPrice && (
                          <StatusBadge tone="warn" label={`✎ ${tAi("draft.toPrice")}`} />
                        )}
                      </span>
                      <span className="text-xs text-muted">
                        {line.kind === "LABOR"
                          ? tAi("draft.hours", { value: String(line.quantity).replace(".", ",") })
                          : tAi("draft.quantity", {
                              value: String(line.quantity).replace(".", ","),
                            })}
                        {!line.toPrice &&
                          ` · ${tAi("draft.estimated", { amount: formatFCFA(line.estimatedSubtotal) })}`}
                      </span>
                      {line.reason && <span className="text-xs italic">{line.reason}</span>}
                      {line.toPrice && (
                        <span className="text-xs text-status-warn">{tAi("draft.toPriceHint")}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              loading={accept.isPending}
              disabled={selected.size === 0}
              onClick={() =>
                accept.mutate({
                  suggestionId: data.suggestionId,
                  editedPayload: { selectedKeys: [...selected] },
                })
              }
            >
              {tAi("draft.create")}
            </Button>
            <Button
              variant="secondary"
              className="min-h-11"
              loading={dismiss.isPending}
              onClick={() => dismiss.mutate({ suggestionId: data.suggestionId })}
            >
              {tAi("draft.dismiss")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
