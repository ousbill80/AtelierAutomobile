"use client";

// M04 US-M04-09 — saisie intelligente d'une ligne d'OR :
// - Saisie unique fusionnée (Smart Entity Finder / Autocomplete) : recherche en direct
//   dans le catalogue MO et pièces dès la frappe, sélection en 1 clic OU création libre
//   transparente si absent du catalogue.
// - Auto-détection intelligente du type (LABOR, PART, SUBCONTRACT...) selon les mots-clés.
// - Suggestions rapides d'atelier (vidange, freins, plaquettes, etc.).
// - Support pièce client, sous-traitance, prix de revient, répartition payeur.
import { useEffect, useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, MoneyInput, Select } from "@atelieros/ui";
import type { LineInput } from "@atelieros/validators";
import { trpc } from "@/trpc/react";
import { t } from "./i18n";

const TYPES = ["LABOR", "PART", "CONSUMABLE", "SUBCONTRACT", "FEE"] as const;
type LineType = (typeof TYPES)[number];

const QUICK_SUGGESTIONS = [
  { label: "Vidange moteur + filtre", type: "LABOR" as LineType, hours: "1.0", price: 15000 },
  { label: "Remplacement plaquettes AV", type: "LABOR" as LineType, hours: "1.2", price: 18000 },
  { label: "Diagnostic valise électronique", type: "LABOR" as LineType, hours: "0.8", price: 20000 },
  { label: "Filtre à huile", type: "PART" as LineType, hours: "1", price: 6500 },
  { label: "Huile moteur 5W30 (bidon 5L)", type: "CONSUMABLE" as LineType, hours: "1", price: 25000 },
  { label: "Recharge climatisation gaz R134a", type: "LABOR" as LineType, hours: "1.0", price: 25000 },
];

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
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [catalogId, setCatalogId] = useState<string | undefined>();
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
    const id = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(id);
  }, [query]);

  // Recherche dans le catalogue pour le type courant (si applicable)
  const catalogKind = type === "LABOR" ? "LABOR" : type === "PART" ? "PART" : null;
  const catalog = trpc.repairOrder.catalog.useQuery(
    { q: debounced, kind: catalogKind ?? "LABOR" },
    { enabled: Boolean(catalogKind) && debounced.length >= 2 },
  );

  // Auto-détection intelligente du type si l'utilisateur saisit librement
  const detectTypeFromText = (text: string): LineType => {
    const lower = text.toLowerCase();
    if (/(filtre|plaquette|disque|bougie|courroie|amortisseur|pneu|batterie|balai|durite)/i.test(lower)) {
      return "PART";
    }
    if (/(huile|liquide|lave-glace|gaz|degrippant|graisse|chiffon)/i.test(lower)) {
      return "CONSUMABLE";
    }
    if (/(rectification|tourneur|peinture cabine|bobinage|cle cod|reprogrammation)/i.test(lower)) {
      return "SUBCONTRACT";
    }
    if (/(remorquage|gardiennage|frais|dossier)/i.test(lower)) {
      return "FEE";
    }
    return "LABOR";
  };

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setCatalogId(undefined); // dès qu'on édite manuellement, on détache le lien catalogue strict
    setIsDropdownOpen(true);
    // Auto-détection si l'utilisateur commence à saisir sans avoir cliqué sur un bouton de type
    if (!catalogId && val.length > 3) {
      const detected = detectTypeFromText(val);
      if (detected !== type && type === "LABOR") {
        setType(detected);
      }
    }
  };

  const reset = () => {
    setQuery("");
    setCatalogId(undefined);
    setIsDropdownOpen(false);
    setQuantity("1");
    setUnitPrice(null);
    setCustomerSupplied(false);
    setSupplierName("");
    setCostPrice(null);
    setPriceReason("");
  };

  const submit = () => {
    const qty = Number(quantity.replace(",", "."));
    if (!query.trim() || !Number.isFinite(qty) || qty <= 0) return;
    const line: LineInput & { priceReason?: string } = {
      type,
      description: query.trim(),
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
    Promise.resolve(onSubmit(line)).then(reset, () => undefined);
  };

  const applySuggestion = (sug: (typeof QUICK_SUGGESTIONS)[number]) => {
    setType(sug.type);
    setQuery(sug.label);
    setCatalogId(undefined);
    setQuantity(sug.hours);
    setUnitPrice(sug.price);
    setIsDropdownOpen(false);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
      {/* Types de ligne */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TYPES.map((value) => {
          const active = type === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setType(value);
                setCatalogId(undefined);
              }}
              className={`min-h-10 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                active
                  ? "bg-accent text-accent-foreground shadow-sm ring-1 ring-accent/30"
                  : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
              }`}
            >
              {t(`lineType.${value}`)}
            </button>
          );
        })}
      </div>

      {/* Champ unique intelligent : recherche catalogue ou saisie libre */}
      <div className="relative flex flex-col gap-1">
        <label className="text-xs font-semibold text-muted">
          {t("lines.description")}
          {catalogId && (
            <span className="ml-2 inline-flex items-center rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">
              ✓ {t("lines.catalogMatch")}
            </span>
          )}
        </label>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => setIsDropdownOpen(true)}
            placeholder={t("lines.searchPlaceholder")}
            className="w-full min-h-11 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCatalogId(undefined);
                setUnitPrice(null);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>

        {/* Menu déroulant intelligent si recherche en cours */}
        {isDropdownOpen && catalogKind && debounced.length >= 2 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg backdrop-blur-sm">
            {catalog.isLoading && (
              <div className="p-3 text-center text-xs text-muted animate-pulse">
                Recherche dans le catalogue...
              </div>
            )}
            {!catalog.isLoading && catalog.data && catalog.data.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <span className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Résultats catalogue
                </span>
                {catalog.data.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2"
                    onClick={() => {
                      setCatalogId(item.id);
                      setQuery(item.name);
                      setQuantity(String(item.hours ?? 1));
                      setUnitPrice(item.unitPrice);
                      setIsDropdownOpen(false);
                    }}
                  >
                    <span className="flex flex-col">
                      <span className="font-medium text-foreground">{item.name}</span>
                      <span className="font-mono text-[10px] text-muted">{item.code}</span>
                    </span>
                    <span className="font-semibold text-accent whitespace-nowrap">
                      {formatFCFA(item.unitPrice)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!catalog.isLoading && (!catalog.data || catalog.data.length === 0) && (
              <div className="p-2.5 text-xs text-muted">
                <p className="font-medium text-foreground">« {query} »</p>
                <p className="mt-0.5 text-[11px]">
                  {t("lines.customLine")} — complétez la quantité et le prix unitaire ci-dessous.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Puces de suggestions rapides si le champ est vide */}
      {!query && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] font-medium text-muted">Fréquent :</span>
          {QUICK_SUGGESTIONS.map((sug, i) => (
            <button
              key={i}
              type="button"
              onClick={() => applySuggestion(sug)}
              className="rounded-full border border-border/80 bg-surface-2/70 px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent/40 hover:bg-surface-2 hover:text-foreground"
            >
              + {sug.label}
            </button>
          ))}
        </div>
      )}

      {/* Ligne des quantités et tarifs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr]">
        <Input
          label={type === "LABOR" ? t("lines.hours") : t("lines.quantity")}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-semibold text-muted">{t("lines.unitPrice")}</span>
          <MoneyInput
            aria-label={t("lines.unitPrice")}
            value={customerSupplied && type === "PART" ? 0 : unitPrice}
            onChange={setUnitPrice}
            disabled={customerSupplied && type === "PART"}
          />
        </label>
      </div>

      {/* Cas pièce client */}
      {(type === "PART" || type === "LABOR") && (
        <label className="flex min-h-10 items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={customerSupplied}
            onChange={(e) => setCustomerSupplied(e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          <span>{t("lines.customerSupplied")}</span>
        </label>
      )}

      {/* Sous-traitance */}
      {type === "SUBCONTRACT" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            label={t("lines.supplier")}
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-semibold text-muted">{t("lines.costPrice")}</span>
            <MoneyInput
              aria-label={t("lines.costPrice")}
              value={costPrice}
              onChange={setCostPrice}
            />
          </label>
        </div>
      )}

      {/* Payeur optionnel */}
      {showPayer && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-semibold text-muted">{t("lines.payer")}</span>
          <Select value={payer} onChange={(e) => setPayer(e.target.value as typeof payer)}>
            {(["CUSTOMER", "INSURANCE", "WARRANTY", "INTERNAL"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`payer.${p}`)}
              </option>
            ))}
          </Select>
        </label>
      )}

      {/* Gestion des erreurs / motif dérogation prix */}
      {error && (
        <div className="flex flex-col gap-2 rounded-lg border border-status-bad/40 bg-status-bad-bg p-2 text-xs text-status-bad">
          <p role="alert">⚠ {error}</p>
          {/minimum/.test(error) && (
            <Input
              label={t("lines.priceReason")}
              value={priceReason}
              onChange={(e) => setPriceReason(e.target.value)}
            />
          )}
        </div>
      )}

      <Button
        type="button"
        onClick={submit}
        loading={submitting}
        disabled={!query.trim()}
        className="mt-1 w-full sm:w-auto self-end min-h-11 font-medium"
      >
        + {t("lines.add")}
      </Button>
    </div>
  );
}
