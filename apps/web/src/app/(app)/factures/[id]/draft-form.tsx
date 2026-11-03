"use client";

// Brouillon : le même écran que la facture, avec les champs modifiables
// (échéance, conditions, lignes) et l'ajout d'une ligne.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { amountInWords, formatFCFA } from "@atelieros/core/money";
import { Button, Input, MoneyInput, PlateBadge, Select, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/components/billing/i18n";

type LineType = "LABOR" | "PART" | "SUBCONTRACT" | "FEE" | "CONSUMABLE";

interface DraftLine {
  key: string;
  id?: string;
  type: LineType;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number | null;
  discountRate: number;
  vatRate: number;
}

const LINE_TYPES: LineType[] = ["LABOR", "PART", "CONSUMABLE", "SUBCONTRACT", "FEE"];

let nextKey = 1;
function emptyLine(): DraftLine {
  return {
    key: `new-${nextKey++}`,
    type: "LABOR",
    description: "",
    quantity: 1,
    unitPrice: null,
    discountRate: 0,
    vatRate: 0,
  };
}

function asLineType(value: string): LineType {
  return LINE_TYPES.includes(value as LineType) ? (value as LineType) : "LABOR";
}

function ready(line: DraftLine) {
  return line.description.trim().length > 0 && line.quantity > 0 && line.unitPrice !== null;
}

function isBlank(line: DraftLine) {
  return !line.id && !line.description.trim() && line.unitPrice === null;
}

function vatLabel(subtotal: number, vat: number) {
  if (subtotal === 0) return vat === 0 ? "0" : "—";
  const rate = (vat * 100) / subtotal;
  const rounded = Math.round(rate);
  return Math.abs(rate - rounded) < 0.05 ? String(rounded) : "—";
}

export interface DraftFormData {
  timeZone: string;
  vatEnabled: boolean;
  terms: string;
  canSearchProducts: boolean;
  invoice: {
    id: string;
    dueDate: Date | null;
    notes: string | null;
    mileage: number | null;
  };
  lines: Array<{
    id: string;
    type: string;
    productId: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
    discountRate: number;
    vatRate: number;
    depositInvoiceId: string | null;
  }>;
  customer: {
    id: string;
    displayName: string;
    phone: string | null;
    address: string | null;
    ncc: string | null;
    rccm: string | null;
  };
  vehicle: { plate: string; make: string; model: string } | null;
  repairOrder: { id: string; number: string } | null;
  creditedInvoice: { id: string; number: string | null } | null;
  onSaved: () => void;
}

export function InvoiceDraftForm(data: DraftFormData) {
  const { invoice: inv } = data;
  const [dueDate, setDueDate] = useState(inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : "");
  const [notes, setNotes] = useState(inv.notes ?? "");
  const [priceReason, setPriceReason] = useState("");
  const [productQ, setProductQ] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() => {
    const seeded = data.lines
      .filter((line) => !line.depositInvoiceId)
      .map((line) => ({
        key: line.id,
        id: line.id,
        type: asLineType(line.type),
        productId: line.productId ?? undefined,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate,
        vatRate: line.vatRate,
      }));
    return seeded.length > 0 ? seeded : [emptyLine()];
  });
  const products = trpc.product.search.useQuery(
    { q: productQ.trim(), limit: 6 },
    { enabled: productQ.trim().length >= 2 && data.canSearchProducts },
  );
  const valid = lines.filter(ready);
  const incomplete = lines.some((line) => !ready(line) && !isBlank(line));
  const preview = trpc.invoice.preview.useQuery(
    {
      lines: valid.map((line) => ({
        type: line.type,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? 0,
        discountRate: line.discountRate,
        vatRate: line.id ? line.vatRate : undefined,
      })),
    },
    { enabled: valid.length > 0 },
  );
  const amounts = new Map<string, { ht: number; ttc: number; vat: string }>();
  preview.data?.lines.forEach((row, index) => {
    const line = valid[index];
    if (!line) return;
    amounts.set(line.key, {
      ht: row.lineSubtotal,
      ttc: row.lineTotal,
      vat: vatLabel(row.lineSubtotal, row.lineVat),
    });
  });
  const save = trpc.invoice.update.useMutation({ onSuccess: () => data.onSaved() });
  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const remove = (key: string) =>
    setLines((current) => {
      const next = current.filter((line) => line.key !== key);
      return next.length > 0 ? next : [emptyLine()];
    });
  const totals = preview.data?.totals;

  const identity = [
    data.customer.phone,
    data.customer.address,
    data.customer.ncc ? `NCC ${data.customer.ncc}` : null,
    data.customer.rccm ? `RCCM ${data.customer.rccm}` : null,
  ].filter(Boolean);

  return (
    <>
      <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_20rem] lg:items-start">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              {t("fields.customer")}
            </p>
            <Link
              href={`/clients/${data.customer.id}`}
              className="mt-1 block text-lg font-semibold text-accent"
            >
              {data.customer.displayName}
            </Link>
            {identity.length > 0 && (
              <p className="mt-1 text-sm text-muted">{identity.join(" · ")}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {data.vehicle ? (
                <span className="flex flex-wrap items-center gap-2">
                  <PlateBadge plate={data.vehicle.plate} />
                  <span>
                    {data.vehicle.make} {data.vehicle.model}
                    {inv.mileage != null ? ` · ${inv.mileage.toLocaleString("fr-FR")} km` : ""}
                  </span>
                </span>
              ) : (
                <span className="text-muted">{t("fields.vehicle")} —</span>
              )}
              {data.repairOrder && (
                <Link href={`/ordres/${data.repairOrder.id}`} className="font-medium text-accent">
                  {data.repairOrder.number}
                </Link>
              )}
              {data.creditedInvoice && (
                <Link
                  href={`/factures/${data.creditedInvoice.id}`}
                  className="font-medium text-accent"
                >
                  {t("sheet.origin")} {data.creditedInvoice.number}
                </Link>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("fields.dueDate")}</span>
              <input
                type="date"
                className="input"
                aria-label={t("fields.dueDate")}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <span className="text-xs text-muted">{data.terms}</span>
              <span className="text-xs text-muted">{t("sheet.dueHint")}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("editor.mention")}</span>
              <Textarea
                aria-label={t("editor.mention")}
                placeholder={t("editor.notesPlaceholder")}
                value={notes}
                rows={2}
                style={{ height: "auto", minHeight: "4.5rem" }}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
        </div>
      </section>

      <section
        className="min-w-0 rounded-lg border border-border bg-surface p-4 sm:p-5"
        aria-label={t("sheet.lines")}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">{t("sheet.lines")}</h2>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {data.canSearchProducts && (
              <div className="w-full sm:w-72">
                <Input
                  aria-label={t("lines.searchProduct")}
                  placeholder={t("lines.searchProduct")}
                  value={productQ}
                  onChange={(e) => setProductQ(e.target.value)}
                />
              </div>
            )}
            <Button
              variant="secondary"
              className="min-h-11 shrink-0"
              onClick={() => setLines((current) => [...current, emptyLine()])}
            >
              + {t("lines.add")}
            </Button>
          </div>
        </div>
        {(products.data?.items.length ?? 0) > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {products.data?.items.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  className="min-h-11 w-full rounded-md border border-border px-3 text-left text-sm hover:border-accent"
                  onClick={() => {
                    setLines((current) => [
                      ...current.filter(
                        (line) => line.description.trim() || line.unitPrice !== null,
                      ),
                      {
                        ...emptyLine(),
                        type: "PART",
                        productId: product.id,
                        description: product.name,
                        unitPrice: product.salePrice,
                      },
                    ]);
                    setProductQ("");
                  }}
                >
                  {product.name} · {formatFCFA(product.salePrice)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 hidden min-w-0 overflow-x-auto lg:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <th className="w-8 py-2 pr-3">{t("lines.index")}</th>
                <th className="py-2 pr-3">{t("lines.description")}</th>
                <th className="w-40 py-2 pr-3">{t("lines.type")}</th>
                <th className="w-20 py-2 pr-3">{t("lines.quantity")}</th>
                <th className="w-36 py-2 pr-3">{t("lines.unitPriceShort")}</th>
                <th className="w-20 py-2 pr-3">{t("lines.discount")}</th>
                <th className="w-32 py-2 pr-2 text-right">{t("lines.ttc")}</th>
                <th className="w-11 py-2">
                  <span className="sr-only">{t("lines.remove")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const amount = amounts.get(line.key);
                return (
                  <tr key={line.key} className="border-b border-border align-middle">
                    <td className="py-2 pr-3 text-muted">{index + 1}</td>
                    <td className="py-2 pr-3">
                      <Input
                        aria-label={`${t("lines.description")} ${index + 1}`}
                        value={line.description}
                        onChange={(e) => update(line.key, { description: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Select
                        aria-label={`${t("lines.type")} ${index + 1}`}
                        value={line.type}
                        disabled={!!line.productId}
                        onChange={(e) => update(line.key, { type: e.target.value as LineType })}
                      >
                        {LINE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {t(`lineType.${type}`)}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        aria-label={`${t("lines.quantity")} ${index + 1}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={line.quantity}
                        onChange={(e) => update(line.key, { quantity: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <MoneyInput
                        aria-label={`${t("lines.unitPriceShort")} ${index + 1}`}
                        value={line.unitPrice}
                        onChange={(value) => update(line.key, { unitPrice: value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        aria-label={`${t("lines.discount")} ${index + 1}`}
                        type="number"
                        min={0}
                        max={100}
                        value={line.discountRate}
                        onChange={(e) =>
                          update(line.key, { discountRate: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <span className="block font-semibold tabular-nums">
                        {amount ? formatFCFA(amount.ttc) : "—"}
                      </span>
                      {data.vatEnabled && (
                        <span className="block text-xs text-muted">
                          {amount?.vat ?? line.vatRate} %
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <RemoveLine onClick={() => remove(line.key)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <ul className="mt-3 flex flex-col gap-3 lg:hidden">
          {lines.map((line, index) => {
            const amount = amounts.get(line.key);
            return (
              <li
                key={line.key}
                className="flex flex-col gap-2 rounded-md border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-muted">
                    {t("lines.index")} {index + 1}
                  </span>
                  <RemoveLine onClick={() => remove(line.key)} />
                </div>
                <Labeled label={t("lines.description")}>
                  <Input
                    aria-label={`${t("lines.description")} ${index + 1}`}
                    value={line.description}
                    onChange={(e) => update(line.key, { description: e.target.value })}
                  />
                </Labeled>
                <Labeled label={t("lines.type")}>
                  <Select
                    aria-label={`${t("lines.type")} ${index + 1}`}
                    value={line.type}
                    disabled={!!line.productId}
                    onChange={(e) => update(line.key, { type: e.target.value as LineType })}
                  >
                    {LINE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`lineType.${type}`)}
                      </option>
                    ))}
                  </Select>
                </Labeled>
                <div className="grid grid-cols-2 gap-2">
                  <Labeled label={t("lines.quantity")}>
                    <Input
                      aria-label={`${t("lines.quantity")} ${index + 1}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={line.quantity}
                      onChange={(e) => update(line.key, { quantity: Number(e.target.value) })}
                    />
                  </Labeled>
                  <Labeled label={t("lines.unitPriceShort")}>
                    <MoneyInput
                      aria-label={`${t("lines.unitPriceShort")} ${index + 1}`}
                      value={line.unitPrice}
                      onChange={(value) => update(line.key, { unitPrice: value })}
                    />
                  </Labeled>
                  <Labeled label={t("lines.discount")}>
                    <Input
                      aria-label={`${t("lines.discount")} ${index + 1}`}
                      type="number"
                      min={0}
                      max={100}
                      value={line.discountRate}
                      onChange={(e) =>
                        update(line.key, { discountRate: Number(e.target.value) || 0 })
                      }
                    />
                  </Labeled>
                  <Labeled label={t("lines.ttc")}>
                    <p className="flex min-h-11 items-center justify-end text-sm font-semibold tabular-nums">
                      {amount ? formatFCFA(amount.ttc) : "—"}
                    </p>
                  </Labeled>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex flex-col gap-4 border-t border-border pt-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            {totals && (
              <p className="text-sm text-muted">
                {t("totals.inWords", { words: amountInWords(Math.abs(totals.total)) })}
              </p>
            )}
            {incomplete && (
              <p className="mt-2 text-sm text-status-warn">{t("editor.incomplete")}</p>
            )}
            {save.error && (
              <div role="alert" className="mt-2 flex flex-col gap-2 text-sm text-status-bad">
                <p>⚠ {save.error.message}</p>
                {/motif/i.test(save.error.message) && (
                  <Input
                    aria-label={t("editor.priceReason")}
                    placeholder={t("editor.priceReason")}
                    value={priceReason}
                    onChange={(e) => setPriceReason(e.target.value)}
                  />
                )}
              </div>
            )}
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
            {totals && (
              <dl className="w-full text-sm sm:w-64">
                <div className="flex justify-between gap-6 py-1">
                  <dt className="text-muted">{t("totals.subtotal")}</dt>
                  <dd className="tabular-nums">{formatFCFA(totals.subtotal)}</dd>
                </div>
                <div className="flex justify-between gap-6 py-1">
                  <dt className="text-muted">{t("totals.vat")}</dt>
                  <dd className="tabular-nums">{formatFCFA(totals.vatTotal)}</dd>
                </div>
                <div className="mt-1 flex justify-between gap-6 border-t border-border py-2 text-base font-semibold">
                  <dt>{t("totals.total")}</dt>
                  <dd className="tabular-nums">{formatFCFA(totals.total)}</dd>
                </div>
              </dl>
            )}
            <Button
              className="min-h-11 w-full sm:w-auto"
              disabled={valid.length === 0 || incomplete}
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  id: inv.id,
                  notes: notes.trim() || null,
                  dueDate: dueDate || null,
                  priceReason: priceReason.trim() || undefined,
                  lines: valid.map((line) => ({
                    id: line.id,
                    type: line.type,
                    productId: line.productId,
                    description: line.description.trim(),
                    quantity: line.quantity,
                    unitPrice: line.unitPrice ?? 0,
                    discountRate: Math.round(line.discountRate),
                    vatRate: line.id ? line.vatRate : undefined,
                  })),
                })
              }
            >
              {t("actions.saveDraft")}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
      {label}
      {children}
    </label>
  );
}

function RemoveLine({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={t("lines.remove")}
      className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-status-bad"
      onClick={onClick}
    >
      <Trash2 size={16} aria-hidden />
    </button>
  );
}
