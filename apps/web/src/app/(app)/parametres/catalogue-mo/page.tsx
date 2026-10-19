"use client";

// M05 §7 / RG-M05-05 — /parametres/catalogue-mo : opérations de main-d'œuvre (code, nom,
// catégorie, temps barème, type de taux, forfait, description client, durées par modèle),
// archivage et import CSV.
import { useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  EmptyState,
  Input,
  Modal,
  MoneyInput,
  PageHead,
  Select,
  Textarea,
} from "@atelieros/ui";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/quotes/i18n";
import { trpc } from "@/trpc/react";

const RATE_TYPES = ["STANDARD", "DIAGNOSTIC", "BODYWORK", "ELECTRICAL"] as const;
type RateType = (typeof RATE_TYPES)[number];

interface Draft {
  id?: string;
  code: string;
  name: string;
  category: string;
  standardHours: string;
  rateType: RateType;
  fixedPrice: number | null;
  customerDescription: string;
  overrides: string;
}

const EMPTY: Draft = {
  code: "",
  name: "",
  category: "",
  standardHours: "1",
  rateType: "STANDARD",
  fixedPrice: null,
  customerDescription: "",
  overrides: "",
};

/** « Toyota Hilux 4,5 » par ligne → durées spécifiques (RG-M05-05). */
function parseOverrides(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/\s+/);
      const hours = Number((parts.pop() ?? "").replace(",", "."));
      const [make, ...model] = parts;
      return { make: make ?? "", model: model.join(" ") || null, standardHours: hours };
    })
    .filter((o) => o.make && Number.isFinite(o.standardHours));
}

export default function LaborCatalogPage() {
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const list = trpc.laborOperation.list.useQuery({ q: q || undefined, includeArchived: archived });
  const done = () => {
    setDraft(null);
    void list.refetch();
  };
  const create = trpc.laborOperation.create.useMutation({ onSuccess: done });
  const update = trpc.laborOperation.update.useMutation({ onSuccess: done });
  const archive = trpc.laborOperation.archive.useMutation({ onSuccess: () => void list.refetch() });
  const importCsv = trpc.laborOperation.import.useMutation({
    onSuccess: () => void list.refetch(),
  });
  const error = create.error ?? update.error;

  return (
    <div className="flex flex-col gap-4">
      <PageHead title={t("catalog.title")} description={t("catalog.description")} />
      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 flex-1">
          <Input
            aria-label={t("catalog.search")}
            placeholder={t("catalog.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button onClick={() => setDraft(EMPTY)}>+ {t("catalog.new")}</Button>
        <Button variant="secondary" onClick={() => setCsvOpen(true)}>
          {t("catalog.import")}
        </Button>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
        {t("catalog.showArchived")}
      </label>
      {list.isLoading ? (
        <ListSkeleton />
      ) : list.isError || !list.data ? (
        <ErrorBox onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState title={t("catalog.empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.map((op) => (
            <li
              key={op.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
            >
              <span className="min-w-0">
                <span className="font-mono text-xs text-muted">{op.code}</span> {op.name}
                {op.category ? <span className="text-muted"> · {op.category}</span> : null}
                <br />
                <span className="text-xs text-muted">
                  {op.fixedPrice != null
                    ? t("catalog.fixed", { amount: formatFCFA(op.fixedPrice) })
                    : `${op.standardHours} h · ${t(`rateTypes.${op.rateType}`)}`}
                  {!op.isActive ? ` · ${t("catalog.archived")}` : ""}
                </span>
              </span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() =>
                    setDraft({
                      id: op.id,
                      code: op.code,
                      name: op.name,
                      category: op.category ?? "",
                      standardHours: String(op.standardHours),
                      rateType: op.rateType,
                      fixedPrice: op.fixedPrice,
                      customerDescription: op.customerDescription ?? "",
                      overrides: (
                        (op.vehicleOverrides as {
                          make: string;
                          model?: string | null;
                          standardHours: number;
                        }[]) ?? []
                      )
                        .map((o) => `${o.make}${o.model ? ` ${o.model}` : ""} ${o.standardHours}`)
                        .join("\n"),
                    })
                  }
                >
                  {t("catalog.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() => archive.mutate({ id: op.id, archived: op.isActive })}
                >
                  {op.isActive ? t("catalog.archive") : t("catalog.restore")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <Modal
          open
          size="lg"
          title={draft.id ? t("catalog.edit") : t("catalog.new")}
          onClose={() => setDraft(null)}
          footer={
            <Button
              loading={create.isPending || update.isPending}
              disabled={!draft.code.trim() || draft.name.trim().length < 2}
              onClick={() => {
                const data = {
                  code: draft.code.trim(),
                  name: draft.name.trim(),
                  category: draft.category.trim() || null,
                  standardHours: Number(draft.standardHours.replace(",", ".")) || 0,
                  rateType: draft.rateType,
                  fixedPrice: draft.fixedPrice,
                  customerDescription: draft.customerDescription.trim() || null,
                  vehicleOverrides: parseOverrides(draft.overrides),
                };
                if (draft.id) update.mutate({ id: draft.id, patch: data });
                else create.mutate(data);
              }}
            >
              {t("catalog.save")}
            </Button>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              label={t("catalog.code")}
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            />
            <Input
              label={t("catalog.name")}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Input
              label={t("catalog.category")}
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
            <Input
              label={t("catalog.hours")}
              inputMode="decimal"
              value={draft.standardHours}
              onChange={(e) => setDraft({ ...draft, standardHours: e.target.value })}
            />
            <label className="flex flex-col gap-1 text-sm">
              {t("catalog.rateType")}
              <Select
                value={draft.rateType}
                className="min-h-11"
                onChange={(e) => setDraft({ ...draft, rateType: e.target.value as RateType })}
              >
                {RATE_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {t(`rateTypes.${r}`)}
                  </option>
                ))}
              </Select>
            </label>
            <MoneyInput
              label={t("catalog.fixedPrice")}
              value={draft.fixedPrice}
              onChange={(v) => setDraft({ ...draft, fixedPrice: v })}
            />
          </div>
          <label className="mt-2 flex flex-col gap-1 text-sm">
            {t("catalog.customerDescription")}
            <Textarea
              rows={2}
              value={draft.customerDescription}
              onChange={(e) => setDraft({ ...draft, customerDescription: e.target.value })}
            />
          </label>
          <label className="mt-2 flex flex-col gap-1 text-sm">
            {t("catalog.overrides")}
            <Textarea
              rows={3}
              placeholder="Toyota Hilux 4,5"
              value={draft.overrides}
              onChange={(e) => setDraft({ ...draft, overrides: e.target.value })}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-status-bad">
              ⚠ {error.message}
            </p>
          )}
        </Modal>
      )}
      <Modal
        open={csvOpen}
        title={t("catalog.import")}
        onClose={() => setCsvOpen(false)}
        footer={
          <Button
            loading={importCsv.isPending}
            disabled={!csv.trim()}
            onClick={() => importCsv.mutate({ csv })}
          >
            {t("catalog.importSubmit")}
          </Button>
        }
      >
        <p className="text-sm text-muted">{t("catalog.importHint")}</p>
        <Textarea
          rows={8}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          aria-label={t("catalog.import")}
        />
        {importCsv.data && (
          <p role="status" className="text-sm">
            {t("catalog.importResult", {
              created: importCsv.data.created,
              updated: importCsv.data.updated,
              errors: importCsv.data.errors.length,
            })}
          </p>
        )}
      </Modal>
    </div>
  );
}
