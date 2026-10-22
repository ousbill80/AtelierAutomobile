"use client";

// M07 §7 — /achats/suggestions (US-M07-06, RG-M07-07) : réapprovisionnement intelligent
// groupé par fournisseur par défaut, calcul des ruptures prévisionnelles et création en un clic.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  Package,
  ShoppingCart,
  Sparkles,
  Truck,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, MoneyInput, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  InlineError,
  ListSkeleton,
  ModuleNav,
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

  const totalEstimatedCost = useMemo(() => {
    if (!query.data) return 0;
    let sum = 0;
    for (const group of query.data) {
      if (!group.supplierId) continue;
      for (const line of group.lines) {
        const edit = editOf(line, group.supplierId);
        if (edit.selected) {
          const qty = Number(edit.quantity.replace(",", ".")) || 0;
          sum += Math.round(qty * (edit.unitCost ?? 0));
        }
      }
    }
    return sum;
  }, [query.data, edits]);

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* Navigation Achats / Stock */}
      <ModuleNav section="purchases" />

      {/* En-tête de la page */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Sparkles size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t("suggestions.title")}
              </h1>
              {selectedCount > 0 && (
                <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
                  {selectedCount} article{selectedCount > 1 ? "s" : ""} sélectionné
                  {selectedCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-muted">{t("suggestions.description")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="h-9 gap-1.5 text-xs font-medium"
            loading={create.isPending}
            disabled={selectedCount === 0 || create.isPending}
            onClick={submit}
          >
            <ShoppingCart size={14} />
            <span>{t("suggestions.create")}</span>
          </Button>
        </div>
      </div>

      {/* Cartes KPI intelligentes */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Fournisseurs sollicités</span>
            <Truck size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {query.data?.filter((g) => g.supplierId).length ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-muted">Bons de commande générés</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Articles en réappro</span>
            <Package size={16} className="text-accent" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {selectedCount}
          </div>
          <div className="mt-1 text-[11px] text-muted">Sur seuils d&apos;alerte mini</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Budget prévisionnel</span>
            <Building2 size={16} className="text-status-ok" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {formatFCFA(totalEstimatedCost)}
          </div>
          <div className="mt-1 text-[11px] text-muted">Total estimé HT</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Site concerné</span>
            <Building2 size={16} className="text-muted" />
          </div>
          <div className="mt-1">
            <SiteSelect value={siteId} onChange={setSiteId} />
          </div>
        </div>
      </div>

      {done && (
        <div className="flex items-center gap-2 rounded-xl border border-status-ok/40 bg-status-ok-bg/20 p-3 text-xs text-status-ok font-medium">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{done}</span>
        </div>
      )}

      <InlineError message={create.error ? errorMessage(create.error) : null} />

      {query.isLoading ? (
        <ListSkeleton rows={4} />
      ) : query.isError ? (
        <ErrorBox onRetry={() => query.refetch()} />
      ) : query.data && query.data.length === 0 ? (
        <EmptyState
          title={t("suggestions.empty")}
          description="Tous vos stocks sont au-dessus des seuils de réapprovisionnement configurés."
        />
      ) : null}

      {query.data && query.data.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">{t("suggestions.selectHint")}</p>
          </div>

          {query.data.map((group) => {
            const hasSupplier = Boolean(group.supplierId);

            return (
              <section
                key={group.supplierId ?? "none"}
                className={`flex flex-col gap-3 rounded-xl border p-4 shadow-xs ${
                  hasSupplier
                    ? "border-border/80 bg-surface"
                    : "border-status-warn/40 bg-status-warn-bg/10"
                }`}
              >
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-foreground font-bold">
                      <Truck size={15} />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-foreground">
                        {group.supplierName ?? t("suggestions.noSupplier")}
                      </h2>
                      {!hasSupplier && (
                        <p className="text-xs text-status-warn font-medium">
                          {t("suggestions.noSupplierHint")}
                        </p>
                      )}
                    </div>
                  </div>

                  <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
                    {group.lines.length} référence{group.lines.length > 1 ? "s" : ""}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted">
                      <tr>
                        <th className="py-2.5 pl-2 pr-3">Sélection & Pièce</th>
                        <th className="px-3 py-2.5">Stock projeté / Min</th>
                        <th className="px-3 py-2.5">Motif</th>
                        <th className="px-3 py-2.5 w-32">Qté suggérée</th>
                        <th className="px-3 py-2.5 w-36">Prix unitaire (HT)</th>
                        <th className="py-2.5 pl-3 pr-2 text-right">Sous-total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {group.lines.map((l) => {
                        const edit = editOf(l, group.supplierId);
                        const lineSubtotal = Math.round(
                          (Number(edit.quantity.replace(",", ".")) || 0) * (edit.unitCost ?? 0),
                        );

                        return (
                          <tr
                            key={l.productId}
                            className="group transition-colors hover:bg-surface-2/30"
                          >
                            <td className="py-3 pl-2 pr-3">
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  disabled={!hasSupplier}
                                  checked={!!edit.selected}
                                  onChange={(e) =>
                                    setEdit(l, group.supplierId, { selected: e.target.checked })
                                  }
                                  className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                                />
                                <div>
                                  <div className="font-semibold text-foreground">{l.name}</div>
                                  <div className="text-xs font-mono text-muted">{l.sku}</div>
                                </div>
                              </div>
                            </td>

                            <td className="px-3 py-3 text-xs">
                              <span className="font-medium text-foreground">
                                {qtyText(l.projected, l.quantityScale)}
                              </span>
                              <span className="text-muted"> / min {qtyText(l.minStock, l.quantityScale)}</span>
                            </td>

                            <td className="px-3 py-3">
                              <StatusBadge tone="warn" label={t(`suggestions.reason.${l.reason}`)} />
                            </td>

                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={edit.quantity}
                                  onChange={(e) =>
                                    setEdit(l, group.supplierId, { quantity: e.target.value })
                                  }
                                  className="h-8 w-20 rounded border border-border bg-surface px-2 text-center text-xs font-semibold focus:border-accent focus:outline-none"
                                />
                                <span className="text-xs text-muted">{l.unit}</span>
                              </div>
                            </td>

                            <td className="px-3 py-3">
                              <div className="w-32">
                                <MoneyInput
                                  value={edit.unitCost ?? null}
                                  onChange={(v) => setEdit(l, group.supplierId, { unitCost: v })}
                                />
                              </div>
                            </td>

                            <td className="py-3 pl-3 pr-2 text-right font-semibold tabular-nums text-foreground">
                              {formatFCFA(lineSubtotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
