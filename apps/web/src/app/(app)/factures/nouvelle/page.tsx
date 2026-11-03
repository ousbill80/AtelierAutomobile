"use client";

// M08 §7 `/factures/nouvelle` — vente comptoir : en-tête (client, véhicule, devise, conditions)
// puis lignes en tableau (désignation, qté, prix, remise, HT, TTC), totaux en direct.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, MoneyInput, Select, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/components/billing/i18n";

type LineType = "LABOR" | "PART" | "SUBCONTRACT" | "FEE" | "CONSUMABLE";
interface Line {
  key: number;
  type: LineType;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number | null;
  discountRate: number;
}

const LINE_TYPES = ["LABOR", "PART", "CONSUMABLE", "SUBCONTRACT", "FEE"] as const;

let nextKey = 1;
const emptyLine = (): Line => ({
  key: nextKey++,
  type: "LABOR",
  description: "",
  quantity: 1,
  unitPrice: null,
  discountRate: 0,
});

function ready(line: Line) {
  return line.description.trim().length > 0 && line.quantity > 0 && line.unitPrice !== null;
}

function vatLabel(subtotal: number, vat: number) {
  if (subtotal === 0) return vat === 0 ? "0" : "—";
  const rate = (vat * 100) / subtotal;
  const rounded = Math.round(rate);
  return Math.abs(rate - rounded) < 0.05 ? String(rounded) : "—";
}

export default function NewInvoicePage() {
  const router = useRouter();
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<{ id: string; displayName: string } | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [productQ, setProductQ] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const search = trpc.customer.list.useQuery(
    { q: q.trim(), limit: 8 },
    { enabled: q.trim().length >= 2 && !customer },
  );
  const detail = trpc.customer.get.useQuery({ id: customer?.id ?? "" }, { enabled: !!customer });
  const products = trpc.product.search.useQuery(
    { q: productQ.trim(), limit: 6 },
    { enabled: productQ.trim().length >= 2 && perms.has("stock:read") },
  );
  const valid = lines.filter(ready);
  const preview = trpc.invoice.preview.useQuery(
    {
      lines: valid.map((l) => ({
        type: l.type,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice ?? 0,
        discountRate: l.discountRate,
      })),
    },
    { enabled: valid.length > 0 },
  );
  const amounts = new Map<number, { ht: number; ttc: number; vat: string }>();
  const previewLines = preview.data?.lines;
  if (previewLines) {
    valid.forEach((line, index) => {
      const row = previewLines[index];
      if (!row) return;
      amounts.set(line.key, {
        ht: row.lineSubtotal,
        ttc: row.lineTotal,
        vat: vatLabel(row.lineSubtotal, row.lineVat),
      });
    });
  }
  const create = trpc.invoice.createDirect.useMutation({
    onSuccess: (inv) => router.push(`/factures/${inv.id}`),
  });
  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: number) =>
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [emptyLine()]));

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-10">
      <header className="flex flex-col gap-1">
        <Link href="/factures" className="min-h-11 text-sm font-medium text-accent">
          ← {t("title")}
        </Link>
        <h1 className="text-2xl font-semibold">{t("editor.title")}</h1>
        <p className="text-sm text-muted">{t("editor.subtitle")}</p>
      </header>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-semibold">{t("sheet.header")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-sm font-medium">{t("editor.customer")}</span>
            {customer ? (
              <div className="flex min-h-12 items-center justify-between gap-2 rounded-md border border-border px-3">
                <span className="min-w-0 truncate font-semibold">{customer.displayName}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCustomer(null);
                    setVehicleId("");
                  }}
                >
                  {t("editor.change")}
                </Button>
              </div>
            ) : (
              <>
                <Input
                  aria-label={t("editor.searchCustomer")}
                  placeholder={t("editor.searchCustomer")}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {(search.data?.items.length ?? 0) > 0 && (
                  <ul className="flex flex-col gap-1">
                    {search.data?.items.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-left text-sm hover:border-accent"
                          onClick={() => {
                            setCustomer({ id: c.id, displayName: c.displayName });
                            setQ("");
                          }}
                        >
                          {c.displayName}
                          {c.phone ? ` · ${c.phone}` : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <label className="flex min-w-0 flex-col gap-2 text-sm">
            <span className="font-medium">{t("fields.vehicle")}</span>
            <Select
              aria-label={t("fields.vehicle")}
              value={vehicleId}
              disabled={!customer}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">{t("editor.noVehicle")}</option>
              {(detail.data?.vehicles ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} — {v.make} {v.model}
                </option>
              ))}
            </Select>
          </label>

          <ReadOnly label={t("editor.issuedBy")} value={me.data?.user.name ?? "—"} />
          <ReadOnly label={t("sheet.currency")} value={t("sheet.currencyValue")} />
          <ReadOnly label={t("editor.invoiceDate")} value={t("editor.dateValue")} />
          <ReadOnly label={t("fields.dueDate")} value={t("editor.dueValue")} />

          <label className="flex min-w-0 flex-col gap-2 text-sm sm:col-span-2">
            <span className="font-medium">{t("editor.notesLabel")}</span>
            <Textarea
              aria-label={t("editor.notesLabel")}
              placeholder={t("editor.notesPlaceholder")}
              value={notes}
              rows={3}
              style={{ height: "auto", minHeight: "5.5rem" }}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section
        className="min-w-0 rounded-lg border border-border bg-surface p-4"
        aria-label={t("sheet.lines")}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-semibold">{t("sheet.lines")}</h2>
          {perms.has("stock:read") && (
            <div className="w-full min-w-0 sm:max-w-sm">
              <Input
                aria-label={t("lines.searchProduct")}
                placeholder={t("lines.searchProduct")}
                value={productQ}
                onChange={(e) => setProductQ(e.target.value)}
              />
            </div>
          )}
        </div>
        {(products.data?.items.length ?? 0) > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {products.data?.items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="min-h-11 w-full rounded-md border border-border px-3 text-left text-sm hover:border-accent"
                  onClick={() => {
                    setLines((ls) => [
                      ...ls.filter((l) => l.description.trim() || l.unitPrice !== null),
                      {
                        ...emptyLine(),
                        type: "PART",
                        productId: p.id,
                        description: p.name,
                        unitPrice: p.salePrice,
                      },
                    ]);
                    setProductQ("");
                  }}
                >
                  {p.name} · {formatFCFA(p.salePrice)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 hidden min-w-0 overflow-x-auto lg:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <th className="w-8 py-2 pr-2 font-semibold">{t("lines.index")}</th>
                <th className="py-2 pr-2 font-semibold">{t("lines.description")}</th>
                <th className="w-36 py-2 pr-2 font-semibold">{t("lines.type")}</th>
                <th className="w-20 py-2 pr-2 text-right font-semibold">{t("lines.quantity")}</th>
                <th className="w-36 py-2 pr-2 text-right font-semibold">
                  {t("lines.unitPriceShort")}
                </th>
                <th className="w-20 py-2 pr-2 text-right font-semibold">{t("lines.discount")}</th>
                <th className="w-16 py-2 pr-2 text-right font-semibold">{t("lines.vat")}</th>
                <th className="w-28 py-2 pr-2 text-right font-semibold">{t("lines.ht")}</th>
                <th className="w-28 py-2 pr-2 text-right font-semibold">{t("lines.ttc")}</th>
                <th className="w-12 py-2 font-semibold">
                  <span className="sr-only">{t("lines.remove")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const amount = amounts.get(line.key);
                return (
                  <tr key={line.key} className="border-b border-border align-top">
                    <td className="py-2 pr-2 text-muted">{index + 1}</td>
                    <td className="py-2 pr-2">
                      <Input
                        aria-label={`${t("lines.description")} ${index + 1}`}
                        value={line.description}
                        onChange={(e) => update(line.key, { description: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-2">
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
                    <td className="py-2 pr-2">
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
                    <td className="py-2 pr-2">
                      <MoneyInput
                        aria-label={`${t("lines.unitPriceShort")} ${index + 1}`}
                        value={line.unitPrice}
                        onChange={(v) => update(line.key, { unitPrice: v })}
                      />
                    </td>
                    <td className="py-2 pr-2">
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
                    <td className="py-3 pr-2 text-right tabular-nums text-muted">
                      {amount?.vat ?? "—"}
                    </td>
                    <td className="py-3 pr-2 text-right tabular-nums">
                      {amount ? formatFCFA(amount.ht) : "—"}
                    </td>
                    <td className="py-3 pr-2 text-right font-semibold tabular-nums">
                      {amount ? formatFCFA(amount.ttc) : "—"}
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
                    placeholder={t("lines.description")}
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
                      onChange={(v) => update(line.key, { unitPrice: v })}
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
                    <p className="flex min-h-12 items-center justify-end text-sm font-semibold tabular-nums">
                      {amount ? formatFCFA(amount.ttc) : "—"}
                    </p>
                  </Labeled>
                </div>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className="mt-3 min-h-11 text-sm font-semibold text-accent"
          onClick={() => setLines((ls) => [...ls, emptyLine()])}
        >
          + {t("lines.add")}
        </button>

        {preview.data && valid.length > 0 && (
          <dl className="mt-4 ml-auto w-full max-w-xs text-sm">
            <div className="flex justify-between gap-6 py-1">
              <dt className="text-muted">{t("totals.subtotal")}</dt>
              <dd className="tabular-nums">{formatFCFA(preview.data.totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between gap-6 py-1">
              <dt className="text-muted">{t("totals.vat")}</dt>
              <dd className="tabular-nums">{formatFCFA(preview.data.totals.vatTotal)}</dd>
            </div>
            <div className="mt-1 flex justify-between gap-6 border-t border-border py-2 text-base font-semibold">
              <dt>{t("totals.total")}</dt>
              <dd className="tabular-nums">{formatFCFA(preview.data.totals.total)}</dd>
            </div>
          </dl>
        )}
      </section>

      {create.error && (
        <div role="alert" className="flex flex-col gap-2 text-sm text-status-bad">
          <p>⚠ {create.error.message}</p>
          {/motif/i.test(create.error.message) && (
            <Input
              aria-label={t("editor.priceReason")}
              placeholder={t("editor.priceReason")}
              value={priceReason}
              onChange={(e) => setPriceReason(e.target.value)}
            />
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          className="min-h-11"
          disabled={!customer || valid.length === 0}
          loading={create.isPending}
          onClick={() =>
            customer &&
            create.mutate({
              customerId: customer.id,
              vehicleId: vehicleId || undefined,
              notes: notes.trim() || undefined,
              priceReason: priceReason.trim() || undefined,
              lines: valid.map((l) => ({
                type: l.type,
                productId: l.productId,
                description: l.description.trim(),
                quantity: l.quantity,
                unitPrice: l.unitPrice ?? 0,
                discountRate: l.discountRate,
              })),
            })
          }
        >
          {t("actions.saveDraft")}
        </Button>
      </div>
    </div>
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

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex min-h-12 items-center rounded-md border border-border bg-surface-2 px-3 text-muted">
        {value}
      </span>
    </div>
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
