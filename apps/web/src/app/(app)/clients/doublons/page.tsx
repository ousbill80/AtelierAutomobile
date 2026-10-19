"use client";

import { Button, EmptyState, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

export default function DuplicatesPage() {
  const utils = trpc.useUtils();
  const { data: pairs, isLoading } = trpc.customer.duplicates.list.useQuery();
  const dismiss = trpc.customer.duplicates.dismiss.useMutation({
    onSuccess: () => utils.customer.duplicates.list.invalidate(),
  });
  const mergeCustomers = trpc.customer.merge.useMutation({
    onSuccess: () => utils.customer.duplicates.list.invalidate(),
  });

  // Fusion rapide : la cible est toujours B, la source A — l'écran détaillé (choix champ par
  // champ, aperçu des documents déplacés) reste à construire ; voir le message de commit.
  function handleMerge(sourceId: string, targetId: string, sourceName: string) {
    const confirmName = window.prompt(
      `Pour confirmer la fusion, saisissez le nom du client absorbé : « ${sourceName} »`,
    );
    if (!confirmName) return;
    mergeCustomers.mutate({ sourceId, targetId, fieldChoices: {}, confirmName });
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Doublons suggérés</h1>

      {isLoading && <p className="text-sm text-muted">Chargement…</p>}

      {pairs && pairs.length === 0 && <EmptyState title="Aucun doublon détecté pour l'instant." />}

      {pairs && pairs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {pairs.map((pair) => (
            <li
              key={`${pair.customerIdA}:${pair.customerIdB}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
            >
              <div>
                <p className="font-medium">
                  {pair.displayNameA} ↔ {pair.displayNameB}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <StatusBadge tone={pair.score >= 80 ? "bad" : "warn"}>
                    Score {pair.score}
                  </StatusBadge>
                  {pair.reasons.map((reason) => (
                    <span key={reason} className="text-xs text-muted">
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleMerge(pair.customerIdA, pair.customerIdB, pair.displayNameA)}
                >
                  Fusionner
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    dismiss.mutate({ customerIdA: pair.customerIdA, customerIdB: pair.customerIdB })
                  }
                >
                  Ignorer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
