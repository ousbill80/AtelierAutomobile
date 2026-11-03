"use client";

// M16 §7 — /assurances/compagnies : liste des compagnies et création (RG-M16-01).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, Modal, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/claims/i18n";
import { EMPTY_INSURER, InsurerForm, insurerPayload } from "@/components/claims/insurer-form";
import { ClaimsNav } from "../nav";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "—";
}

export default function InsurersPage() {
  const router = useRouter();
  const me = trpc.me.get.useQuery();
  const canEdit = new Set(me.data?.permissions ?? []).has("insurer:edit");
  const list = trpc.insurer.list.useQuery({ includeInactive: true });
  const stats = trpc.insurer.stats.useQuery({});
  const [q, setQ] = useState("");
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

  const needle = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((i) => {
    if (!needle) return true;
    return [i.name, i.claimsContactName, i.claimsPhone, i.claimsEmail]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(needle));
  });
  const byId = new Map((stats.data ?? []).map((s) => [s.insurerId, s]));
  const count = list.data?.length ?? 0;

  return (
    <div className="listing-page min-w-0">
      <div className="listing-header">
        <div>
          <h1>{t("insurersTitle")}</h1>
          <p className="listing-subtitle">
            {list.data
              ? t(count > 1 ? "listCountPlural" : "listCount", { count })
              : t("insurersIntro")}
          </p>
        </div>
        {canEdit && (
          <Button className="min-h-11" onClick={() => setOpen(true)}>
            + {t("newInsurer")}
          </Button>
        )}
      </div>
      <ClaimsNav />
      <div className="listing-toolbar">
        <div className="listing-search" style={{ maxWidth: "none", flex: 1 }}>
          <Search aria-hidden />
          <input
            type="search"
            aria-label={t("insurerSearch")}
            placeholder={t("insurerSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
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
              <Button className="min-h-11" onClick={() => setOpen(true)}>
                + {t("newInsurer")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="listing-table-wrap">
          <table className="listing-table">
            <thead>
              <tr>
                <th>{t("fields.insurer")}</th>
                <th>{t("columns.contact")}</th>
                <th>{t("fields.phone")}</th>
                <th>{t("fields.email")}</th>
                <th>{t("columns.terms")}</th>
                <th>{t("columns.claims")}</th>
                <th>{t("columns.outstanding")}</th>
                <th>{t("columns.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="listing-table-muted">
                    {t("searchEmpty")}
                  </td>
                </tr>
              ) : (
                rows.map((i) => {
                  const s = byId.get(i.id);
                  return (
                    <tr
                      key={i.id}
                      onClick={() => router.push(`/assurances/compagnies/${i.id}`)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <Link
                          href={`/assurances/compagnies/${i.id}`}
                          className="listing-table-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="listing-table-avatar company">{initials(i.name)}</span>
                          <span className="listing-table-name">{i.name}</span>
                        </Link>
                      </td>
                      <td>{i.claimsContactName || "—"}</td>
                      <td className="listing-table-phone">{i.claimsPhone || "—"}</td>
                      <td className="break-all">{i.claimsEmail || "—"}</td>
                      <td className="tabular">{t("fields.days", { days: i.paymentTermsDays })}</td>
                      <td className="tabular">{s ? s.openClaims : "—"}</td>
                      <td className="tabular">{s ? formatFCFA(s.outstanding) : "—"}</td>
                      <td>
                        <StatusBadge
                          tone={i.isActive ? "ok" : "off"}
                          label={i.isActive ? t("active") : t("inactive")}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Modal
          open
          size="lg"
          title={t("newInsurer")}
          onClose={() => setOpen(false)}
          footer={
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                form="new-insurer"
                loading={create.isPending}
                className="min-h-11"
              >
                {t("save")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() => setOpen(false)}
              >
                {t("cancel")}
              </Button>
            </div>
          }
        >
          <InsurerForm
            formId="new-insurer"
            showSubmit={false}
            autoFocusName
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
