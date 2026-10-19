"use client";

// M05 RG-M05-05 — /parametres/catalogue-mo : opérations (code, nom, catégorie, temps barème,
// type de taux, forfait, kit de pièces, durées par modèle, description client), import CSV.
import { useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, Input, MoneyInput, PageHead, Select, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/quotes/error-box";
import { t } from "@/components/quotes/i18n";
import type { LaborOperationRow } from "@/components/quotes/types";

const RATES = ["STANDARD", "DIAGNOSTIC", "BODYWORK", "ELECTRICAL"] as const;
type Rate = (typeof RATES)[number];

interface Draft {
  id?: string;
  code: string;
  name: string;
  category: string;
  standardHours: string;
  rateType: Rate;
  fixedPrice: number | null;
  customerDescription: string;
  isServiceOperation: boolean;
  defaultParts: string;
  vehicleOverrides: string;
}

const EMPTY: Draft = {
  code: "",
  name: "",
  category: "",
  standardHours: "1",
  rateType: "STANDARD",
  fixedPrice: null,
  customerDescription: "",
  isServiceOperation: false,
  defaultParts: "",
  vehicleOverrides: "",
};

function toDraft(op: LaborOperationRow): Draft {
  const parts = Array.isArray(op.defaultParts) ? (op.defaultParts as { productId?: string; category?: string; quantity?: number }[]) : [];
  const overrides = Array.isArray(op.vehicleOverrides) ? (op.vehicleOverrides as { make: string; model?: string; standardHours: number }[]) : [];
  return {
    id: op.id,
    code: op.code,
    name: op.name,
    category: op.category ?? "",
    standardHours: String(op.standardHours),
    rateType: op.rateType,
    fixedPrice: op.fixedPrice,
    customerDescription: op.customerDescription ?? "",
    isServiceOperation: op.isServiceOperation,
    defaultParts: parts.map((p) => `${p.productId ?? p.category ?? ""};${p.quantity ?? 1}`).join("\n"),
    vehicleOverrides: overrides.map((o) => `${o.make};${o.model ?? ""};${o.standardHours}`).join("\n"),
  };
}

function parseParts(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [ref = "", qty = "1"] = l.split(";");
      const quantity = Number(qty.replace(",", ".")) || 1;
      return ref.startsWith("sku:") ? { productId: ref.slice(4), quantity } : { category: ref, quantity };
    });
}

function parseOverrides(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [make = "", model = "", hours = "1"] = l.split(";");
      return { make, model: model || undefined, standardHours: Number(hours.replace(",", ".")) || 1 };
    });
}

export default function LaborCatalogPage() {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = trpc.laborOperation.list.useQuery({ q: q.trim() || undefined, includeArchived: showArchived });
  const done = (text: string) => {
    setFlash(text);
    setError(null);
    setDraft(null);
    void utils.laborOperation.list.invalidate();
  };
  const onError = (e: { message: string }) => setError(e.message);
  const create = trpc.laborOperation.create.useMutation({ onSuccess: () => done(t("catalog.created")), onError });
  const update = trpc.laborOperation.update.useMutation({ onSuccess: () => done(t("catalog.updated")), onError });
  const archive = trpc.laborOperation.archive.useMutation({ onSuccess: () => done(t("catalog.updated")), onError });
  const importRows = trpc.laborOperation.import.useMutation({ onSuccess: (r) => done(t("catalog.imported", r)), onError });

  const submit = (d: Draft) => {
    const payload = {
      code: d.code.trim().toUpperCase(),
      name: d.name.trim(),
      category: d.category.trim() || null,
      standardHours: Number(d.standardHours.replace(",", ".")) || 0,
      rateType: d.rateType,
      fixedPrice: d.fixedPrice,
      customerDescription: d.customerDescription.trim() || null,
      isServiceOperation: d.isServiceOperation,
      defaultParts: parseParts(d.defaultParts),
      vehicleOverrides: parseOverrides(d.vehicleOverrides),
    };
    if (d.id) update.mutate({ id: d.id, patch: payload });
    else create.mutate(payload);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title={t("catalog.title")}
        description={t("catalog.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <label className="btn btn-secondary min-h-11 cursor-pointer">
              {t("catalog.import")}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  const rows = text
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter((l) => l && !/^code[;,]/i.test(l))
                    .map((l) => {
                      const [code = "", name = "", hours = "0", fixed = "", category = ""] = l.split(/[;,]/);
                      return {
                        code: code.trim().toUpperCase(),
                        name: name.trim(),
                        standardHours: Number(hours.replace(",", ".")) || 0,
                        fixedPrice: fixed.trim() ? Number(fixed.replace(/\D/g, "")) : null,
                        category: category.trim() || null,
                        rateType: "STANDARD" as const,
                      };
                    })
                    .filter((r) => r.code && r.name);
                  if (rows.length) importRows.mutate({ rows });
                  e.target.value = "";
                }}
              />
            </label>
            <Button className="min-h-11" onClick={() => setDraft({ ...EMPTY })}>
              + {t("catalog.new")}
            </Button>
          </div>
        }
      />
      <p className="text-xs text-muted">{t("catalog.importHint")}</p>
      {flash && (
        <p role="status" className="rounded-md bg-status-ok-bg p-2 text-sm text-status-ok">
          {flash}
        </p>
      )}
      {error && <ErrorBox message={error} />}
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label={t("catalog.search")} placeholder={t("catalog.search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t("catalog.showArchived")}
        </label>
      </div>

      {draft && (
        <form
          className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <Input label={t("catalog.code")} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} required />
          <Input label={t("catalog.name")} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          <Input label={t("catalog.category")} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          <Input label={t("catalog.hours")} inputMode="decimal" value={draft.standardHours} onChange={(e) => setDraft({ ...draft, standardHours: e.target.value })} />
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("catalog.rateType")}</span>
            <Select value={draft.rateType} onChange={(e) => setDraft({ ...draft, rateType: e.target.value as Rate })}>
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {t(`catalog.rates.${r}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("catalog.fixedPrice")}</span>
            <MoneyInput aria-label={t("catalog.fixedPrice")} value={draft.fixedPrice} onChange={(v) => setDraft({ ...draft, fixedPrice: v })} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span>{t("catalog.customerDescription")}</span>
            <Textarea rows={2} value={draft.customerDescription} onChange={(e) => setDraft({ ...draft, customerDescription: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("catalog.defaultParts")}</span>
            <Textarea rows={3} placeholder={"Lubrifiants;1\nsku:FIL-HU-01;1"} value={draft.defaultParts} onChange={(e) => setDraft({ ...draft, defaultParts: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("catalog.vehicleOverrides")}</span>
            <Textarea rows={3} placeholder={"Toyota;Corolla;3\nToyota;Hilux;4.5"} value={draft.vehicleOverrides} onChange={(e) => setDraft({ ...draft, vehicleOverrides: e.target.value })} />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={draft.isServiceOperation} onChange={(e) => setDraft({ ...draft, isServiceOperation: e.target.checked })} />
            {t("catalog.serviceOperation")}
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" className="min-h-11" loading={create.isPending || update.isPending}>
              {t("catalog.save")}
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => setDraft(null)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}

      {list.isLoading && <ListSkeleton />}
      {list.isError && <ErrorBox onRetry={() => list.refetch()} />}
      {list.data && list.data.length === 0 && <EmptyState title={t("catalog.empty")} />}
      {list.data && list.data.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm" aria-label={t("catalog.title")}>
          {list.data.map((op) => (
            <li key={op.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 ${op.isActive ? "" : "opacity-60"}`}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">
                  <span className="font-mono text-xs text-muted">{op.code}</span> {op.name}
                </span>
                <span className="text-xs text-muted">
                  {op.category ? `${op.category} · ` : ""}
                  {op.fixedPrice != null ? `forfait ${formatFCFA(op.fixedPrice)}` : `${op.standardHours} h · ${t(`catalog.rates.${op.rateType}`)} · ${formatFCFA(op.pricing.unitPrice)}/h`}
                  {Array.isArray(op.defaultParts) && (op.defaultParts as unknown[]).length > 0 ? ` · kit ${(op.defaultParts as unknown[]).length}` : ""}
                </span>
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setDraft(toDraft(op))}>
                  {t("editor.edit")}
                </Button>
                <Button size="sm" variant="ghost" className="min-h-11" onClick={() => archive.mutate({ id: op.id })}>
                  {op.isActive ? t("catalog.archive") : t("catalog.restore")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
