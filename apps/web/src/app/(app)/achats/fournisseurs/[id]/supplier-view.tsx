"use client";

// M07 §7 — /achats/fournisseurs/[id] : coordonnées, délai et conditions, historique d'achats,
// produits dont il est le fournisseur par défaut.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { Button, DataTable, EmptyState, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  useCan,
} from "../../../stock/_lib/components";
import { formatDay, PO_TONE, t } from "../../../stock/_lib/i18n";
import { SupplierFormModal } from "../supplier-form";

export function SupplierView({ id }: { id: string }) {
  const can = useCan();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const query = trpc.supplier.get.useQuery({ id });
  const toggle = trpc.supplier.update.useMutation({
    onSuccess: () => void utils.supplier.invalidate(),
  });
  if (query.isLoading) return <ListSkeleton rows={4} />;
  if (query.isError || !query.data) {
    return (
      <ErrorBox
        message={query.error?.data?.code === "NOT_FOUND" ? t("suppliers.notFound") : undefined}
        onRetry={() => query.refetch()}
      />
    );
  }
  const { supplier, purchaseOrders, products, totalPurchased } = query.data;
  return (
    <div className="flex flex-col gap-4 pb-10">
      <ModuleNav section="purchases" />
      <Link href="/achats/fournisseurs" className="min-h-11 text-sm text-muted underline">
        {t("common.back")}
      </Link>
      <PageTitle
        title={supplier.name}
        description={t("suppliers.totalPurchased", { value: formatFCFA(totalPurchased) })}
        actions={
          can("supplier:manage") ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t("common.edit")}
              </Button>
              <Button
                variant="ghost"
                loading={toggle.isPending}
                onClick={() => toggle.mutate({ id, isActive: !supplier.isActive })}
              >
                {supplier.isActive ? t("suppliers.deactivate") : t("suppliers.activate")}
              </Button>
            </>
          ) : null
        }
      />
      <StatusBadge
        tone={supplier.isActive ? "ok" : "off"}
        label={supplier.isActive ? t("suppliers.active") : t("suppliers.inactive")}
      />
      <section className="rounded-lg border border-border bg-surface p-4">
        <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-2">
          <dt className="text-muted">{t("suppliers.whatsappPhone")}</dt>
          <dd>{supplier.whatsappPhone ?? "—"}</dd>
          <dt className="text-muted">{t("suppliers.phone")}</dt>
          <dd>{supplier.phone ?? "—"}</dd>
          <dt className="text-muted">{t("suppliers.email")}</dt>
          <dd className="break-all">{supplier.email ?? "—"}</dd>
          <dt className="text-muted">{t("suppliers.address")}</dt>
          <dd>{supplier.address ?? "—"}</dd>
          <dt className="text-muted">{t("suppliers.paymentTermsDays")}</dt>
          <dd>{supplier.paymentTermsDays} j</dd>
          <dt className="text-muted">{t("suppliers.notes")}</dt>
          <dd className="whitespace-pre-wrap">{supplier.notes ?? "—"}</dd>
        </dl>
      </section>
      <h2 className="font-semibold">{t("suppliers.history")}</h2>
      <DataTable
        rows={purchaseOrders}
        rowKey={(po) => po.id}
        empty={<EmptyState title={t("purchases.empty")} />}
        columns={[
          {
            key: "number",
            header: t("purchases.columns.number"),
            primary: true,
            render: (po) => (
              <Link href={`/achats/${po.id}`} className="font-medium hover:underline">
                {po.number}
              </Link>
            ),
          },
          { key: "site", header: t("purchases.columns.site"), render: (po) => po.siteCode },
          {
            key: "total",
            header: t("purchases.columns.total"),
            render: (po) => formatFCFA(po.total),
          },
          {
            key: "date",
            header: t("purchases.columns.orderedAt"),
            render: (po) => formatDay(po.orderedAt ?? po.createdAt),
          },
          {
            key: "status",
            header: t("purchases.columns.status"),
            render: (po) => (
              <StatusBadge
                tone={PO_TONE[po.status] ?? "off"}
                label={t(`purchases.status.${po.status}`)}
              />
            ),
          },
        ]}
      />
      <h2 className="font-semibold">{t("suppliers.catalog")}</h2>
      <DataTable
        rows={products}
        rowKey={(p) => p.id}
        empty={<EmptyState title={t("catalog.empty")} />}
        columns={[
          {
            key: "name",
            header: t("catalog.columns.name"),
            primary: true,
            render: (p) => (
              <Link href={`/stock/${p.id}`} className="font-medium hover:underline">
                {p.name}
              </Link>
            ),
          },
          { key: "sku", header: t("catalog.columns.sku"), render: (p) => p.sku },
          {
            key: "price",
            header: t("product.purchasePrice"),
            render: (p) => (p.purchasePrice != null ? formatFCFA(p.purchasePrice) : "—"),
          },
        ]}
      />
      {editing ? (
        <SupplierFormModal
          initial={{
            id: supplier.id,
            name: supplier.name,
            phone: supplier.phone ?? "",
            whatsappPhone: supplier.whatsappPhone ?? "",
            email: supplier.email ?? "",
            address: supplier.address ?? "",
            paymentTermsDays: supplier.paymentTermsDays,
            notes: supplier.notes ?? "",
          }}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
