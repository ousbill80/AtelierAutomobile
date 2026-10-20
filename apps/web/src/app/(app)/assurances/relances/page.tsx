"use client";

// M16 §7 — /assurances/relances : relances assureur dues et à valider (RG-M16-08).
// Interface modernisée avec actions rapides (valider et envoyer, reporter, noter un appel).
import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Calendar, Clock, ExternalLink, Phone, Send } from "lucide-react";
import { Button, EmptyState, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay } from "@/components/repair-orders/i18n";
import { t } from "@/components/claims/i18n";
import { ClaimsNav } from "../nav";

const DAY = 86_400_000;

export default function ClaimFollowUpsPage() {
  const list = trpc.claim.followUps.useQuery({});
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    await utils.claim.followUps.invalidate();
  };

  const onError = (e: { message: string }) => setError(e.message);
  const send = trpc.claim.sendFollowUp.useMutation({ onSuccess: refresh, onError });
  const snooze = trpc.claim.snoozeFollowUp.useMutation({ onSuccess: refresh, onError });
  const call = trpc.claim.addActivity.useMutation({ onError });

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-16">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Send size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t("followUpsTitle")}
              </h1>
              {list.data && list.data.length > 0 && (
                <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
                  {list.data.length} en attente
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              Validation des relances programmées auprès des experts et des compagnies
              d&apos;assurance
            </p>
          </div>
        </div>
      </div>

      <ClaimsNav />

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-status-bad/40 bg-status-bad-bg/20 p-3 text-xs text-status-bad">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {list.isLoading ? (
        <ListSkeleton rows={3} />
      ) : list.isError || !list.data ? (
        <ErrorBox onRetry={() => list.refetch()} message={list.error?.message ?? t("loadError")} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title={t("emptyFollowUps.title")}
          description={t("emptyFollowUps.description")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {list.data.map((f) => (
            <div
              key={f.id}
              className="flex flex-col justify-between gap-4 rounded-xl border border-border/80 bg-surface p-4 shadow-xs transition-all hover:border-accent/80 hover:bg-surface-2/20 md:flex-row md:items-center"
            >
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/assurances/sinistres/${f.claim.id}`}
                    className="font-mono text-sm font-bold text-foreground hover:text-accent hover:underline"
                  >
                    {f.claim.number}
                  </Link>
                  <span className="text-xs font-medium text-foreground">
                    {t(`followUpKind.${f.kind}`)}
                  </span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-mono text-muted">
                    {f.stepKey}
                  </span>
                  <StatusBadge
                    tone={f.status === "NEEDS_APPROVAL" ? "warn" : "off"}
                    label={`${f.status === "NEEDS_APPROVAL" ? "⚠" : "🕑"} ${t(`followUpStatus.${f.status}`)}`}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-semibold text-foreground">
                    {f.claim.insuranceCompany.name}
                  </span>
                  <span>•</span>
                  <span>{f.claim.customer.displayName}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1 font-medium text-accent">
                    <Calendar size={12} />
                    <span>
                      {t("fields.dueFor")} {formatDay(f.scheduledFor, "UTC")}
                    </span>
                  </span>
                </div>
              </div>

              {/* Actions de validation */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  className="h-9 gap-1.5 text-xs font-medium"
                  loading={send.isPending && send.variables?.followUpId === f.id}
                  onClick={() => send.mutate({ followUpId: f.id })}
                >
                  <Send size={13} />
                  <span>{t("actions.send")}</span>
                </Button>

                <Button
                  variant="secondary"
                  className="h-9 gap-1.5 text-xs font-medium"
                  onClick={() =>
                    snooze.mutate({
                      followUpId: f.id,
                      until: new Date(Date.now() + 3 * DAY),
                    })
                  }
                >
                  <Clock size={13} />
                  <span>{t("actions.snooze")} (+3 j)</span>
                </Button>

                <Button
                  variant="secondary"
                  className="h-9 gap-1.5 text-xs font-medium"
                  onClick={async () => {
                    await call.mutateAsync({
                      id: f.claim.id,
                      type: "call",
                      body: `${t("actions.callDone")} — ${t(`followUpKind.${f.kind}`)} ${f.stepKey}`,
                    });
                    await snooze.mutateAsync({
                      followUpId: f.id,
                      until: new Date(Date.now() + 7 * DAY),
                    });
                  }}
                >
                  <Phone size={13} />
                  <span>{t("actions.callDone")}</span>
                </Button>

                <Link
                  href={`/assurances/sinistres/${f.claim.id}`}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-2"
                  title="Voir le dossier"
                >
                  <ExternalLink size={14} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
