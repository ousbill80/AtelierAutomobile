"use client";

// M15 §7 `/parametres/documents` — numérotation par type de document (US-M15-06, RG-M15-12) :
// aperçu du prochain numéro, modification du préfixe, du format, du nombre de chiffres, des
// options « par site » / « remise à zéro annuelle » et de la valeur de départ (à la hausse
// uniquement, RG-M15-06). Les refus du serveur (règles fiscales, baisse) sont affichés tels quels.
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, Card, CheckboxRow, Field, Input, Modal, PageHead } from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type NumberingRow = inferRouterOutputs<AppRouter>["numbering"]["get"][number];
type NumberingConfig = NumberingRow["config"];

const DOC_TYPES = ["OR", "DEV", "BC", "FAC", "AV", "REC", "INV", "TR", "SIN"];
const FISCAL_TYPES = new Set(["FAC", "AV", "REC"]);

function docTypeLabel(docType: string): string {
  return DOC_TYPES.includes(docType) ? t(`documentSettings.types.${docType}`) : docType;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rendu local identique à `renderNumberingPattern` (core) pour l'aperçu en direct. */
function renderPattern(config: NumberingConfig, value: number, year: number): string {
  const yyyy = String(year).padStart(4, "0");
  return config.pattern
    .replace(/\{TYPE\}/g, config.prefix)
    .replace(/\{SITE\}/g, config.perSite ? "XXX" : "")
    .replace(/\{AAAA\}/g, yyyy)
    .replace(/\{AA\}/g, yyyy.slice(-2))
    .replace(/\{MM\}/g, "")
    .replace(/\{N+\}/g, String(value).padStart(config.padding, "0"));
}

/** Retrouve la valeur séquentielle contenue dans l'aperçu renvoyé par le serveur. */
function extractNextValue(config: NumberingConfig, preview: string, year: number): number {
  const yyyy = String(year).padStart(4, "0");
  const source = config.pattern
    .split(/(\{[A-Z]+\})/)
    .map((part) => {
      if (/^\{N+\}$/.test(part)) return "(\\d+)";
      if (part === "{TYPE}") return escapeRegex(config.prefix);
      if (part === "{SITE}") return config.perSite ? "XXX" : "";
      if (part === "{AAAA}") return yyyy;
      if (part === "{AA}") return yyyy.slice(-2);
      if (part === "{MM}") return "";
      return escapeRegex(part);
    })
    .join("");
  const match = new RegExp(`^${source}$`).exec(preview);
  const value = match?.[1] ? Number(match[1]) : NaN;
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function Skeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

export default function DocumentSettingsPage() {
  const me = trpc.me.get.useQuery();
  const numbering = trpc.numbering.get.useQuery();
  const [editing, setEditing] = useState<NumberingRow | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const year = new Date().getFullYear();

  if (numbering.isError || me.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
        <p className="text-sm text-status-bad">{t("documentSettings.loadError")}</p>
        <Button
          variant="secondary"
          className="min-h-11"
          onClick={() => {
            void numbering.refetch();
            void me.refetch();
          }}
        >
          {t("documentSettings.retry")}
        </Button>
      </div>
    );
  }

  const canEdit = me.data?.permissions.includes("settings:update") ?? false;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead
        title={t("documentSettings.title")}
        description={t("documentSettings.description")}
      />
      {me.data && !canEdit ? (
        <p role="note" className="text-sm text-muted">
          🔒 {t("documentSettings.readOnly")}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-status-ok">
          ✓ {saved}
        </p>
      ) : null}

      {!numbering.data || !me.data ? (
        <Skeleton />
      ) : (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {numbering.data.map((row) => (
            <Card
              key={row.docType}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span>{docTypeLabel(row.docType)}</span>
                  <span className="text-xs text-muted">{row.docType}</span>
                </span>
              }
            >
              <div className="flex min-w-0 flex-col gap-2 text-sm">
                <p className="flex flex-col">
                  <span className="text-xs text-muted">{t("documentSettings.nextNumber")}</span>
                  <span
                    className="break-all font-mono text-base font-semibold"
                    data-testid={`next-${row.docType}`}
                  >
                    {row.nextPreview}
                  </span>
                </p>
                <p className="break-all text-muted">
                  {t("documentSettings.patternSummary", {
                    pattern: row.config.pattern,
                    prefix: row.config.prefix,
                    padding: row.config.padding,
                  })}
                </p>
                <p className="text-muted">
                  {row.config.perSite
                    ? t("documentSettings.perSiteOn")
                    : t("documentSettings.perSiteOff")}{" "}
                  ·{" "}
                  {row.config.resetYearly
                    ? t("documentSettings.resetYearlyOn")
                    : t("documentSettings.resetYearlyOff")}
                </p>
                {FISCAL_TYPES.has(row.docType) ? (
                  <p className="text-xs text-muted">🔒 {t("documentSettings.fiscalNote")}</p>
                ) : null}
                {canEdit ? (
                  <Button
                    variant="secondary"
                    className="min-h-11 self-start"
                    onClick={() => {
                      setSaved(null);
                      setEditing(row);
                    }}
                  >
                    {t("documentSettings.edit")}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing ? (
        <NumberingModal
          key={editing.docType}
          row={editing}
          year={year}
          onClose={() => setEditing(null)}
          onSaved={(docType) => {
            setEditing(null);
            setSaved(t("documentSettings.saved", { type: docTypeLabel(docType) }));
            void numbering.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function NumberingModal({
  row,
  year,
  onClose,
  onSaved,
}: {
  row: NumberingRow;
  year: number;
  onClose: () => void;
  onSaved: (docType: string) => void;
}) {
  const fiscal = FISCAL_TYPES.has(row.docType);
  const currentNext = extractNextValue(row.config, row.nextPreview, year);
  const [prefix, setPrefix] = useState(row.config.prefix);
  const [pattern, setPattern] = useState(row.config.pattern);
  const [padding, setPadding] = useState(String(row.config.padding));
  const [perSite, setPerSite] = useState(row.config.perSite);
  const [resetYearly, setResetYearly] = useState(row.config.resetYearly);
  const [startAt, setStartAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const update = trpc.numbering.update.useMutation({
    onSuccess: (result) => onSaved(result.docType),
    onError: (err) => setError(err.message),
  });

  const paddingNumber = Number(padding);
  const paddingValid = Number.isInteger(paddingNumber) && paddingNumber >= 1 && paddingNumber <= 10;
  const startAtNumber = startAt.trim() ? Number(startAt) : undefined;
  const startAtValid =
    startAtNumber === undefined || (Number.isInteger(startAtNumber) && startAtNumber > 0);
  const prefixValid = prefix.trim().length >= 1 && prefix.trim().length <= 10;
  const patternValid = pattern.trim().length >= 1 && pattern.trim().length <= 60;

  const previewValue = startAtValid && startAtNumber !== undefined ? startAtNumber : currentNext;
  const preview =
    paddingValid && prefixValid && patternValid
      ? renderPattern(
          {
            prefix: prefix.trim(),
            pattern: pattern.trim(),
            padding: paddingNumber,
            perSite,
            resetYearly,
          },
          previewValue,
          year,
        )
      : "—";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prefixValid || !patternValid || !paddingValid || !startAtValid) {
      setError(t("documentSettings.fixErrors"));
      return;
    }
    setError(null);
    update.mutate({
      docType: row.docType,
      prefix: prefix.trim(),
      pattern: pattern.trim(),
      padding: paddingNumber,
      perSite,
      resetYearly,
      ...(startAtNumber !== undefined ? { startAt: startAtNumber } : {}),
    });
  }

  return (
    <Modal
      open
      title={t("documentSettings.editTitle", { type: docTypeLabel(row.docType) })}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <Field
          label={t("documentSettings.prefix")}
          error={prefixValid ? null : t("documentSettings.prefixInvalid")}
        >
          <Input
            className="min-h-11"
            value={prefix}
            maxLength={10}
            invalid={!prefixValid}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </Field>
        <Field
          label={t("documentSettings.pattern")}
          hint={t("documentSettings.patternHint")}
          error={patternValid ? null : t("documentSettings.patternInvalid")}
        >
          <Input
            className="min-h-11 font-mono"
            value={pattern}
            maxLength={60}
            invalid={!patternValid}
            onChange={(e) => setPattern(e.target.value)}
          />
        </Field>
        <Field
          label={t("documentSettings.padding")}
          error={paddingValid ? null : t("documentSettings.paddingInvalid")}
        >
          <Input
            className="min-h-11"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            step={1}
            value={padding}
            invalid={!paddingValid}
            onChange={(e) => setPadding(e.target.value)}
          />
        </Field>
        <div className="min-h-11">
          <CheckboxRow
            label={t("documentSettings.perSite")}
            checked={perSite}
            onChange={(e) => setPerSite(e.target.checked)}
          />
        </div>
        <div className="min-h-11">
          <CheckboxRow
            label={t("documentSettings.resetYearly")}
            checked={resetYearly}
            onChange={(e) => setResetYearly(e.target.checked)}
          />
        </div>
        {fiscal ? (
          <p className="text-xs text-muted">🔒 {t("documentSettings.fiscalNote")}</p>
        ) : null}
        <Field
          label={t("documentSettings.startAt")}
          hint={t("documentSettings.startAtHint", { next: currentNext })}
          error={startAtValid ? null : t("documentSettings.startAtInvalid")}
        >
          <Input
            className="min-h-11"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={startAt}
            invalid={!startAtValid}
            onChange={(e) => setStartAt(e.target.value)}
          />
        </Field>
        <p className="flex flex-col rounded-md border p-3 text-sm">
          <span className="text-xs text-muted">{t("documentSettings.livePreview")}</span>
          <span className="break-all font-mono text-base font-semibold">{preview}</span>
        </p>
        {error ? (
          <p role="alert" className="text-sm text-status-bad">
            ✕ {error}
          </p>
        ) : null}
        <Button type="submit" block className="min-h-11" loading={update.isPending}>
          {t("documentSettings.save")}
        </Button>
      </form>
    </Modal>
  );
}
