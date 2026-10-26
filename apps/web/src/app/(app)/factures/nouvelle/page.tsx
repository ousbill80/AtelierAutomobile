"use client";

// M08 §7 `/factures/nouvelle` — vente comptoir : client (recherche), véhicule facultatif, lignes
// (pièce du catalogue ou saisie libre), totaux en direct (RG-M08-05), enregistrement du brouillon.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, MoneyInput, Select } from "@atelieros/ui";
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

let nextKey = 1;
const emptyLine = (): Line => ({
  key: nextKey++,
  type: "LABOR",
  description: "",
  quantity: 1,
  unitPrice: null,
  discountRate: 0,
});

export default function NewInvoicePage() {
  const router = useRouter();
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<{ id: string; displayName: string } | null>(null);
  const [vehicleId, setVehicleId] = useState("");
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
  const valid = lines.filter((l) => l.description.trim() && l.quantity > 0 && l.unitPrice !== null);
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
  const create = trpc.invoice.createDirect.useMutation({
    onSuccess: (inv) => router.push(`/factures/${inv.id}`),
  });
  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <Link href="/factures" className="text-sm text-accent">
        ← {t("back")}
      </Link>
      <h1 className="text-xl font-semibold">{t("editor.title")}</h1>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <h2 className="font-semibold">{t("editor.customer")}</h2>
        {customer ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{customer.displayName}</span>
              <Button variant="secondary" size="sm" onClick={() => setCustomer(null)}>
                {t("editor.change")}
              </Button>
            </div>
            <Select
              aria-label={t("fields.vehicle")}
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">{t("editor.noVehicle")}</option>
              {(detail.data?.vehicles ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} — {v.make} {v.model}
                </option>
              ))}
            </Select>
          </>
        ) : (
          <>
            <Input
              label={t("editor.searchCustomer")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul className="flex flex-col gap-1">
              {(search.data?.items ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="min-h-11 w-full rounded-md border border-border bg-surface p-2 text-left text-sm hover:border-accent"
                    onClick={() => setCustomer({ id: c.id, displayName: c.displayName })}
                  >
                    {c.displayName} {c.phone ? `· ${c.phone}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label={t("lines.title")}>
        <h2 className="font-semibold">{t("lines.title")}</h2>
        {perms.has("stock:read") && (
          <div className="flex flex-col gap-1">
            <Input
              label={t("lines.searchProduct")}
              value={productQ}
              onChange={(e) => setProductQ(e.target.value)}
            />
            <ul className="flex flex-col gap-1">
              {(products.data?.items ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="min-h-11 w-full rounded-md border border-border bg-surface p-2 text-left text-sm hover:border-accent"
                    onClick={() => {
                      setLines((ls) => [
                        ...ls.filter((l) => l.description.trim()),
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
          </div>
        )}
        {lines.map((l, i) => (
          <div
            key={l.key}
            className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-6"
          >
            <div className="col-span-2 sm:col-span-6">
              <Input
                label={`${t("lines.description")} ${i + 1}`}
                value={l.description}
                onChange={(e) => update(l.key, { description: e.target.value })}
              />
            </div>
            <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-2">
              {t("lines.type")}
              <Select
                value={l.type}
                disabled={!!l.productId}
                onChange={(e) => update(l.key, { type: e.target.value as LineType })}
              >
                {(["LABOR", "PART", "CONSUMABLE", "SUBCONTRACT", "FEE"] as const).map((type) => (
                  <option key={type} value={type}>
                    {t(`lineType.${type}`)}
                  </option>
                ))}
              </Select>
            </label>
            <Input
              label={t("lines.quantity")}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={l.quantity}
              onChange={(e) => update(l.key, { quantity: Number(e.target.value) })}
            />
            <MoneyInput
              label={t("lines.unitPrice")}
              value={l.unitPrice}
              onChange={(v) => update(l.key, { unitPrice: v })}
            />
            <Input
              label={t("lines.discount")}
              type="number"
              min={0}
              max={100}
              value={l.discountRate}
              onChange={(e) => update(l.key, { discountRate: Number(e.target.value) || 0 })}
            />
            <div className="flex items-end">
              <Button
                variant="ghost"
                onClick={() =>
                  setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))
                }
              >
                {t("lines.remove")}
              </Button>
            </div>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
          + {t("lines.add")}
        </Button>
      </section>

      {preview.data && valid.length > 0 && (
        <section className="flex flex-col items-end gap-1 rounded-lg border border-border bg-surface p-3 text-sm">
          <span>
            {t("totals.subtotal")} : {formatFCFA(preview.data.totals.subtotal)}
          </span>
          <span>
            {t("totals.vat")} : {formatFCFA(preview.data.totals.vatTotal)}
          </span>
          <span className="text-base font-semibold">
            {t("totals.total")} : {formatFCFA(preview.data.totals.total)}
          </span>
        </section>
      )}

      {create.error && (
        <div role="alert" className="flex flex-col gap-2 text-sm text-status-bad">
          <p>⚠ {create.error.message}</p>
          {/motif/i.test(create.error.message) && (
            <Input
              label={t("editor.priceReason")}
              value={priceReason}
              onChange={(e) => setPriceReason(e.target.value)}
            />
          )}
        </div>
      )}
      <Button
        disabled={!customer || valid.length === 0}
        loading={create.isPending}
        onClick={() =>
          customer &&
          create.mutate({
            customerId: customer.id,
            vehicleId: vehicleId || undefined,
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
  );
}
