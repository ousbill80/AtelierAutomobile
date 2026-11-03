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

/** Champ de saisie bas : les libellés sont dans l'en-tête de colonne, pas sur chaque ligne. */
const compactInput = { height: 34, padding: "0 8px", fontSize: 13 };

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
          className="rounded-lg border border-border bg-surface px-3 py-2"
        >
          <h2 className="py-1 text-sm font-semibold">
            {group.supplierName ?? t("suggestions.noSupplier")}
          </h2>
          {!group.supplierId ? (
            <p className="pb-1 text-sm text-muted">{t("suggestions.noSupplierHint")}</p>
          ) : null}
          <div className="hidden grid-cols-[minmax(0,1fr)_6.5rem_10.5rem_6.5rem] gap-3 border-b border-border px-1 py-1 text-xs font-medium text-muted sm:grid">
            <span>{t("common.product")}</span>
            <span>{t("suggestions.suggested")}</span>
            <span>{t("common.unitCost")}</span>
            <span className="text-right">{t("common.total")}</span>
          </div>
          <ul>
            {group.lines.map((l) => {
              const edit = editOf(l, group.supplierId);
              const lineTotal = edit
                ? Math.round(Number(edit.quantity.replace(",", ".")) * (edit.unitCost ?? 0)) || 0
                : null;
              return (
                <li
                  key={l.productId}
                  className="grid grid-cols-1 items-center gap-2 border-t border-border py-1.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_6.5rem_10.5rem_6.5rem] sm:gap-3 sm:py-1"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <CheckboxRow
                      label={<span className="text-sm">{`${l.name} (${l.sku})`}</span>}
                      disabled={!group.supplierId}
                      checked={!!edit?.selected}
                      onChange={(e) => setEdit(l, group.supplierId, { selected: e.target.checked })}
                    />
                    <span className="text-xs text-muted">
                      {t("suggestions.projected")} : {qtyText(l.projected, l.quantityScale)}
                      {" · "}
                      {t("suggestions.min")} : {qtyText(l.minStock, l.quantityScale)}
                    </span>
                    <StatusBadge tone="warn" label={t(`suggestions.reason.${l.reason}`)} />
                  </div>
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 sm:contents">
                    <span className="col-span-3 grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2 text-[11px] leading-none text-muted sm:hidden">
                      <span>{t("suggestions.suggested")}</span>
                      <span>{t("common.unitCost")}</span>
                      <span className="text-right">{t("common.total")}</span>
                    </span>
                    <Input
                      aria-label={`${t("suggestions.suggested")} (${l.unit})`}
                      inputMode="decimal"
                      className="num"
                      style={compactInput}
                      value={edit?.quantity ?? ""}
                      onChange={(e) => setEdit(l, group.supplierId, { quantity: e.target.value })}
                    />
                    <MoneyInput
                      aria-label={t("common.unitCost")}
                      style={compactInput}
                      value={edit?.unitCost ?? null}
                      onChange={(v) => setEdit(l, group.supplierId, { unitCost: v })}
                    />
                    <div className="min-w-[5.5rem] text-right text-sm font-medium tabular-nums">
                      {lineTotal != null ? formatFCFA(lineTotal) : "—"}
                    </div>
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
