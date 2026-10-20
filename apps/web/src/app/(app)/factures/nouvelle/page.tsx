"use client";

// M08 §7 `/factures/nouvelle` — vente comptoir / facturation directe : client (recherche),
// véhicule facultatif, ajout de pièces du catalogue ou main-d'œuvre libre, prévisualisation
// des totaux HT/TVA/TTC en temps réel et création de brouillon avec contrôle de conformité.
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Package,
  Plus,
  Receipt,
  Search,
  Trash2,
  User,
  UserCheck,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  Field,
  FormActions,
  FormCard,
  FormSection,
  Input,
  MoneyInput,
  StatusBadge,
} from "@atelieros/ui";
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
  const [customer, setCustomer] = useState<{ id: string; displayName: string; phone?: string | null } | null>(null);
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
    <FormCard
      title="Nouvelle facture directe"
      description="Émettez une vente comptoir directe ou une facture libre avec calcul automatique de la TVA"
      icon={<Receipt size={22} strokeWidth={2.2} />}
      badge={<StatusBadge tone="warn">Vente comptoir</StatusBadge>}
      backHref="/factures"
      backLabel="Retour aux factures"
      maxWidth="2xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (customer && valid.length > 0) {
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
            });
          }
        }}
        className="flex flex-col gap-6"
      >
        {/* Section 1 : Sélection du client */}
        <FormSection
          title="Client & Facturation"
          icon={<User size={18} />}
          description="Associez un client enregistré pour la facturation certifiée"
        >
          {customer ? (
            <div className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg font-bold">
                    <UserCheck size={20} />
                  </div>
                  <div>
                    <span className="font-bold text-foreground text-sm">{customer.displayName}</span>
                    {customer.phone && (
                      <span className="block text-xs text-muted">{customer.phone}</span>
                    )}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setCustomer(null)}>
                  {t("editor.change")}
                </Button>
              </div>

              {/* Sélection du véhicule rattaché */}
              <div className="border-t border-border/60 pt-3">
                <label className="mb-1.5 block text-xs font-semibold text-foreground">
                  {t("fields.vehicle")} (optionnel)
                </label>
                <select
                  aria-label={t("fields.vehicle")}
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:border-accent focus:outline-none"
                >
                  <option value="">{t("editor.noVehicle")}</option>
                  {(detail.data?.vehicles ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate} — {v.make} {v.model}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder={t("editor.searchCustomer")}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {(search.data?.items ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2/40 p-2">
                  {(search.data?.items ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="flex items-center justify-between rounded-lg border border-border/80 bg-surface p-2.5 text-left text-xs transition-colors hover:border-accent hover:bg-surface-2"
                      onClick={() => setCustomer({ id: c.id, displayName: c.displayName, phone: c.phone })}
                    >
                      <span className="font-semibold text-foreground">{c.displayName}</span>
                      <span className="text-muted">{c.phone ?? "Sans téléphone"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </FormSection>

        {/* Section 2 : Lignes de la facture */}
        <FormSection
          title="Lignes de prestations et pièces"
          icon={<Package size={18} />}
          description="Saisissez des prestations d'atelier ou ajoutez directement des pièces du magasin"
        >
          {perms.has("stock:read") && (
            <div className="mb-3 flex flex-col gap-2 rounded-xl border border-dashed border-border p-3 bg-surface-2/20">
              <span className="text-xs font-semibold text-muted">
                Recherche rapide au catalogue magasin
              </span>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder={t("lines.searchProduct")}
                  value={productQ}
                  onChange={(e) => setProductQ(e.target.value)}
                  className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </div>

              {(products.data?.items ?? []).length > 0 && (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {(products.data?.items ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex items-center justify-between rounded-lg border border-border/80 bg-surface p-2 text-left text-xs hover:border-accent hover:bg-surface-2"
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
                      <span className="truncate font-medium text-foreground">{p.name}</span>
                      <span className="shrink-0 font-bold text-accent">{formatFCFA(p.salePrice)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {lines.map((l, i) => (
              <div
                key={l.key}
                className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted uppercase tracking-wider">
                    Ligne #{i + 1}
                  </span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      className="text-muted hover:text-status-bad transition-colors"
                      title={t("lines.remove")}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div className="sm:col-span-3">
                    <Field label="Description" required>
                      <Input
                        placeholder="Ex : Vidange moteur 5W30 + Filtre à huile"
                        value={l.description}
                        onChange={(e) => update(l.key, { description: e.target.value })}
                      />
                    </Field>
                  </div>

                  <div>
                    <Field label={t("lines.type")}>
                      <select
                        value={l.type}
                        disabled={!!l.productId}
                        onChange={(e) => update(l.key, { type: e.target.value as LineType })}
                        className="h-10 w-full rounded-md border border-input bg-surface px-3 text-xs focus:border-accent focus:outline-none"
                      >
                        {(["LABOR", "PART", "CONSUMABLE", "SUBCONTRACT", "FEE"] as const).map(
                          (type) => (
                            <option key={type} value={type}>
                              {t(`lineType.${type}`)}
                            </option>
                          ),
                        )}
                      </select>
                    </Field>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <Field label="Quantité" required>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={l.quantity}
                        onChange={(e) => update(l.key, { quantity: Number(e.target.value) })}
                      />
                    </Field>
                  </div>

                  <div>
                    <Field label="Prix unitaire HT" required>
                      <MoneyInput
                        value={l.unitPrice}
                        onChange={(v) => update(l.key, { unitPrice: v })}
                      />
                    </Field>
                  </div>

                  <div>
                    <Field label="Remise (%)">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={l.discountRate}
                        onChange={(e) => update(l.key, { discountRate: Number(e.target.value) || 0 })}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ))}

            <Button
              variant="secondary"
              className="self-start gap-1.5 text-xs font-medium"
              onClick={() => setLines((ls) => [...ls, emptyLine()])}
            >
              <Plus size={14} />
              <span>{t("lines.add")}</span>
            </Button>
          </div>
        </FormSection>

        {/* Section 3 : Synthèse financière en direct */}
        {preview.data && valid.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2/60 p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{t("totals.subtotal")}</span>
              <span className="font-semibold text-foreground">
                {formatFCFA(preview.data.totals.subtotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{t("totals.vat")} (18%)</span>
              <span className="font-semibold text-foreground">
                {formatFCFA(preview.data.totals.vatTotal)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border/80 pt-2 text-base font-bold text-foreground">
              <span>{t("totals.total")} TTC</span>
              <span className="text-xl text-accent">
                {formatFCFA(preview.data.totals.total)}
              </span>
            </div>
          </div>
        )}

        {create.error && (
          <div className="flex flex-col gap-2 rounded-xl border border-status-bad/40 bg-status-bad-bg/20 p-3 text-xs text-status-bad">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertCircle size={15} />
              <span>{create.error.message}</span>
            </div>
            {/motif/i.test(create.error.message) && (
              <Field label={t("editor.priceReason")} required>
                <Input
                  value={priceReason}
                  onChange={(e) => setPriceReason(e.target.value)}
                  placeholder="Justification de la remise ou modification de tarif..."
                />
              </Field>
            )}
          </div>
        )}

        {/* Boutons d'action */}
        <FormActions
          submitLabel={t("actions.saveDraft")}
          loading={create.isPending}
          disabled={!customer || valid.length === 0}
          onCancel={() => router.push("/factures")}
        />
      </form>
    </FormCard>
  );
}
