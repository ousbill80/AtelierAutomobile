"use client";

// M12 §7 — `/rapports` : grille des rapports accessibles (permission vérifiée côté serveur
// par `reports.catalog`) et accès à la comparaison des sites (≥ 2 sites, `dashboard:owner`).
import Link from "next/link";
import { EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { CardsSkeleton, ErrorState } from "../tableau-de-bord/parts";
import { R, reportText } from "./labels";

export default function RapportsPage() {
  const q = trpc.reports.catalog.useQuery();
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-20">
      <div>
        <h1 className="text-2xl font-semibold">{R.title}</h1>
        <p className="text-sm text-muted">{R.description}</p>
      </div>
      {q.isLoading ? (
        <CardsSkeleton />
      ) : q.isError || !q.data ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : q.data.reports.length === 0 && !q.data.compareSites ? (
        <EmptyState title={R.noAccess} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.reports.map((r) => {
            const text = reportText(r.slug);
            return (
              <li key={r.slug}>
                <Link
                  href={`/rapports/${r.slug}`}
                  className="flex min-h-24 flex-col gap-1 rounded-lg border border-border bg-surface p-4 hover:bg-surface-2"
                >
                  <span className="font-semibold">{text.title}</span>
                  <span className="text-sm text-muted">{text.description}</span>
                </Link>
              </li>
            );
          })}
          {q.data.compareSites && (
            <li>
              <Link
                href="/rapports/comparaison-sites"
                className="flex min-h-24 flex-col gap-1 rounded-lg border border-border bg-surface p-4 hover:bg-surface-2"
              >
                <span className="font-semibold">{R.compareSites}</span>
                <span className="text-sm text-muted">{R.compareSitesDescription}</span>
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
