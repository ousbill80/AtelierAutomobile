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

export function LinesEditor({
  lines,
  onChange,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ProductPicker
        label={t("purchases.addLine")}
        onPick={(p) =>
          lines.some((l) => l.product.id === p.id)
            ? undefined
            : onChange([
                ...lines,
                { product: p, quantity: "1", unitCost: p.purchasePrice ?? p.averageCost ?? null },
              ])
        }
      />
      <ul className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <li
            key={l.product.id}
            className="flex flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-end"
          >
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">{l.product.name}</div>
              <div className="text-xs text-muted">{l.product.sku}</div>
            </div>
            <div className="w-full sm:w-28">
              <Input
                label={`${t("common.quantity")} (${l.product.unit})`}
                inputMode="decimal"
                value={l.quantity}
                onChange={(e) =>
                  onChange(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
                }
              />
            </div>
            <div className="w-full sm:w-40">
              <Field label={t("common.unitCost")}>
                <MoneyInput
                  value={l.unitCost}
                  onChange={(v) =>
                    onChange(lines.map((x, j) => (j === i ? { ...x, unitCost: v } : x)))
                  }
                />
              </Field>
            </div>
            <div className="text-sm sm:w-28 sm:text-right">{formatFCFA(lineTotal(l))}</div>
            <Button variant="ghost" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
              {t("common.remove")}
            </Button>
          </li>
        ))}
      </ul>
      {lines.length > 0 ? (
        <p className="text-right font-medium">
          {t("common.total")} : {formatFCFA(lines.reduce((s, l) => s + lineTotal(l), 0))}
        </p>
      ) : null}
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
  const valid =
    supplierId &&
    siteId &&
    lines.length > 0 &&
    lines.every((l) => Number(l.quantity.replace(",", ".")) > 0 && l.unitCost != null);
  return (
    <Modal
      open
      size="lg"
      title={t("purchases.new")}
      onClose={onClose}
      footer={
        <>
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
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label={t("purchases.supplier")}>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <SiteSelect value={siteId} onChange={setSiteId} />
          <Input
            label={t("purchases.expectedAt")}
            type="date"
            value={expectedAt}
            onChange={(e) => setExpectedAt(e.target.value)}
          />
        </div>
        <LinesEditor lines={lines} onChange={setLines} />
        <InlineError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </Modal>
  );
}
