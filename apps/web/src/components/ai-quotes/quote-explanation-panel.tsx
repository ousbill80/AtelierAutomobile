"use client";

// M17 US-M17-04 / §7 — « Générer l'explication client » sur le devis : 2 phrases max par
// groupe, éditables ; seule la version validée est enregistrée et affichée sur le portail.
import { useState } from "react";
import { Button, StatusBadge, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { tAi } from "./i18n";

export function QuoteExplanationPanel({
  quoteId,
  validated,
  canGenerate,
  onSaved,
}: {
  quoteId: string;
  validated: Record<string, string> | null;
  canGenerate: boolean;
  onSaved: () => void;
}) {
  const status = trpc.ai.status.useQuery(undefined, { staleTime: 60_000, enabled: canGenerate });
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const explain = trpc.ai.explainQuote.useMutation({
    onSuccess: (r) => {
      setError(null);
      setSaved(false);
      setTexts(Object.fromEntries(r.groups.map((g) => [g.key, g.text])));
    },
    onError: (e) => setError(e.message || tAi("explanation.error")),
  });
  const accept = trpc.ai.suggestion.accept.useMutation({
    onSuccess: () => {
      explain.reset();
      setSaved(true);
      onSaved();
    },
    onError: (e) => setError(e.message),
  });
  const dismiss = trpc.ai.suggestion.dismiss.useMutation({ onSuccess: () => explain.reset() });
  const availability = status.data?.quote_explanation;
  const unavailable = availability && !availability.available ? availability.reason : null;
  const data = explain.data;
  const current = validated ? Object.values(validated).filter(Boolean) : [];

  return (
    <section className="flex flex-col gap-2" aria-label={tAi("explanation.title")}>
      {current.length > 0 && !data && (
        <div
          className="rounded-md border border-border p-2 text-sm"
          data-testid="ai-explanation-current"
        >
          <p className="text-xs text-muted">✓ {tAi("explanation.current")}</p>
          <ul className="list-disc pl-5">
            {current.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {saved && (
        <p role="status" className="text-sm text-status-ok">
          ✓ {tAi("explanation.saved")}
        </p>
      )}
      {canGenerate && !data && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="min-h-11"
            loading={explain.isPending}
            disabled={Boolean(unavailable)}
            title={unavailable ? tAi("unavailable", { reason: unavailable }) : undefined}
            onClick={() => explain.mutate({ quoteId })}
          >
            ✨ {tAi("explanation.button")}
          </Button>
          {unavailable && (
            <span className="text-xs text-muted">
              {tAi("unavailable", { reason: unavailable })}
            </span>
          )}
        </div>
      )}
      {explain.isPending && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3" aria-busy="true">
          <p className="text-sm text-muted">{tAi("preparing")}</p>
          <div className="h-4 w-3/4 animate-pulse rounded bg-border" />
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
          data-testid="ai-explanation"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{tAi("explanation.title")}</h3>
            <StatusBadge tone="off" label={`✨ ${tAi("proposedBy")}`} />
          </div>
          <p className="text-xs text-muted">{tAi("explanation.intro")}</p>
          {data.fallbackReason && (
            <p className="text-xs text-status-warn">⚠ {data.fallbackReason}</p>
          )}
          {data.groups.map((g) => (
            <label key={g.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{g.label}</span>
              <Textarea
                rows={3}
                value={texts[g.key] ?? ""}
                maxLength={600}
                onChange={(e) => setTexts({ ...texts, [g.key]: e.target.value })}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              loading={accept.isPending}
              onClick={() =>
                accept.mutate({
                  suggestionId: data.suggestionId,
                  editedPayload: {
                    groups: data.groups.map((g) => ({ key: g.key, text: texts[g.key] ?? "" })),
                  },
                })
              }
            >
              {tAi("explanation.validate")}
            </Button>
            <Button
              variant="secondary"
              className="min-h-11"
              loading={dismiss.isPending}
              onClick={() => dismiss.mutate({ suggestionId: data.suggestionId })}
            >
              {tAi("explanation.dismiss")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
