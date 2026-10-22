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
    <div className="flex flex-col gap-6 pb-16">
      <ModuleNav section="purchases" />

      {/* En-tête enrichi */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/achats/fournisseurs"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:text-foreground hover:bg-surface-2"
          >
            ←
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {supplier.name}
              </h1>
              <StatusBadge
                tone={supplier.isActive ? "ok" : "off"}
                label={supplier.isActive ? t("suppliers.active") : t("suppliers.inactive")}
              />
            </div>
            <p className="text-xs text-muted">
              {t("suppliers.totalPurchased", { value: formatFCFA(totalPurchased) })} ·{" "}
              {products.length} référence{products.length > 1 ? "s" : ""} catalogue
            </p>
          </div>
        </div>

        {can("supplier:manage") && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="h-9 text-xs" onClick={() => setEditing(true)}>
              {t("common.edit")}
            </Button>
            <Button
              variant="ghost"
              className="h-9 text-xs"
              loading={toggle.isPending}
              onClick={() => toggle.mutate({ id, isActive: !supplier.isActive })}
            >
              {supplier.isActive ? t("suppliers.deactivate") : t("suppliers.activate")}
            </Button>
          </div>
        )}
      </div>

      {/* Cartes KPI Fournisseur */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <span className="text-xs font-medium text-muted">Total des achats</span>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {formatFCFA(totalPurchased)}
          </div>
          <span className="mt-1 text-[11px] text-muted">Volume d&apos;affaires cumulé</span>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <span className="text-xs font-medium text-muted">Commandes passées</span>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {purchaseOrders.length}
          </div>
          <span className="mt-1 text-[11px] text-muted">Bons de commande émis</span>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <span className="text-xs font-medium text-muted">Délai de règlement</span>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {supplier.paymentTermsDays === 0 ? "Comptant" : `${supplier.paymentTermsDays} jours`}
          </div>
          <span className="mt-1 text-[11px] text-muted">Conditions négociées</span>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <span className="text-xs font-medium text-muted">Catalogue associé</span>
          <div className="mt-2 text-2xl font-bold tracking-tight text-accent">
            {products.length}
          </div>
          <span className="mt-1 text-[11px] text-muted">Fournisseur par défaut</span>
        </div>
      </div>
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
