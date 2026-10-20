"use client";

// M16 §7 — /assurances/compagnies : annuaire des compagnies d'assurances partenaires,
// création rapide, coordonnées des services sinistres et conditions de règlement (RG-M16-01).
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Clock,
  Mail,
  Phone,
  Plus,
  Shield,
} from "lucide-react";
import { Button, EmptyState, Modal, StatusBadge } from "@atelieros/ui";
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
    <div className="flex min-w-0 flex-col gap-6 pb-16">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Building2 size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t("insurersTitle")}
              </h1>
              {list.data && (
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">
                  {list.data.length} compagnies
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              Gestion des conventions, délais de paiement négociés et contacts experts
            </p>
          </div>
        </div>

        {canEdit && (
          <Button
            className="h-9 gap-1.5 text-xs font-medium"
            onClick={() => setOpen(true)}
          >
            <Plus size={14} strokeWidth={2.5} />
            <span>{t("newInsurer")}</span>
          </Button>
        )}
      </div>

      <ClaimsNav />

      {list.isLoading ? (
        <ListSkeleton rows={3} />
      ) : list.isError || !list.data ? (
        <ErrorBox onRetry={() => list.refetch()} message={t("loadError")} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title={t("emptyInsurers.title")}
          description={t("emptyInsurers.description")}
          action={
            canEdit ? (
              <Button onClick={() => setOpen(true)}>+ {t("newInsurer")}</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((i) => (
            <div
              key={i.id}
              className="group flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-4 shadow-xs transition-all hover:border-accent hover:bg-surface-2/20"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-foreground font-bold">
                      <Shield size={16} />
                    </div>
                    <div>
                      <Link
                        href={`/assurances/compagnies/${i.id}`}
                        className="font-bold text-foreground group-hover:text-accent group-hover:underline"
                      >
                        {i.name}
                      </Link>
                      <div className="text-xs text-muted">
                        {i.legalName && i.legalName !== i.name ? i.legalName : "Conventionné"}
                      </div>
                    </div>
                  </div>

                  <StatusBadge
                    tone={i.isActive ? "ok" : "off"}
                    label={i.isActive ? "Active" : "Inactive"}
                  />
                </div>

                {/* Coordonnées & Contact Sinistres */}
                <div className="mt-4 flex flex-col gap-1.5 text-xs text-muted">
                  {(i.claimsPhone || i.phone) && (
                    <div className="flex items-center gap-2">
                      <Phone size={13} className="text-muted/80" />
                      <a
                        href={`tel:${i.claimsPhone ?? i.phone}`}
                        className="hover:text-foreground hover:underline"
                      >
                        {i.claimsPhone ?? i.phone}
                      </a>
                    </div>
                  )}
                  {(i.claimsEmail || i.email) && (
                    <div className="flex items-center gap-2">
                      <Mail size={13} className="text-muted/80" />
                      <a
                        href={`mailto:${i.claimsEmail ?? i.email}`}
                        className="truncate hover:text-foreground hover:underline"
                      >
                        {i.claimsEmail ?? i.email}
                      </a>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Clock size={13} className="text-muted/80" />
                    <span>
                      {t("fields.paymentTermsDays")} :{" "}
                      <strong className="text-foreground">{i.paymentTermsDays} jours</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Pied de carte avec liens */}
              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                <Link
                  href={`/assurances/sinistres?compagnie=${i.id}`}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Voir les dossiers
                </Link>

                <Link
                  href={`/assurances/compagnies/${i.id}`}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-muted hover:border-accent hover:text-foreground"
                >
                  <span>Gérer</span>
                  <ArrowRight size={12} />
                </Link>
              </div>
            </div>
          ))}
        </div>
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
