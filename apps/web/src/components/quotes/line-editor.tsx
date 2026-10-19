"use client";

// M05 §7 — éditeur de lignes : barre de recherche unique (MO, pièces, forfaits + kit) avec
// disponibilité, ligne libre, édition en place (qté, PU, remise, payeur, optionnel, priorité,
// groupe, explication client). Mobile : lignes en cartes empilées.
import { useEffect, useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, MoneyInput, Select, Textarea } from "@atelieros/ui";
import type { QuoteLineInput } from "@atelieros/validators";
import { trpc } from "@/trpc/react";
import { PriorityBadge } from "./badges";
import { t } from "./i18n";
import type { QuoteDetail, QuoteLineDetail } from "./types";

const TYPES = ["LABOR", "PART", "CONSUMABLE", "SUBCONTRACT", "FEE"] as const;
const PAYERS = ["CUSTOMER", "INSURANCE", "WARRANTY", "INTERNAL"] as const;
const PRIORITIES = ["NONE", "URGENT", "WATCH"] as const;

export function CatalogSearch({
  quote,
  onAdd,
  onAddKit,
  busy,
}: {
  quote: QuoteDetail;
  onAdd: (line: QuoteLineInput) => void;
  onAddKit: (laborOperationId: string) => void;
  busy: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [free, setFree] = useState(false);
  const [freeType, setFreeType] = useState<(typeof TYPES)[number]>("LABOR");
  const [freeDescription, setFreeDescription] = useState("");
  const [freeQty, setFreeQty] = useState("1");
  const [freePrice, setFreePrice] = useState<number | null>(null);
  const [freeCost, setFreeCost] = useState<number | null>(null);
  const [customerSupplied, setCustomerSupplied] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const catalog = trpc.quote.catalog.useQuery(
    { q: debounced, siteId: quote.siteId },
    { enabled: debounced.length >= 2 },
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <Input
        aria-label={t("editor.catalogSearch")}
        placeholder={t("editor.catalogSearch")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {debounced.length >= 2 && catalog.data && (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
          {catalog.data.length === 0 && <li className="text-muted">{t("editor.noResult")}</li>}
          {catalog.data.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 p-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">
                  {item.name} <span className="font-mono text-xs text-muted">{item.code}</span>
                </span>
                <span className="text-xs text-muted">
                  {item.kind === "LABOR"
                    ? item.fixed
                      ? `${t("editor.types.LABOR")} · forfait ${formatFCFA(item.unitPrice)}`
                      : `${t("editor.types.LABOR")} · ${item.hours} h × ${formatFCFA(item.unitPrice)}`
                    : `${t("editor.types.PART")} · ${formatFCFA(item.unitPrice)} · ${
                        item.available == null
                          ? ""
                          : item.available > 0
                            ? t("editor.inStock", { count: item.available })
                            : t("editor.toOrder", { days: item.leadTimeDays ?? 3 })
                      }`}
                </span>
              </span>
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() =>
                    onAdd(
                      item.kind === "LABOR"
                        ? {
                            type: "LABOR",
                            laborOperationId: item.id,
                            description: item.name,
                            quantity: item.hours ?? 1,
                            customerExplanation: item.customerDescription ?? undefined,
                          }
                        : { type: "PART", productId: item.id, description: item.name, quantity: 1 },
                    )
                  }
                >
                  + {t("editor.addLine")}
                </Button>
                {item.kind === "LABOR" && item.kitParts > 0 && (
                  <Button size="sm" className="min-h-11" disabled={busy} onClick={() => onAddKit(item.id)}>
                    {t("editor.addKit")}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="link-btn self-start" onClick={() => setFree((v) => !v)}>
        {free ? "− " : "+ "}
        {t("editor.freeLine")}
      </button>
      {free && (
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!freeDescription.trim()) return;
            onAdd({
              type: freeType,
              description: freeDescription.trim(),
              quantity: Number(freeQty.replace(",", ".")) || 1,
              unitPrice: customerSupplied ? 0 : (freePrice ?? 0),
              costPrice: freeCost ?? undefined,
              isCustomerSupplied: freeType === "PART" ? customerSupplied : undefined,
            });
            setFreeDescription("");
            setFreePrice(null);
            setFreeCost(null);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("editor.type")}</span>
            <Select value={freeType} onChange={(e) => setFreeType(e.target.value as typeof freeType)}>
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`editor.types.${ty}`)}
                </option>
              ))}
            </Select>
          </label>
          <Input
            label={t("editor.description")}
            value={freeDescription}
            onChange={(e) => setFreeDescription(e.target.value)}
          />
          <Input
            label={freeType === "LABOR" ? t("editor.hours") : t("editor.quantity")}
            inputMode="decimal"
            value={freeQty}
            onChange={(e) => setFreeQty(e.target.value)}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("editor.unitPrice")}</span>
            <MoneyInput
              aria-label={t("editor.unitPrice")}
              value={freePrice}
              onChange={setFreePrice}
              disabled={customerSupplied}
            />
          </label>
          {freeType === "PART" && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={customerSupplied}
                onChange={(e) => setCustomerSupplied(e.target.checked)}
              />
              {t("editor.customerSupplied")}
            </label>
          )}
          {(freeType === "PART" || freeType === "SUBCONTRACT") && (
            <label className="flex flex-col gap-1 text-sm">
              <span>Coût d&apos;achat estimé</span>
              <MoneyInput aria-label="Coût d'achat estimé" value={freeCost} onChange={setFreeCost} />
            </label>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" className="min-h-11" disabled={busy}>
              + {t("editor.addLine")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function LineRow({
  line,
  editable,
  canViewCost,
  myCap,
  onUpdate,
  onRemove,
  busy,
}: {
  line: QuoteLineDetail;
  editable: boolean;
  canViewCost: boolean;
  myCap: { line: number; global: number };
  onUpdate: (patch: Partial<QuoteLineInput>) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [unitPrice, setUnitPrice] = useState<number | null>(line.unitPrice);
  const [discount, setDiscount] = useState(String(line.discountRate));
  const [payer, setPayer] = useState<string>(line.payer);
  const [optional, setOptional] = useState(line.isOptional);
  const [priority, setPriority] = useState<string>(line.priority ?? "NONE");
  const [groupLabel, setGroupLabel] = useState(line.groupLabel ?? "");
  const [groupKey, setGroupKey] = useState(line.groupKey ?? "");
  const [explanation, setExplanation] = useState(line.customerExplanation ?? "");
  const [priceReason, setPriceReason] = useState("");

  const overCap = Number(discount) > myCap.line;
  const belowMin =
    line.product?.minSalePrice != null && unitPrice != null && unitPrice < line.product.minSalePrice;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">
            {line.description}
            {line.isCustomerSupplied ? ` — ${t("editor.customerSupplied")}` : ""}
          </span>
          <span className="text-xs text-muted">
            {t(`editor.types.${line.type}`)} · {line.quantity.toLocaleString("fr-FR")}
            {line.type === "LABOR" ? " h" : ""} × {formatFCFA(line.unitPrice)}
            {line.discountRate ? ` · −${line.discountRate} %` : ""} · TVA {line.vatRate} % ·{" "}
            {t(`editor.payers.${line.payer}`)}
            {line.isOptional ? ` · ${t("editor.optional")}` : ""}
            {line.availability != null && line.type === "PART"
              ? line.availability >= line.quantity
                ? ` · ${t("editor.inStock", { count: line.availability })}`
                : ` · ${t("editor.toOrder", { days: line.leadTimeDays ?? 3 })}`
              : ""}
          </span>
          {line.groupLabel && (
            <span className="text-xs text-muted">
              {t("editor.group")} : {line.groupLabel}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-semibold">{formatFCFA(line.lineTotal)}</span>
          {line.accepted === true && <span className="text-xs text-status-ok">✓ {t("detail.accepted")}</span>}
          {line.accepted === false && (
            <span className="text-xs text-status-bad">
              ✗ {t("detail.declined")}
              {line.declineReason ? ` (${t(`decision.reasons.${line.declineReason}`)})` : ""}
            </span>
          )}
          {line.priority && <PriorityBadge priority={line.priority} />}
        </div>
      </div>
      {canViewCost && line.costPrice != null && (
        <span className="text-xs text-muted">
          Coût : {formatFCFA(Math.round(line.costPrice * line.quantity))}
        </span>
      )}
      {editable && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setEditing(true)}>
            {t("editor.edit")}
          </Button>
          <Button size="sm" variant="danger" className="min-h-11" disabled={busy} onClick={onRemove}>
            {t("editor.remove")}
          </Button>
        </div>
      )}
      {editable && editing && (
        <form
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            onUpdate({
              quantity: Number(quantity.replace(",", ".")) || line.quantity,
              unitPrice: unitPrice ?? line.unitPrice,
              discountRate: Math.max(0, Math.min(100, Number(discount) || 0)),
              payer: payer as QuoteLineInput["payer"],
              isOptional: optional,
              priority: priority === "NONE" ? null : (priority as "URGENT" | "WATCH"),
              groupLabel: groupLabel.trim() || null,
              groupKey: groupKey.trim() || null,
              customerExplanation: explanation.trim() || null,
              priceReason: priceReason.trim() || undefined,
            });
            setEditing(false);
          }}
        >
          <Input
            label={line.type === "LABOR" ? t("editor.hours") : t("editor.quantity")}
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("editor.unitPrice")}</span>
            <MoneyInput aria-label={t("editor.unitPrice")} value={unitPrice} onChange={setUnitPrice} />
          </label>
          <Input
            label={t("editor.discount")}
            inputMode="numeric"
            value={discount}
            invalid={overCap}
            onChange={(e) => setDiscount(e.target.value)}
          />
          {overCap && (
            <p className="text-xs text-status-warn sm:col-span-3">
              {t("editor.discountCapExceeded", { cap: myCap.line })}
            </p>
          )}
          {belowMin && (
            <Input
              label={t("editor.priceReason")}
              value={priceReason}
              onChange={(e) => setPriceReason(e.target.value)}
            />
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("editor.payer")}</span>
            <Select value={payer} onChange={(e) => setPayer(e.target.value)}>
              {PAYERS.map((p) => (
                <option key={p} value={p}>
                  {t(`editor.payers.${p}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("editor.priority")}</span>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={optional}
              onChange={(e) => setOptional(e.target.checked)}
            />
            {t("editor.optional")}
          </label>
          <Input label={t("editor.group")} value={groupKey} onChange={(e) => setGroupKey(e.target.value)} />
          <Input
            label={t("editor.groupLabel")}
            value={groupLabel}
            onChange={(e) => setGroupLabel(e.target.value)}
          />
          <label className="flex flex-col gap-1 text-sm sm:col-span-3">
            <span>{t("editor.explanation")}</span>
            <Textarea
              rows={2}
              placeholder={t("editor.explanationHint")}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
            />
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" className="min-h-11" disabled={busy}>
              {t("editor.save")}
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
