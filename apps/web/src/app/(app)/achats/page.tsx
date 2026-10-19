"use client";

// M07 §7 — /achats : bons de commande par statut, fournisseur, retards (`expectedAt` dépassée).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import { Button, CheckboxRow, DataTable, EmptyState, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton, ModuleNav, PageTitle, useCan } from "../stock/_lib/components";
import { formatDay, PO_TONE, t } from "../stock/_lib/i18n";
import { CreatePurchaseOrderModal } from "./_lib/po-form";

const STATUSES = ["DRAFT", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;
type Status = (typeof STATUSES)[number];

export default function PurchasesPage() {
  const router = useRouter();
  const can = useCan();
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [late, setLate] = useState(false);
  const [creating, setCreating] = useState(false);
  const list = trpc.purchaseOrder.list.useQuery({ status, late: late || undefined });

  return (
    <div className="flex flex-col gap-4">
      <ModuleNav section="purchases" />
      <PageTitle
        title={t("purchases.title")}
        description={t("purchases.description")}
        actions={
          can("purchase:create") ? (
            <Button onClick={() => setCreating(true)}>{t("purchases.new")}</Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {[undefined, ...STATUSES].map((s) => (
          <button
            key={s ?? "all"}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-11 rounded-md border border-border px-3 ${status === s ? "bg-surface-2 font-semibold" : "bg-surface"}`}
          >
            {s ? t(`purchases.status.${s}`) : t("purchases.allStatuses")}
          </button>
        ))}
        <CheckboxRow
          label={t("purchases.lateOnly")}
          checked={late}
          onChange={(e) => setLate(e.target.checked)}
        />
      </div>
      {list.isLoading ? <ListSkeleton /> : null}
      {list.isError ? <ErrorBox onRetry={() => list.refetch()} /> : null}
      {list.data ? (
        <DataTable
          rows={list.data}
          rowKey={(po) => po.id}
          onRowClick={(po) => router.push(`/achats/${po.id}`)}
          empty={<EmptyState title={t("purchases.empty")} />}
          columns={[
            {
              key: "number",
              header: t("purchases.columns.number"),
              primary: true,
              render: (po) => <span className="font-medium">{po.number}</span>,
            },
            {
              key: "supplier",
              header: t("purchases.columns.supplier"),
              render: (po) => po.supplier.name,
            },
            { key: "site", header: t("purchases.columns.site"), render: (po) => po.siteCode },
            {
              key: "total",
              header: t("purchases.columns.total"),
              render: (po) => formatFCFA(po.total),
            },
            {
              key: "ordered",
              header: t("purchases.columns.orderedAt"),
              render: (po) => formatDay(po.orderedAt),
            },
            {
              key: "expected",
              header: t("purchases.columns.expectedAt"),
              render: (po) => formatDay(po.expectedAt),
            },
            {
              key: "status",
              header: t("purchases.columns.status"),
              render: (po) => (
                <span className="flex flex-wrap gap-1">
                  <StatusBadge
                    tone={PO_TONE[po.status] ?? "off"}
                    label={t(`purchases.status.${po.status}`)}
                  />
                  {po.late ? <StatusBadge tone="bad" label={t("purchases.late")} /> : null}
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {creating ? (
        <CreatePurchaseOrderModal
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/achats/${id}`)}
        />
      ) : null}
    </div>
  );
}
