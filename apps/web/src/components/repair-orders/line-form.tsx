"use client";

// M04 US-M04-09 — saisie d'une ligne d'OR : catalogue MO / pièces, ligne libre, pièce fournie
// par le client, sous-traitance (coût + fournisseur), payeur.
import { useEffect, useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, MoneyInput, Select } from "@atelieros/ui";
import type { LineInput } from "@atelieros/validators";
import { trpc } from "@/trpc/react";
import { t } from "./i18n";

const TYPES = ["LABOR", "PART", "CONSUMABLE", "SUBCONTRACT", "FEE"] as const;
type LineType = (typeof TYPES)[number];

export function LineForm({
  onSubmit,
  submitting,
  showPayer = false,
  error,
}: {
  onSubmit: (line: LineInput & { priceReason?: string }) => Promise<unknown> | void;
  submitting?: boolean;
  showPayer?: boolean;
  error?: string | null;
}) {
  const [type, setType] = useState<LineType>("LABOR");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [catalogId, setCatalogId] = useState<string | undefined>();
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState<number | null>(null);
  const [customerSupplied, setCustomerSupplied] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [costPrice, setCostPrice] = useState<number | null>(null);
  const [payer, setPayer] = useState<"CUSTOMER" | "INSURANCE" | "WARRANTY" | "INTERNAL">(
    "CUSTOMER",
  );
  const [priceReason, setPriceReason] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const catalogKind = type === "LABOR" ? "LABOR" : type === "PART" ? "PART" : null;
  const catalog = trpc.repairOrder.catalog.useQuery(
    { q: debounced, kind: catalogKind ?? "LABOR" },
    { enabled: Boolean(catalogKind) && debounced.length >= 2 },
  );

  const reset = () => {
    setSearch("");
    setCatalogId(undefined);
    setDescription("");
    setQuantity("1");
    setUnitPrice(null);
    setCustomerSupplied(false);
    setSupplierName("");
    setCostPrice(null);
    setPriceReason("");
  };

  const submit = () => {
    const qty = Number(quantity.replace(",", "."));
    if (!description.trim() || !Number.isFinite(qty) || qty <= 0) return;
    const line: LineInput & { priceReason?: string } = {
      type,
      description: description.trim(),
      quantity: qty,
      unitPrice: unitPrice ?? undefined,
      laborOperationId: type === "LABOR" ? catalogId : undefined,
      productId: type === "PART" ? catalogId : undefined,
      isCustomerSupplied: customerSupplied || undefined,
      supplierName: type === "SUBCONTRACT" && supplierName ? supplierName : undefined,
      costPrice: costPrice ?? undefined,
      payer: showPayer ? payer : undefined,
      priceReason: priceReason || undefined,
    };
    // La saisie n'est vidée qu'en cas de succès (motif de prix à compléter sinon).
    Promise.resolve(onSubmit(line)).then(reset, () => undefined);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap gap-2">
        {TYPES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={type === value}
            onClick={() => {
              setType(value);
              setCatalogId(undefined);
            }}
            className={`min-h-11 rounded-md px-3 text-sm ${type === value ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}
          >
            {t(`lineType.${value}`)}
          </button>
        ))}
      </div>
      {catalogKind && (
        <div className="flex flex-col gap-1">
          <Input
            label={t("lines.catalogSearch")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {catalog.data && debounced.length >= 2 && (
            <ul className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border">
              {catalog.data.length === 0 && (
                <li className="p-2 text-sm text-muted">{t("lines.catalogEmpty")}</li>
              )}
              {catalog.data.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-2 px-2 text-left text-sm hover:bg-surface-2"
                    onClick={() => {
                      setCatalogId(item.id);
                      setDescription(item.name);
                      setQuantity(String(item.hours ?? 1));
                      setUnitPrice(item.unitPrice);
                      setSearch("");
                    }}
                  >
                    <span>
                      <span className="font-mono text-xs text-muted">{item.code}</span> {item.name}
                    </span>
                    <span className="text-muted">{formatFCFA(item.unitPrice)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_6rem_10rem]">
        <Input
          label={t("lines.description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Input
          label={type === "LABOR" ? t("lines.hours") : t("lines.quantity")}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("lines.unitPrice")}</span>
          <MoneyInput
            aria-label={t("lines.unitPrice")}
            value={customerSupplied && type === "PART" ? 0 : unitPrice}
            onChange={setUnitPrice}
            disabled={customerSupplied && type === "PART"}
          />
        </label>
      </div>
      {(type === "PART" || type === "LABOR") && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={customerSupplied}
            onChange={(e) => setCustomerSupplied(e.target.checked)}
            className="h-5 w-5"
          />
          {t("lines.customerSupplied")}
        </label>
      )}
      {type === "SUBCONTRACT" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            label={t("lines.supplier")}
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("lines.costPrice")}</span>
            <MoneyInput
              aria-label={t("lines.costPrice")}
              value={costPrice}
              onChange={setCostPrice}
            />
          </label>
        </div>
      )}
      {showPayer && (
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("lines.payer")}</span>
          <Select value={payer} onChange={(e) => setPayer(e.target.value as typeof payer)}>
            {(["CUSTOMER", "INSURANCE", "WARRANTY", "INTERNAL"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`payer.${p}`)}
              </option>
            ))}
          </Select>
        </label>
      )}
      {error && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-status-bad">
            ⚠ {error}
          </p>
          {/minimum/.test(error) && (
            <Input
              label={t("lines.priceReason")}
              value={priceReason}
              onChange={(e) => setPriceReason(e.target.value)}
            />
          )}
        </div>
      )}
      <Button type="button" onClick={submit} loading={submitting} disabled={!description.trim()}>
        {t("lines.add")}
      </Button>
    </div>
  );
}
