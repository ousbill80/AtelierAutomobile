"use client";

// M16 §7 — /assurances/relances : relances assureur dues, à valider (RG-M16-08) ; valider et
// envoyer, reporter, ou noter un appel dans la chronologie du dossier.
import { useState } from "react";
import Link from "next/link";
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
    <div className="flex min-w-0 flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("followUpsTitle")}</h1>
      <ClaimsNav />
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
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
        <ul className="flex flex-col gap-2" aria-label={t("followUpsTitle")}>
          {list.data.map((f) => (
            <li
              key={f.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
            >
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/assurances/sinistres/${f.claim.id}`}
                  className="font-mono font-semibold underline"
                >
                  {f.claim.number}
                </Link>
                <span>{t(`followUpKind.${f.kind}`)}</span>
                <span className="text-xs">{f.stepKey}</span>
                <StatusBadge
                  tone={f.status === "NEEDS_APPROVAL" ? "warn" : "off"}
                  label={`${f.status === "NEEDS_APPROVAL" ? "⚠" : "🕑"} ${t(`followUpStatus.${f.status}`)}`}
                />
              </span>
              <span className="text-xs text-muted">
                {f.claim.insuranceCompany.name} · {f.claim.customer.displayName} ·{" "}
                {t("fields.dueFor")} {formatDay(f.scheduledFor, "UTC")}
              </span>
              <span className="flex flex-wrap gap-2">
                <Button
                  className="min-h-11"
                  loading={send.isPending && send.variables?.followUpId === f.id}
                  onClick={() => send.mutate({ followUpId: f.id })}
                >
                  {t("actions.send")}
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-11"
                  onClick={() =>
                    snooze.mutate({
                      followUpId: f.id,
                      until: new Date(Date.now() + 3 * DAY),
                    })
                  }
                >
                  {t("actions.snooze")}
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-11"
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
                  {t("actions.callDone")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
