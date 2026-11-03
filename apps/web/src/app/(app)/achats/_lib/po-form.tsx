"use client";

// RG-M07-08 — saisie d'un bon de commande : fournisseur, site, date souhaitée, lignes
// (produit, quantité en unités d'affichage, coût unitaire HT).
import { useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Field, Input, Modal, MoneyInput, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  InlineError,
  ProductPicker,
  SiteSelect,
  useDefaultSite,
  type PickedProduct,
} from "../../stock/_lib/components";
import { errorMessage, t } from "../../stock/_lib/i18n";

export interface DraftLine {
  product: Pick<PickedProduct, "id" | "name" | "sku" | "unit">;
  quantity: string;
  unitCost: number | null;
}

export function lineTotal(line: DraftLine): number {
  const qty = Number(line.quantity.replace(",", "."));
  return Number.isFinite(qty) && line.unitCost != null ? Math.round(qty * line.unitCost) : 0;
}

/** Saisie basse : les intitulés sont dans l'en-tête, pas répétés sur chaque ligne. */
const compactInput = { height: 34, padding: "0 8px", fontSize: 13 };

export function LinesEditor({
  lines,
  onChange,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  return (
    <div className="form-dense flex flex-col gap-3 border-t border-border pt-4">
      <div>
        <h4 className="text-sm font-semibold">{t("purchases.lines")}</h4>
        <p className="text-xs text-muted">{t("purchases.linesHint")}</p>
      </div>
      <ProductPicker
        label={t("purchases.addLine")}
        onPick={(p) => {
          if (lines.some((l) => l.product.id === p.id)) {
            setNotice(t("purchases.alreadyAdded"));
            return;
          }
          setNotice(null);
          onChange([
            ...lines,
            { product: p, quantity: "1", unitCost: p.purchasePrice ?? p.averageCost ?? null },
          ]);
        }}
      />
      {notice ? (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      ) : null}
      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted">
          {t("purchases.linesEmpty")}
        </p>
      ) : (
        <div>
          <div className="hidden grid-cols-[minmax(0,1fr)_6rem_9.5rem_6.5rem] gap-2 px-1 pb-1 text-xs font-medium text-muted sm:grid">
            <span>{t("common.product")}</span>
            <span>{t("common.quantity")}</span>
            <span>{t("common.unitCost")}</span>
            <span className="text-right">{t("common.total")}</span>
          </div>
          <ul>
            {lines.map((l, i) => (
              <li
                key={l.product.id}
                className="grid grid-cols-1 items-center gap-2 border-t border-border py-2 sm:grid-cols-[minmax(0,1fr)_6rem_9.5rem_6.5rem] sm:py-1.5"
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{l.product.name}</div>
                    <div className="text-xs text-muted">
                      {l.product.sku}
                      {" · "}
                      {l.product.unit}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => onChange(lines.filter((_, j) => j !== i))}
                  >
                    {t("common.remove")}
                  </Button>
                </div>
                <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 sm:contents">
                  <span className="col-span-3 grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2 text-[11px] leading-none text-muted sm:hidden">
                    <span>
                      {t("common.quantity")} ({l.product.unit})
                    </span>
                    <span>{t("common.unitCost")}</span>
                    <span className="text-right">{t("common.total")}</span>
                  </span>
                  <Input
                    aria-label={`${t("common.quantity")} (${l.product.unit})`}
                    inputMode="decimal"
                    className="num"
                    style={compactInput}
                    value={l.quantity}
                    onChange={(e) =>
                      onChange(
                        lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                      )
                    }
                  />
                  <MoneyInput
                    aria-label={t("common.unitCost")}
                    style={compactInput}
                    value={l.unitCost}
                    onChange={(v) =>
                      onChange(lines.map((x, j) => (j === i ? { ...x, unitCost: v } : x)))
                    }
                  />
                  <div className="min-w-[5.5rem] text-right text-sm font-medium tabular-nums">
                    {formatFCFA(lineTotal(l))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-border pt-2 text-right text-sm font-medium">
            {t("common.total")} : {formatFCFA(total)}
          </p>
        </div>
      )}
    </div>
  );
}

export function toLineInput(lines: DraftLine[]) {
  return lines.map((l) => ({
    productId: l.product.id,
    quantity: Number(l.quantity.replace(",", ".")),
    unitCost: l.unitCost ?? 0,
  }));
}

export function CreatePurchaseOrderModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const suppliers = trpc.supplier.list.useQuery({});
  const [supplierId, setSupplierId] = useState("");
  const [siteId, setSiteId] = useDefaultSite();
  const [expectedAt, setExpectedAt] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const create = trpc.purchaseOrder.create.useMutation({ onSuccess: (po) => onCreated(po.id) });
  const linesReady = lines.every(
    (l) => Number(l.quantity.replace(",", ".")) > 0 && l.unitCost != null,
  );
  const valid = Boolean(supplierId && siteId && lines.length > 0 && linesReady);
  const blocker = !supplierId
    ? t("purchases.needSupplier")
    : !siteId
      ? t("purchases.needSite")
      : lines.length === 0
        ? t("purchases.needLines")
        : !linesReady
          ? t("purchases.needAmounts")
          : null;
  return (
    <Modal
      open
      size="lg"
      title={t("purchases.new")}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          {blocker ? <p className="mr-auto text-sm text-muted">{blocker}</p> : null}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={create.isPending}
            disabled={!valid || create.isPending}
            onClick={() =>
              create.mutate({
                supplierId,
                siteId,
                expectedAt: expectedAt || null,
                lines: toLineInput(lines),
              })
            }
          >
            {t("purchases.create")}
          </Button>
        </div>
      }
    >
      <div className="form-dense flex flex-col gap-4">
        <p className="text-sm text-muted">{t("purchases.intro")}</p>
        <section className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t("purchases.supplier")}>
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t("purchases.supplierPlaceholder")}</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <SiteSelect value={siteId} onChange={setSiteId} />
          <Input
            label={t("purchases.expectedAt")}
            hint={t("common.optional")}
            type="date"
            value={expectedAt}
            onChange={(e) => setExpectedAt(e.target.value)}
          />
        </section>
        <LinesEditor lines={lines} onChange={setLines} />
        <InlineError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </Modal>
  );
}
