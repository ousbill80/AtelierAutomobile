"use client";

// M16 §7 — /assurances/compagnies : liste des compagnies et création (RG-M16-01).
import { useState } from "react";
import Link from "next/link";
import { Button, EmptyState, Modal } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/claims/i18n";
import { EMPTY_INSURER, InsurerForm, insurerPayload } from "@/components/claims/insurer-form";
import { ClaimsNav } from "../nav";

export default function InsurersPage() {
  const me = trpc.me.get.useQuery();
  const canEdit = new Set(me.data?.permissions ?? []).has("insurer:edit");
  const list = trpc.insurer.list.useQuery({ includeInactive: true });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const create = trpc.insurer.create.useMutation({
    onSuccess: async () => {
      setOpen(false);
      await utils.insurer.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("insurersTitle")}</h1>
        {canEdit && (
          <Button className="min-h-11" onClick={() => setOpen(true)}>
            + {t("newInsurer")}
          </Button>
        )}
      </div>
      <ClaimsNav />
      {list.isLoading ? (
        <ListSkeleton rows={3} />
      ) : list.isError || !list.data ? (
        <ErrorBox onRetry={() => list.refetch()} message={t("loadError")} />
      ) : list.data.length === 0 ? (
        <EmptyState title={t("emptyInsurers.title")} description={t("emptyInsurers.description")} />
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("insurersTitle")}>
          {list.data.map((i) => (
            <li key={i.id}>
              <Link
                href={`/assurances/compagnies/${i.id}`}
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm hover:border-accent"
              >
                <span className="font-semibold">
                  {i.name}
                  {!i.isActive && (
                    <span className="ml-2 text-xs text-muted">— {t("fields.isActive")} ✕</span>
                  )}
                </span>
                <span className="text-xs text-muted">
                  {i.claimsEmail ?? i.claimsPhone ?? ""} · {t("fields.paymentTermsDays")} :{" "}
                  {i.paymentTermsDays}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <Modal open size="lg" title={t("newInsurer")} onClose={() => setOpen(false)}>
          <InsurerForm
            initial={EMPTY_INSURER}
            pending={create.isPending}
            error={error}
            onSubmit={(v) => {
              setError(null);
              create.mutate(insurerPayload(v));
            }}
          />
        </Modal>
      )}
    </div>
  );
}
