"use client";

// M05 US-M05-14 — taux d'acceptation (nombre et valeur), délai médian, par conseiller,
// par priorité, motifs de refus, montant récupéré grâce aux relances (RG-M05-16).
import { useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Input } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/quotes/i18n";

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function pct(value: number | null) {
  return value == null ? "—" : `${value.toLocaleString("fr-FR")} %`;
}

export function QuoteStats() {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 30 * 86_400_000)));
  const [to, setTo] = useState(iso(today));
  const stats = trpc.quote.stats.useQuery({
    from: new Date(`${from}T00:00:00Z`),
    to: new Date(`${to}T23:59:59Z`),
  });
  return (
    <section className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Input
          type="date"
          label={t("stats.from")}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          type="date"
          label={t("stats.to")}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      {stats.isLoading ? (
        <ListSkeleton rows={2} />
      ) : stats.isError || !stats.data ? (
        <ErrorBox onRetry={() => stats.refetch()} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              [t("stats.sent"), String(stats.data.sent)],
              [t("stats.rateCount"), pct(stats.data.rateCount)],
              [t("stats.rateValue"), pct(stats.data.rateValue)],
              [
                t("stats.median"),
                stats.data.medianDecisionHours == null
                  ? "—"
                  : t("stats.hours", { hours: Math.round(stats.data.medianDecisionHours) }),
              ],
              [t("stats.proposed"), formatFCFA(stats.data.proposedAmount)],
              [t("stats.acceptedAmount"), formatFCFA(stats.data.acceptedAmount)],
              [t("stats.recovered"), formatFCFA(stats.data.recoveredByFollowups)],
              [t("stats.closed"), String(stats.data.closed)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-surface p-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <h2 className="font-semibold">{t("stats.byAdvisor")}</h2>
          <ul className="flex flex-col gap-1">
            {stats.data.byAdvisor.map((a) => (
              <li
                key={a.advisorId ?? "none"}
                className="flex justify-between rounded-md bg-surface p-2"
              >
                <span>{a.name ?? "—"}</span>
                <span>
                  {a.accepted}/{a.closed} · {pct(a.rateCount)}
                </span>
              </li>
            ))}
          </ul>
          <h2 className="font-semibold">{t("stats.byPriority")}</h2>
          <ul className="flex flex-col gap-1">
            {stats.data.byPriority.map((p) => (
              <li key={p.priority} className="flex justify-between rounded-md bg-surface p-2">
                <span>{t(`priority.${p.priority}`)}</span>
                <span>
                  {p.accepted}/{p.proposed}
                </span>
              </li>
            ))}
          </ul>
          {stats.data.declineReasons.length > 0 && (
            <>
              <h2 className="font-semibold">{t("stats.declineReasons")}</h2>
              <ul className="flex flex-col gap-1">
                {stats.data.declineReasons.map((r) => (
                  <li key={r.reason} className="flex justify-between rounded-md bg-surface p-2">
                    <span>{t(`declineReasons.${r.reason}`)}</span>
                    <span>{r.count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
