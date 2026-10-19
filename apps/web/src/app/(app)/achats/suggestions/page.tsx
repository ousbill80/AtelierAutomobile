"use client";

// M07 §7 — /achats/suggestions (US-M07-06, RG-M07-07) : suggestions groupées par fournisseur
// par défaut, quantités ajustables, création des bons de commande en un clic.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import { Button, CheckboxRow, EmptyState, Input, MoneyInput, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  InlineError,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  SiteSelect,
  useDefaultSite,
} from "../../stock/_lib/components";
import { errorMessage, qtyText, t } from "../../stock/_lib/i18n";

interface Edit {
  selected: boolean;
  quantity: string;
  unitCost: number | null;
}

export default function SuggestionsPage() {
  const router = useRouter();
  const [siteId, setSiteId] = useDefaultSite();
  const query = trpc.purchaseOrder.suggestions.useQuery({ siteId }, { enabled: !!siteId });
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [done, setDone] = useState<string | null>(null);
  const create = trpc.purchaseOrder.createFromSuggestions.useMutation({
    onSuccess(orders) {
      setDone(t("suggestions.created", { count: orders.length }));
      void query.refetch();
      if (orders.length === 1) router.push(`/achats/${orders[0]!.id}`);
    },
  });

  // Valeurs proposées par défaut ; `edits` ne garde que les modifications de l'utilisateur.
  type Line = NonNullable<typeof query.data>[number]["lines"][number];
  function editOf(line: Line, supplierId: string | null): Edit {
    return (
      edits[line.productId] ?? {
        selected: supplierId !== null,
        quantity: String(line.suggestedQty / line.quantityScale).replace(".", ","),
        unitCost: line.unitCost,
      }
    );
  }
  function setEdit(line: Line, supplierId: string | null, patch: Partial<Edit>) {
    setEdits({ ...edits, [line.productId]: { ...editOf(line, supplierId), ...patch } });
  }

  function submit() {
    if (!query.data) return;
    const orders = query.data
      .filter((g) => g.supplierId)
      .map((g) => ({
        supplierId: g.supplierId!,
        lines: g.lines
          .filter((l) => editOf(l, g.supplierId).selected)
          .map((l) => ({
            productId: l.productId,
            quantity: Number(editOf(l, g.supplierId).quantity.replace(",", ".")),
            unitCost: editOf(l, g.supplierId).unitCost ?? l.unitCost,
          }))
          .filter((l) => l.quantity > 0),
      }))
      .filter((o) => o.lines.length > 0);
    if (orders.length > 0) create.mutate({ siteId, orders });
  }

  const selectedCount = (query.data ?? []).reduce(
    (n, g) => n + g.lines.filter((l) => editOf(l, g.supplierId).selected).length,
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <ModuleNav section="purchases" />
      <PageTitle
        title={t("suggestions.title")}
        description={t("suggestions.description")}
        actions={
          <Button
            loading={create.isPending}
            disabled={selectedCount === 0 || create.isPending}
            onClick={submit}
          >
            {t("suggestions.create")}
          </Button>
        }
      />
      <div className="max-w-xs">
        <SiteSelect value={siteId} onChange={setSiteId} />
      </div>
      {done ? (
        <p role="status" className="rounded-md bg-surface-2 p-2 text-sm">
          {done}
        </p>
      ) : null}
      <InlineError message={create.error ? errorMessage(create.error) : null} />
      {query.isLoading ? <ListSkeleton /> : null}
      {query.isError ? <ErrorBox onRetry={() => query.refetch()} /> : null}
      {query.data && query.data.length === 0 ? <EmptyState title={t("suggestions.empty")} /> : null}
      {query.data && query.data.length > 0 ? (
        <p className="text-sm text-muted">{t("suggestions.selectHint")}</p>
      ) : null}
      {query.data?.map((group) => (
        <section
          key={group.supplierId ?? "none"}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
        >
          <h2 className="font-semibold">{group.supplierName ?? t("suggestions.noSupplier")}</h2>
          {!group.supplierId ? (
            <p className="text-sm text-muted">{t("suggestions.noSupplierHint")}</p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {group.lines.map((l) => {
              const edit = editOf(l, group.supplierId);
              return (
                <li
                  key={l.productId}
                  className="flex flex-col gap-2 border-t border-border pt-2 sm:flex-row sm:items-end"
                >
                  <div className="min-w-0 flex-1">
                    <CheckboxRow
                      label={`${l.name} (${l.sku})`}
                      disabled={!group.supplierId}
                      checked={!!edit?.selected}
                      onChange={(e) => setEdit(l, group.supplierId, { selected: e.target.checked })}
                    />
                    <div className="flex flex-wrap gap-2 text-xs text-muted">
                      <span>
                        {t("suggestions.projected")} : {qtyText(l.projected, l.quantityScale)}
                      </span>
                      <span>
                        {t("suggestions.min")} : {qtyText(l.minStock, l.quantityScale)}
                      </span>
                      <StatusBadge tone="warn" label={t(`suggestions.reason.${l.reason}`)} />
                    </div>
                  </div>
                  <div className="w-full sm:w-28">
                    <Input
                      label={`${t("suggestions.suggested")} (${l.unit})`}
                      inputMode="decimal"
                      value={edit?.quantity ?? ""}
                      onChange={(e) => setEdit(l, group.supplierId, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="w-full sm:w-40">
                    <MoneyInput
                      label={t("common.unitCost")}
                      value={edit?.unitCost ?? null}
                      onChange={(v) => setEdit(l, group.supplierId, { unitCost: v })}
                    />
                  </div>
                  <div className="text-sm sm:w-28 sm:text-right">
                    {edit
                      ? formatFCFA(
                          Math.round(
                            Number(edit.quantity.replace(",", ".")) * (edit.unitCost ?? 0),
                          ) || 0,
                        )
                      : "—"}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
