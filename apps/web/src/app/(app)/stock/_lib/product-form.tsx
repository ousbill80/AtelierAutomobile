"use client";

// US-M07-01/02 — création et modification d'un produit (références, prix, seuils, compatibilités).
import { useState } from "react";
import { formatCompatibility } from "@atelieros/core/inventory";
import { Button, CheckboxRow, Field, Input, Modal, MoneyInput, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { InlineError } from "./components";
import { errorMessage, t } from "./i18n";

const UNITS = ["pièce", "litre", "kit", "jeu", "mètre", "kg"] as const;
type Unit = (typeof UNITS)[number];

export interface ProductFormValues {
  id?: string;
  sku: string;
  name: string;
  brand: string;
  oemReference: string;
  barcode: string;
  category: string;
  unit: Unit;
  salePrice: number | null;
  minSalePrice: number | null;
  vatRate: number;
  minStock: number;
  reorderQty: number | null;
  packSize: number;
  isStocked: boolean;
  crossReferences: string;
  compatibleWith: string[];
  defaultSupplierId: string;
}

export function emptyProduct(partial?: Partial<ProductFormValues>): ProductFormValues {
  return {
    sku: "",
    name: "",
    brand: "",
    oemReference: "",
    barcode: "",
    category: "",
    unit: "pièce",
    salePrice: null,
    minSalePrice: null,
    vatRate: 18,
    minStock: 0,
    reorderQty: null,
    packSize: 1,
    isStocked: true,
    crossReferences: "",
    compatibleWith: [],
    defaultSupplierId: "",
    ...partial,
  };
}

export function ProductFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: ProductFormValues;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [values, setValues] = useState<ProductFormValues>(initial);
  const [compat, setCompat] = useState({ make: "", model: "", yearFrom: "", yearTo: "" });
  const [compatError, setCompatError] = useState<string | null>(null);
  const suppliers = trpc.supplier.list.useQuery({}, { enabled: open });
  const categories = trpc.product.categories.useQuery(undefined, { enabled: open });
  const utils = trpc.useUtils();
  const create = trpc.product.create.useMutation();
  const update = trpc.product.update.useMutation();
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function set<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function addCompat() {
    try {
      const entry = formatCompatibility({
        make: compat.make,
        model: compat.model || null,
        yearFrom: compat.yearFrom ? Number(compat.yearFrom) : null,
        yearTo: compat.yearTo ? Number(compat.yearTo) : null,
      });
      if (!values.compatibleWith.includes(entry)) {
        set("compatibleWith", [...values.compatibleWith, entry]);
      }
      setCompat({ make: "", model: "", yearFrom: "", yearTo: "" });
      setCompatError(null);
    } catch (e) {
      setCompatError(errorMessage(e));
    }
  }

  async function submit() {
    const payload = {
      sku: values.sku.trim(),
      name: values.name.trim(),
      brand: values.brand || null,
      oemReference: values.oemReference || null,
      barcode: values.barcode || null,
      category: values.category || null,
      unit: values.unit,
      salePrice: values.salePrice ?? 0,
      minSalePrice: values.minSalePrice,
      vatRate: values.vatRate,
      minStock: values.minStock,
      reorderQty: values.reorderQty,
      packSize: values.packSize,
      isStocked: values.isStocked,
      crossReferences: values.crossReferences
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      compatibleWith: values.compatibleWith,
      defaultSupplierId: values.defaultSupplierId || null,
    };
    const saved = values.id
      ? await update.mutateAsync({ id: values.id, ...payload })
      : await create.mutateAsync(payload);
    await utils.product.invalidate();
    onSaved(saved.id);
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={values.id ? t("product.titleEdit") : t("product.titleNew")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={pending}
            disabled={pending || !values.sku.trim() || values.name.trim().length < 2}
            onClick={() => void submit().catch(() => undefined)}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Input
          label={t("product.sku")}
          value={values.sku}
          onChange={(e) => set("sku", e.target.value)}
        />
        <Input
          label={t("product.name")}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
        />
        <Input
          label={t("product.brand")}
          value={values.brand}
          onChange={(e) => set("brand", e.target.value)}
        />
        <Input
          label={t("product.oemReference")}
          value={values.oemReference}
          onChange={(e) => set("oemReference", e.target.value)}
        />
        <Input
          label={t("product.barcode")}
          inputMode="numeric"
          value={values.barcode}
          onChange={(e) => set("barcode", e.target.value)}
        />
        <Field label={t("product.category")}>
          <Input
            list="stock-categories"
            value={values.category}
            onChange={(e) => set("category", e.target.value)}
          />
        </Field>
        <datalist id="stock-categories">
          {(categories.data ?? []).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Field label={t("product.unit")}>
          <Select value={values.unit} onChange={(e) => set("unit", e.target.value as Unit)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`units.${u}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("product.defaultSupplier")}>
          <Select
            value={values.defaultSupplierId}
            onChange={(e) => set("defaultSupplierId", e.target.value)}
          >
            <option value="">{t("product.noSupplier")}</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("product.salePrice")}>
          <MoneyInput value={values.salePrice} onChange={(v) => set("salePrice", v)} />
        </Field>
        <Field label={t("product.minSalePrice")}>
          <MoneyInput value={values.minSalePrice} onChange={(v) => set("minSalePrice", v)} />
        </Field>
        <Input
          label={t("product.minStock")}
          type="number"
          min={0}
          value={values.minStock}
          onChange={(e) => set("minStock", Math.max(0, Math.round(Number(e.target.value) || 0)))}
        />
        <Input
          label={t("product.reorderQty")}
          type="number"
          min={0}
          value={values.reorderQty ?? ""}
          onChange={(e) =>
            set("reorderQty", e.target.value === "" ? null : Math.round(Number(e.target.value)))
          }
        />
        <Input
          label={t("product.packSize")}
          type="number"
          min={1}
          value={values.packSize}
          onChange={(e) => set("packSize", Math.max(1, Math.round(Number(e.target.value) || 1)))}
        />
        <Input
          label={t("product.vatRate")}
          type="number"
          min={0}
          max={100}
          value={values.vatRate}
          onChange={(e) => set("vatRate", Math.round(Number(e.target.value) || 0))}
        />
        <div className="md:col-span-2">
          <Input
            label={t("product.crossReferences")}
            hint={t("product.crossReferencesHint")}
            value={values.crossReferences}
            onChange={(e) => set("crossReferences", e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <CheckboxRow
            label={t("product.isStocked")}
            checked={values.isStocked}
            onChange={(e) => set("isStocked", e.target.checked)}
          />
        </div>
        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="text-sm font-medium">{t("product.compatibility")}</legend>
          {values.compatibleWith.length === 0 ? (
            <p className="text-sm text-muted">{t("product.compatNone")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {values.compatibleWith.map((c) => (
                <li
                  key={c}
                  className="flex items-center gap-1 rounded-md bg-surface-2 px-2 text-sm"
                >
                  <span>{c.replace(/\|/g, " · ")}</span>
                  <button
                    type="button"
                    className="min-h-11 min-w-11"
                    aria-label={`${t("common.remove")} ${c}`}
                    onClick={() =>
                      set(
                        "compatibleWith",
                        values.compatibleWith.filter((x) => x !== c),
                      )
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Input
              aria-label={t("product.compatMake")}
              placeholder={t("product.compatMake")}
              value={compat.make}
              onChange={(e) => setCompat({ ...compat, make: e.target.value })}
            />
            <Input
              aria-label={t("product.compatModel")}
              placeholder={t("product.compatModel")}
              value={compat.model}
              onChange={(e) => setCompat({ ...compat, model: e.target.value })}
            />
            <Input
              aria-label={t("product.compatFrom")}
              placeholder={t("product.compatFrom")}
              inputMode="numeric"
              value={compat.yearFrom}
              onChange={(e) => setCompat({ ...compat, yearFrom: e.target.value })}
            />
            <Input
              aria-label={t("product.compatTo")}
              placeholder={t("product.compatTo")}
              inputMode="numeric"
              value={compat.yearTo}
              onChange={(e) => setCompat({ ...compat, yearTo: e.target.value })}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!compat.make.trim()}
              onClick={addCompat}
            >
              {t("common.add")}
            </Button>
          </div>
          <InlineError message={compatError} />
        </fieldset>
        <div className="md:col-span-2">
          <InlineError message={error ? errorMessage(error) : null} />
        </div>
      </div>
    </Modal>
  );
}
