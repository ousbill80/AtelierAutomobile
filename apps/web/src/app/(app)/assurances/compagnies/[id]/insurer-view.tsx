"use client";

// M16 §7 — fiche compagnie : statistiques (encours, délai moyen) et modification.
import { useState } from "react";
import Link from "next/link";
import { followUpConfigFrom } from "@atelieros/core/claims";
import { formatFCFA } from "@atelieros/core/money";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { ATTACHMENT_KINDS, t } from "@/components/claims/i18n";
import {
  InsurerForm,
  insurerPayload,
  type InsurerFormValue,
} from "@/components/claims/insurer-form";
import { ClaimsNav } from "../../nav";

export function InsurerView({ id }: { id: string }) {
  const me = trpc.me.get.useQuery();
  const canEdit = new Set(me.data?.permissions ?? []).has("insurer:edit");
  const q = trpc.insurer.get.useQuery({ id });
  const stats = trpc.insurer.stats.useQuery({});
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const update = trpc.insurer.update.useMutation({
    onSuccess: async () => {
      setSaved(true);
      await utils.insurer.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.isError || !q.data) {
    return <ErrorBox onRetry={() => q.refetch()} message={q.error?.message ?? t("loadError")} />;
  }
  const i = q.data;
  const s = stats.data?.find((x) => x.insurerId === id);
  const cfg = followUpConfigFrom(i.followUpConfig);
  const initial: InsurerFormValue = {
    name: i.name,
    legalName: i.legalName ?? "",
    ncc: i.ncc ?? "",
    rccm: i.rccm ?? "",
    address: i.address ?? "",
    claimsContactName: i.claimsContactName ?? "",
    claimsPhone: i.claimsPhone ?? "",
    claimsEmail: i.claimsEmail ?? "",
    accountingEmail: i.accountingEmail ?? "",
    paymentTermsDays: i.paymentTermsDays,
    laborRate: i.laborRate,
    partsDiscountRate: i.partsDiscountRate,
    requiredDocuments: i.requiredDocuments.filter((k): k is (typeof ATTACHMENT_KINDS)[number] =>
      (ATTACHMENT_KINDS as readonly string[]).includes(k),
    ),
    approvalSteps: cfg.approval.join(", "),
    paymentSteps: cfg.payment.join(", "),
    isActive: i.isActive,
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ClaimsNav />
      <h1 className="text-xl font-semibold">{i.name}</h1>
      {s && (
        <Link
          href={`/assurances/sinistres?compagnie=${id}`}
          className="flex flex-wrap gap-4 rounded-lg border border-border bg-surface p-3 text-sm hover:border-accent"
        >
          <span>
            {t("fields.outstanding")} <strong>{formatFCFA(s.outstanding)}</strong>
          </span>
          <span>
            {t("fields.openClaims")} : {s.openClaims}
          </span>
          <span>
            {t("fields.avgDaysToPay")} :{" "}
            {s.avgDaysToPay === null ? "—" : t("fields.days", { days: s.avgDaysToPay })}
          </span>
        </Link>
      )}
      {canEdit && (
        <InsurerForm
          initial={initial}
          pending={update.isPending}
          error={error}
          onSubmit={(v) => {
            setError(null);
            setSaved(false);
            update.mutate({ id, ...insurerPayload(v) });
          }}
        />
      )}
      {saved && (
        <p role="status" className="text-sm text-status-ok">
          ✓ {t("saved")}
        </p>
      )}
    </div>
  );
}
