"use client";

// M07 §7 — /achats/fournisseurs : liste et création des fournisseurs (téléphones +225).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, DataTable, EmptyState, Input, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton, ModuleNav, PageTitle, useCan } from "../../stock/_lib/components";
import { t } from "../../stock/_lib/i18n";
import { SupplierFormModal } from "./supplier-form";

export default function SuppliersPage() {
  const router = useRouter();
  const can = useCan();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const list = trpc.supplier.list.useQuery({ q: q.trim() || undefined, includeInactive: true });
  return (
    <div className="flex flex-col gap-4">
      <ModuleNav section="purchases" />
      <PageTitle
        title={t("suppliers.title")}
        actions={
          can("supplier:manage") ? (
            <Button onClick={() => setCreating(true)}>{t("suppliers.new")}</Button>
          ) : null
        }
      />
      <Input
        type="search"
        aria-label={t("common.search")}
        placeholder={t("common.search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />
      {list.isLoading ? <ListSkeleton /> : null}
      {list.isError ? <ErrorBox onRetry={() => list.refetch()} /> : null}
      {list.data ? (
        <DataTable
          rows={list.data}
          rowKey={(s) => s.id}
          onRowClick={(s) => router.push(`/achats/fournisseurs/${s.id}`)}
          empty={<EmptyState title={t("suppliers.empty")} />}
          columns={[
            {
              key: "name",
              header: t("suppliers.name"),
              primary: true,
              render: (s) => <span className="font-medium">{s.name}</span>,
            },
            {
              key: "whatsapp",
              header: t("suppliers.whatsappPhone"),
              render: (s) => s.whatsappPhone ?? s.phone ?? "—",
            },
            { key: "email", header: t("suppliers.email"), render: (s) => s.email ?? "—" },
            {
              key: "terms",
              header: t("suppliers.paymentTermsDays"),
              render: (s) => `${s.paymentTermsDays} j`,
            },
            {
              key: "products",
              header: t("catalog.columns.name"),
              render: (s) => t("suppliers.products", { count: s.products }),
            },
            {
              key: "status",
              header: t("common.status"),
              render: (s) => (
                <StatusBadge
                  tone={s.isActive ? "ok" : "off"}
                  label={s.isActive ? t("suppliers.active") : t("suppliers.inactive")}
                />
              ),
            },
          ]}
        />
      ) : null}
      {creating ? (
        <SupplierFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => router.push(`/achats/fournisseurs/${id}`)}
        />
      ) : null}
    </div>
  );
}
