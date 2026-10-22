"use client";

// M02 §7 / PRD M02 — Détection et fusion de doublons clients (téléphone, nom phonétique, plaque)
import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  GitMerge,
  Users,
} from "lucide-react";
import { Button, EmptyState, Modal, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

interface Pair {
  customerIdA: string;
  customerIdB: string;
  displayNameA: string;
  displayNameB: string;
  score: number;
  reasons: string[];
}

export default function DuplicatesPage() {
  const utils = trpc.useUtils();
  const { data: pairs, isLoading, isError, refetch } = trpc.customer.duplicates.list.useQuery();

  const [mergingPair, setMergingPair] = useState<Pair | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [targetId, setTargetId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const dismiss = trpc.customer.duplicates.dismiss.useMutation({
    onSuccess: () => utils.customer.duplicates.list.invalidate(),
  });

  const mergeCustomers = trpc.customer.merge.useMutation({
    onSuccess: () => {
      setMergingPair(null);
      setConfirmName("");
      setError(null);
      void utils.customer.duplicates.list.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const openMerge = (pair: Pair) => {
    setMergingPair(pair);
    setTargetId(pair.customerIdB);
    setConfirmName("");
    setError(null);
  };

  const highConfidenceCount = pairs?.filter((p) => p.score >= 80).length ?? 0;

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/clients"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-2 hover:text-foreground"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <GitMerge size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Doublons clients détectés
              </h1>
              {pairs && pairs.length > 0 && (
                <span className="rounded-full bg-status-warn-bg px-2.5 py-0.5 text-xs font-semibold text-status-warn">
                  {pairs.length} suggestion{pairs.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              Détection automatique par similarité phonétique, numéro de téléphone et plaques partagées
            </p>
          </div>
        </div>

        <Link
          href="/clients"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition hover:bg-surface-2"
        >
          <Users size={14} className="text-muted" />
          <span>Annuaire des clients</span>
        </Link>
      </div>

      {/* Cartes d'information */}
      {pairs && pairs.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
            <span className="text-xs font-medium text-muted">Paires suspectes</span>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {pairs.length}
            </div>
            <span className="mt-1 text-[11px] text-muted">À examiner</span>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-status-bad/30 bg-status-bad-bg/10 p-3.5 shadow-sm">
            <span className="text-xs font-medium text-status-bad">Forte probabilité (&gt;80%)</span>
            <div className="mt-2 text-2xl font-bold tracking-tight text-status-bad">
              {highConfidenceCount}
            </div>
            <span className="mt-1 text-[11px] text-status-bad">Numéro ou plaque identique</span>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
            <span className="text-xs font-medium text-muted">Principe de fusion</span>
            <div className="mt-1 text-xs text-muted leading-relaxed">
              Tous les véhicules, devis, factures et créances du profil absorbé sont transférés vers le profil conservé sans perte de données.
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2/60" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-status-bad/40 bg-status-bad-bg/20 p-4 text-xs text-status-bad">
          Impossible de charger les doublons.{" "}
          <button type="button" onClick={() => refetch()} className="underline font-semibold">
            Réessayer
          </button>
        </div>
      ) : pairs && pairs.length === 0 ? (
        <EmptyState
          title="Aucun doublon détecté pour l'instant"
          description="Votre base clients est propre. Le système analyse en continu les nouvelles créations et modifications."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {pairs?.map((pair) => {
            const isHigh = pair.score >= 80;

            return (
              <div
                key={`${pair.customerIdA}:${pair.customerIdB}`}
                className="flex flex-col justify-between gap-4 rounded-xl border border-border/80 bg-surface p-4 shadow-xs transition-all hover:border-accent md:flex-row md:items-center"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      <Link
                        href={`/clients/${pair.customerIdA}`}
                        className="hover:text-accent hover:underline inline-flex items-center gap-1"
                      >
                        <span>{pair.displayNameA}</span>
                        <ExternalLink size={12} className="text-muted" />
                      </Link>
                      <span className="text-muted text-xs">↔</span>
                      <Link
                        href={`/clients/${pair.customerIdB}`}
                        className="hover:text-accent hover:underline inline-flex items-center gap-1"
                      >
                        <span>{pair.displayNameB}</span>
                        <ExternalLink size={12} className="text-muted" />
                      </Link>
                    </div>

                    <StatusBadge
                      tone={isHigh ? "bad" : "warn"}
                      label={`Indice : ${pair.score}%`}
                    />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {pair.reasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    className="h-9 text-xs"
                    onClick={() =>
                      dismiss.mutate({
                        customerIdA: pair.customerIdA,
                        customerIdB: pair.customerIdB,
                      })
                    }
                  >
                    Ignorer
                  </Button>

                  <Button
                    className="h-9 gap-1.5 text-xs font-medium"
                    onClick={() => openMerge(pair)}
                  >
                    <GitMerge size={14} />
                    <span>Fusionner...</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modale de fusion sécurisée */}
      {mergingPair && (
        <Modal
          open
          title="Fusionner deux comptes clients"
          onClose={() => setMergingPair(null)}
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setMergingPair(null)}>
                Annuler
              </Button>
              <Button
                variant="danger"
                loading={mergeCustomers.isPending}
                disabled={
                  confirmName.trim().toLowerCase() !==
                  (targetId === mergingPair.customerIdB
                    ? mergingPair.displayNameA.trim().toLowerCase()
                    : mergingPair.displayNameB.trim().toLowerCase())
                }
                onClick={() => {
                  const sourceId =
                    targetId === mergingPair.customerIdB
                      ? mergingPair.customerIdA
                      : mergingPair.customerIdB;
                  mergeCustomers.mutate({
                    sourceId,
                    targetId,
                    fieldChoices: {},
                    confirmName: confirmName.trim(),
                  });
                }}
              >
                Confirmer la fusion
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4 text-sm">
            <div className="rounded-xl border border-status-warn/40 bg-status-warn-bg/20 p-3 text-xs text-status-warn leading-relaxed">
              <div className="flex items-center gap-1.5 font-bold mb-1">
                <AlertTriangle size={15} />
                <span>Action irréversible</span>
              </div>
              Tous les véhicules, devis, factures, paiements et rendez-vous du client absorbé seront rattachés au compte principal conservé. Le compte absorbé sera ensuite archivé.
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-foreground">
                Compte principal à CONSERVER :
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTargetId(mergingPair.customerIdB)}
                  className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
                    targetId === mergingPair.customerIdB
                      ? "border-accent bg-accent/5 ring-2 ring-accent"
                      : "border-border bg-surface hover:bg-surface-2"
                  }`}
                >
                  <span className="text-xs font-bold text-foreground">
                    {mergingPair.displayNameB}
                  </span>
                  <span className="text-[11px] text-muted">Conserver ce profil</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTargetId(mergingPair.customerIdA)}
                  className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
                    targetId === mergingPair.customerIdA
                      ? "border-accent bg-accent/5 ring-2 ring-accent"
                      : "border-border bg-surface hover:bg-surface-2"
                  }`}
                >
                  <span className="text-xs font-bold text-foreground">
                    {mergingPair.displayNameA}
                  </span>
                  <span className="text-[11px] text-muted">Conserver ce profil</span>
                </button>
              </div>
            </div>

            {(() => {
              const absorbedName =
                targetId === mergingPair.customerIdB
                  ? mergingPair.displayNameA
                  : mergingPair.displayNameB;

              return (
                <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
                  <label className="text-xs font-semibold text-foreground">
                    Pour confirmer, retapez le nom exact du client absorbé (« {absorbedName} ») :
                  </label>
                  <input
                    type="text"
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder={absorbedName}
                    className="h-10 rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:border-accent focus:outline-none"
                  />
                </div>
              );
            })()}

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-status-bad/40 bg-status-bad-bg/20 p-2.5 text-xs text-status-bad">
                <AlertCircle size={14} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
