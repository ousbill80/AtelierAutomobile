"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import { TARGET_FIELDS_BY_ENTITY, type TargetField } from "@atelieros/core/import";
import { StatusBadge } from "@atelieros/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { t } from "@/lib/i18n";
import { trpc } from "@/trpc/client";
import { cn } from "@/lib/utils";

/** RG-M13-16/17 — entités prises en charge par le pipeline d'import fichier dans cette étape. */
const SUPPORTED_ENTITIES = ["customers", "vehicles", "invoices", "payments"] as const;
type SupportedEntity = (typeof SUPPORTED_ENTITIES)[number];

type Encoding = "UTF-8" | "UTF-8-BOM" | "UTF-16LE" | "UTF-16BE" | "WINDOWS-1252" | "ISO-8859-1";
type Delimiter = ";" | "," | "\t" | "|";
type Policy = "CREATE_ONLY" | "UPSERT" | "UPSERT_OVERWRITE";

const ENCODING_OPTIONS: Encoding[] = [
  "UTF-8",
  "UTF-8-BOM",
  "UTF-16LE",
  "UTF-16BE",
  "WINDOWS-1252",
  "ISO-8859-1",
];
const DELIMITER_LABELS: Record<Delimiter, string> = {
  ";": "point-virgule ( ; )",
  ",": "virgule ( , )",
  "\t": "tabulation",
  "|": "barre verticale ( | )",
};

const STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
type Step = (typeof STEPS)[number];

interface Sample {
  column: string;
  samples: string[];
}

interface Suggestion {
  column: string;
  field: TargetField | null;
  confidence: number;
  source: "synonym" | "ai" | "memory" | null;
  /** M17 / RG-M13-07 — proposition de l'assistant, toujours à confirmer. */
  aiProposal?: { field: TargetField; confidence: number };
}

interface AnalyzeData {
  headers: string[];
  samples: Sample[];
  detected: { encoding: Encoding | null; delimiter: Delimiter | null };
  suggestedEntity: string;
  mapping: Suggestion[];
}

interface RowIssue {
  field?: string;
  message: string;
  severity: "ERROR" | "WARNING";
}

interface AnalyzedRow {
  rowNumber: number;
  values: Record<string, unknown>;
  issues: RowIssue[];
}

function targetFieldSuffix(field: TargetField): string {
  return field.split(".")[1] ?? field;
}

function confidenceTone(suggestion: Suggestion): "ok" | "warn" | "off" {
  if (!suggestion.field) return "off";
  if (
    (suggestion.source === "synonym" || suggestion.source === "memory") &&
    suggestion.confidence >= 0.8
  ) {
    return "ok";
  }
  return "warn";
}

function StepperHeader({ step }: { step: Step }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((s) => (
        <li
          key={s}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1",
            s === step
              ? "border-accent bg-accent/10 font-medium text-accent"
              : s < step
                ? "border-status-ok/40 bg-status-ok-bg text-status-ok"
                : "border-border text-muted",
          )}
        >
          {s < step ? <CheckCircle2 className="size-3.5" /> : <span className="tabular">{s}</span>}
          {t(`import.wizard.steps.${s}`)}
        </li>
      ))}
    </ol>
  );
}

export default function ImportFichierPage() {
  const [step, setStep] = useState<Step>(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [analyzeData, setAnalyzeData] = useState<AnalyzeData | null>(null);
  const [encodingOverride, setEncodingOverride] = useState<Encoding | "">("");
  const [delimiterOverride, setDelimiterOverride] = useState<Delimiter | "">("");

  const [entity, setEntity] = useState<SupportedEntity>("customers");
  const [policy, setPolicy] = useState<Policy>("UPSERT");
  const [columnMapping, setColumnMapping] = useState<Record<string, TargetField | null>>({});

  const [validateData, setValidateData] = useState<{
    rows: AnalyzedRow[];
    counts: { total: number; errors: number; warnings: number };
  } | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const [simulateData, setSimulateData] = useState<{
    create: number;
    update: number;
    unchanged: number;
    skip: number;
    error: number;
  } | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);

  const [errorReportUrl, setErrorReportUrl] = useState<string | null>(null);

  const uploadMutation = trpc.import.upload.useMutation();
  const analyzeMutation = trpc.import.analyze.useMutation();
  const setMappingMutation = trpc.import.setMapping.useMutation();
  const validateMutation = trpc.import.validate.useMutation();
  const patchRowMutation = trpc.import.patchRow.useMutation();
  const simulateMutation = trpc.import.simulate.useMutation();
  const runMutation = trpc.import.run.useMutation();
  const errorReportMutation = trpc.import.errorReport.useMutation();

  const progressQuery = trpc.import.progress.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: step === 6 && !!jobId,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "COMPLETED" || status === "FAILED" ? false : 2000;
      },
    },
  );
  const progress = progressQuery.data;
  const progressTerminal = progress?.status === "COMPLETED" || progress?.status === "FAILED";

  const analyzeStartedRef = useRef(false);
  const validateStartedRef = useRef(false);
  const simulateStartedRef = useRef(false);
  const runStartedRef = useRef(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      const { jobId: newJobId, uploadUrl } = await uploadMutation.mutateAsync({
        fileName: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
      });
      const putResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putResponse.ok) {
        throw new Error("L'envoi du fichier a échoué.");
      }
      setJobId(newJobId);
      setFileName(file.name);
      setStep(2);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t("common.genericError"));
    }
  }

  const applyAnalyzeResult = useCallback((data: AnalyzeData) => {
    setAnalyzeData(data);
    setEncodingOverride(data.detected.encoding ?? "");
    setDelimiterOverride(data.detected.delimiter ?? "");
    const suggestedEntity = SUPPORTED_ENTITIES.includes(data.suggestedEntity as SupportedEntity)
      ? (data.suggestedEntity as SupportedEntity)
      : "customers";
    setEntity(suggestedEntity);
    const nextMapping: Record<string, TargetField | null> = {};
    for (const suggestion of data.mapping) {
      nextMapping[suggestion.column] = suggestion.field;
    }
    setColumnMapping(nextMapping);
  }, []);

  useEffect(() => {
    if (step !== 2 || !jobId || analyzeStartedRef.current) return;
    analyzeStartedRef.current = true;
    analyzeMutation
      .mutateAsync({ jobId })
      .then((data) => applyAnalyzeResult(data as AnalyzeData))
      .catch(() => {
        analyzeStartedRef.current = false;
      });
  }, [step, jobId, analyzeMutation, applyAnalyzeResult]);

  async function handleReread() {
    if (!jobId) return;
    const data = await analyzeMutation.mutateAsync({
      jobId,
      ...(encodingOverride ? { encoding: encodingOverride } : {}),
      ...(delimiterOverride ? { delimiter: delimiterOverride } : {}),
    });
    applyAnalyzeResult(data as AnalyzeData);
  }

  async function handleMappingContinue() {
    if (!jobId || !analyzeData) return;
    const columns: Record<string, TargetField> = {};
    for (const [header, field] of Object.entries(columnMapping)) {
      if (field) columns[header] = field;
    }
    await setMappingMutation.mutateAsync({
      jobId,
      entity,
      columns,
      options: { policy, treatMissingAsPaid: false },
    });
    validateStartedRef.current = false;
    setStep(4);
  }

  useEffect(() => {
    if (step !== 4 || !jobId || validateStartedRef.current) return;
    validateStartedRef.current = true;
    validateMutation
      .mutateAsync({ jobId })
      .then((data) => setValidateData(data as typeof validateData & object))
      .catch(() => {
        validateStartedRef.current = false;
      });
  }, [step, jobId, validateMutation]);

  async function handleCellCommit(rowNumber: number, field: TargetField, rawValue: string) {
    if (!jobId) return;
    await patchRowMutation.mutateAsync({ jobId, rowNumber, field, value: rawValue });
    const data = await validateMutation.mutateAsync({ jobId });
    setValidateData(data as typeof validateData & object);
  }

  async function handleSimulateContinue() {
    setStep(5);
  }

  useEffect(() => {
    if (step !== 5 || !jobId || simulateStartedRef.current) return;
    simulateStartedRef.current = true;
    simulateMutation
      .mutateAsync({ jobId })
      .then((data) => setSimulateData(data))
      .catch(() => {
        simulateStartedRef.current = false;
      });
  }, [step, jobId, simulateMutation]);

  async function handleRunContinue() {
    setStep(6);
  }

  useEffect(() => {
    if (step !== 6 || !jobId || runStartedRef.current) return;
    runStartedRef.current = true;
    runMutation.mutateAsync({ jobId, skipErrors }).catch(() => {
      runStartedRef.current = false;
    });
  }, [step, jobId, runMutation, skipErrors]);

  const targetFields = TARGET_FIELDS_BY_ENTITY[entity] ?? [];
  // Avance automatiquement à l'étape 7 (résumé) une fois l'import terminé,
  // sans dupliquer l'état : `step` reste la source de vérité pour les effets
  // de déclenchement (upload/analyze/validate/simulate/run), `effectiveStep`
  // ne sert qu'à l'affichage.
  const effectiveStep: Step = step === 6 && progressTerminal ? 7 : step;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">{t("import.wizard.title")}</h1>
        <Link href="/import" className="text-sm text-muted hover:text-foreground">
          {t("common.back")}
        </Link>
      </div>

      <StepperHeader step={effectiveStep} />

      {effectiveStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("import.wizard.step1.title")}</CardTitle>
            <CardDescription>{t("import.wizard.step1.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <label
              htmlFor="import-file-input"
              className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border px-6 py-14 text-center hover:border-accent"
            >
              <UploadCloud className="size-10 text-muted" />
              <p className="text-sm text-muted">
                {t("import.wizard.step1.dropHint")}{" "}
                <span className="font-medium text-accent">
                  {t("import.wizard.step1.browseButton")}
                </span>
              </p>
              {uploadMutation.isPending && (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="size-4 animate-spin" />
                  {t("import.wizard.step1.uploading")}
                </p>
              )}
            </label>
            <input
              id="import-file-input"
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              className="sr-only"
              onChange={handleFileChange}
            />
            {uploadError && (
              <Alert variant="destructive" className="mt-4">
                <AlertTriangle />
                <AlertDescription>{uploadError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {effectiveStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("import.wizard.step2.title")}</CardTitle>
            <CardDescription>{t("import.wizard.step2.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!analyzeData && (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" />
                {t("import.wizard.step2.analyzing")}
              </p>
            )}
            {analyzeData && (
              <>
                <p className="text-sm text-muted">{fileName}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium" htmlFor="encoding-select">
                      {t("import.wizard.step2.encodingLabel")}
                    </label>
                    {analyzeData.detected.encoding === null ? (
                      <p className="text-sm text-muted">{t("import.wizard.step2.notApplicable")}</p>
                    ) : (
                      <select
                        id="encoding-select"
                        className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
                        value={encodingOverride}
                        onChange={(e) => setEncodingOverride(e.target.value as Encoding)}
                      >
                        {ENCODING_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium" htmlFor="delimiter-select">
                      {t("import.wizard.step2.delimiterLabel")}
                    </label>
                    {analyzeData.detected.delimiter === null ? (
                      <p className="text-sm text-muted">{t("import.wizard.step2.notApplicable")}</p>
                    ) : (
                      <select
                        id="delimiter-select"
                        className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
                        value={delimiterOverride}
                        onChange={(e) => setDelimiterOverride(e.target.value as Delimiter)}
                      >
                        {(Object.keys(DELIMITER_LABELS) as Delimiter[]).map((opt) => (
                          <option key={opt} value={opt}>
                            {DELIMITER_LABELS[opt]}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleReread}
                    disabled={analyzeMutation.isPending}
                  >
                    <RefreshCw className="size-4" />
                    {t("import.wizard.step2.rereadButton")}
                  </Button>
                  <Button onClick={() => setStep(3)}>{t("common.continue")}</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {effectiveStep === 3 && analyzeData && (
        <Card>
          <CardHeader>
            <CardTitle>{t("import.wizard.step3.title")}</CardTitle>
            <CardDescription>{t("import.wizard.step3.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="entity-select">
                  {t("import.wizard.step3.entityLabel")}
                </label>
                <select
                  id="entity-select"
                  className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
                  value={entity}
                  onChange={(e) => setEntity(e.target.value as SupportedEntity)}
                >
                  {SUPPORTED_ENTITIES.map((opt) => (
                    <option key={opt} value={opt}>
                      {t(`import.list.entity.${opt}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="policy-select">
                  {t("import.wizard.step3.policyLabel")}
                </label>
                <select
                  id="policy-select"
                  className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value as Policy)}
                >
                  {(["CREATE_ONLY", "UPSERT", "UPSERT_OVERWRITE"] as Policy[]).map((opt) => (
                    <option key={opt} value={opt}>
                      {t(`import.wizard.step3.policy.${opt}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {analyzeData.mapping.map((suggestion) => {
                const tone = confidenceTone(suggestion);
                const sample = analyzeData.samples.find((s) => s.column === suggestion.column);
                return (
                  <div
                    key={suggestion.column}
                    className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{suggestion.column}</span>
                      <span className="text-xs text-muted">
                        {sample?.samples.filter(Boolean).slice(0, 3).join(" · ") || "—"}
                      </span>
                      {suggestion.aiProposal && (
                        <span className="flex flex-wrap items-center gap-2 text-xs">
                          <StatusBadge tone="warn" label={t("aiExtraction.import.proposed")} />
                          <span className="text-muted">
                            {t("aiExtraction.import.proposedHint", {
                              pct: Math.round(suggestion.aiProposal.confidence * 100),
                            })}
                          </span>
                          {columnMapping[suggestion.column] !== suggestion.aiProposal.field && (
                            <button
                              type="button"
                              className="min-h-11 underline"
                              onClick={() =>
                                setColumnMapping((prev) => ({
                                  ...prev,
                                  [suggestion.column]: suggestion.aiProposal!.field,
                                }))
                              }
                            >
                              {t("aiExtraction.import.useProposal", {
                                field: t(
                                  `import.wizard.step3.fields.${suggestion.aiProposal.field}`,
                                ),
                              })}
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          tone === "ok" && "bg-status-ok",
                          tone === "warn" && "bg-status-warn",
                          tone === "off" && "bg-status-off",
                        )}
                        title={
                          tone === "ok"
                            ? t("import.wizard.step3.confidenceHigh")
                            : tone === "warn"
                              ? t("import.wizard.step3.confidenceLow")
                              : t("import.wizard.step3.confidenceNone")
                        }
                      />
                      <select
                        className="h-10 min-w-56 rounded-md border border-border bg-surface px-2 text-sm"
                        value={columnMapping[suggestion.column] ?? ""}
                        onChange={(e) =>
                          setColumnMapping((prev) => ({
                            ...prev,
                            [suggestion.column]: (e.target.value || null) as TargetField | null,
                          }))
                        }
                      >
                        <option value="">{t("import.wizard.step3.ignoreColumn")}</option>
                        {targetFields.map((field) => (
                          <option key={field} value={field}>
                            {t(`import.wizard.step3.fields.${field}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <Button onClick={handleMappingContinue} disabled={setMappingMutation.isPending}>
                {t("common.continue")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {effectiveStep === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("import.wizard.step4.title")}</CardTitle>
            <CardDescription>{t("import.wizard.step4.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!validateData ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" />
                {t("common.loading")}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-3 text-sm text-muted">
                    <span>
                      {t("import.wizard.step4.totalRows", { count: validateData.counts.total })}
                    </span>
                    <span className="text-status-bad">
                      {t("import.wizard.step4.errorCount", { count: validateData.counts.errors })}
                    </span>
                    <span className="text-status-warn">
                      {t("import.wizard.step4.warningCount", {
                        count: validateData.counts.warnings,
                      })}
                    </span>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={errorsOnly}
                      onChange={(e) => setErrorsOnly(e.target.checked)}
                    />
                    {t("import.wizard.step4.errorsOnlyToggle")}
                  </label>
                </div>

                <div className="flex flex-col gap-2">
                  {validateData.rows
                    .filter((row) => !errorsOnly || row.issues.length > 0)
                    .map((row) => {
                      const worstSeverity = row.issues.some((i) => i.severity === "ERROR")
                        ? "ERROR"
                        : row.issues.some((i) => i.severity === "WARNING")
                          ? "WARNING"
                          : null;
                      return (
                        <div
                          key={row.rowNumber}
                          data-severity={worstSeverity ?? undefined}
                          className={cn(
                            "rounded-md border p-3",
                            worstSeverity === "ERROR" && "border-status-bad/40 bg-status-bad-bg",
                            worstSeverity === "WARNING" &&
                              "border-status-warn/40 bg-status-warn-bg",
                            !worstSeverity && "border-border",
                          )}
                        >
                          <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted">
                            <span className="font-medium text-foreground">
                              {t("import.wizard.step4.rowNumber")} {row.rowNumber}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-4">
                            {Object.entries(row.values).map(([field, value]) => {
                              const suffix = targetFieldSuffix(field as TargetField);
                              const cellSeverity = row.issues.find(
                                (i) => i.field === suffix,
                              )?.severity;
                              const editKey = `${row.rowNumber}:${field}`;
                              return (
                                <label
                                  key={field}
                                  className="flex flex-col gap-0.5 text-xs"
                                  data-severity={cellSeverity ?? undefined}
                                >
                                  <span className="text-muted">
                                    {t(`import.wizard.step3.fields.${field}`)}
                                  </span>
                                  <Input
                                    className={cn(
                                      "h-8 w-44 text-sm",
                                      cellSeverity === "ERROR" &&
                                        "border-status-bad text-status-bad",
                                      cellSeverity === "WARNING" &&
                                        "border-status-warn text-status-warn",
                                    )}
                                    value={editValues[editKey] ?? String(value ?? "")}
                                    onChange={(e) =>
                                      setEditValues((prev) => ({
                                        ...prev,
                                        [editKey]: e.target.value,
                                      }))
                                    }
                                    onBlur={(e) =>
                                      handleCellCommit(
                                        row.rowNumber,
                                        field as TargetField,
                                        e.target.value,
                                      )
                                    }
                                  />
                                </label>
                              );
                            })}
                          </div>
                          {row.issues.length > 0 && (
                            <ul className="mt-2 flex flex-col gap-0.5 text-xs">
                              {row.issues.map((issue, index) => (
                                <li
                                  key={index}
                                  className={
                                    issue.severity === "ERROR"
                                      ? "text-status-bad"
                                      : "text-status-warn"
                                  }
                                >
                                  {issue.message}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  {validateData.rows.length === 0 && (
                    <p className="text-sm text-muted">{t("import.wizard.step4.noRows")}</p>
                  )}
                </div>

                <div>
                  <Button onClick={handleSimulateContinue}>{t("common.continue")}</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {effectiveStep === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("import.wizard.step5.title")}</CardTitle>
            <CardDescription>{t("import.wizard.step5.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!simulateData ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" />
                {t("common.loading")}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {(
                    [
                      ["create", simulateData.create, "ok"],
                      ["update", simulateData.update, "info"],
                      ["unchanged", simulateData.unchanged, "off"],
                      ["skip", simulateData.skip, "warn"],
                      ["error", simulateData.error, "bad"],
                    ] as const
                  ).map(([key, value, tone]) => (
                    <div
                      key={key}
                      className={cn(
                        "flex flex-col gap-1 rounded-md border p-3",
                        tone === "ok" && "border-status-ok/30 bg-status-ok-bg text-status-ok",
                        tone === "warn" &&
                          "border-status-warn/30 bg-status-warn-bg text-status-warn",
                        tone === "bad" && "border-status-bad/30 bg-status-bad-bg text-status-bad",
                        tone === "off" && "border-status-off/30 bg-status-off-bg text-status-off",
                        tone === "info" && "border-accent/30 bg-accent/10 text-accent",
                      )}
                    >
                      <span className="text-2xl font-semibold tabular">{value}</span>
                      <span className="text-xs">{t(`import.wizard.step5.${key}`)}</span>
                    </div>
                  ))}
                </div>

                {simulateData.error > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={skipErrors}
                      onChange={(e) => setSkipErrors(e.target.checked)}
                    />
                    {t("import.wizard.step5.skipErrorsLabel")}
                  </label>
                )}

                <div>
                  <Button
                    onClick={handleRunContinue}
                    disabled={simulateData.error > 0 && !skipErrors}
                  >
                    {t("common.continue")}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {effectiveStep === 6 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("import.wizard.step6.title")}</CardTitle>
            <CardDescription>{t("import.wizard.step6.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress
              value={
                progress && progress.totalRows > 0
                  ? Math.round((progress.processedRows / progress.totalRows) * 100)
                  : 0
              }
            />
            <p className="text-sm text-muted">
              {t("import.wizard.step6.processedOf", {
                processed: progress?.processedRows ?? 0,
                total: progress?.totalRows ?? 0,
              })}
            </p>
          </CardContent>
        </Card>
      )}

      {effectiveStep === 7 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("import.wizard.step7.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(
                [
                  ["created", progress?.counts.create ?? 0],
                  ["updated", progress?.counts.update ?? 0],
                  ["unchanged", progress?.counts.unchanged ?? 0],
                  ["skipped", progress?.counts.skip ?? 0],
                  ["errors", progress?.counts.error ?? 0],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex flex-col gap-1 rounded-md border border-border p-3">
                  <span className="text-2xl font-semibold tabular">{value}</span>
                  <span className="text-xs text-muted">{t(`import.wizard.step7.${key}`)}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!jobId || errorReportMutation.isPending}
                onClick={async () => {
                  if (!jobId) return;
                  const { url } = await errorReportMutation.mutateAsync({ jobId });
                  setErrorReportUrl(url);
                  window.open(url, "_blank");
                }}
              >
                <Download className="size-4" />
                {t("import.wizard.step7.downloadErrorReport")}
              </Button>
              <Button asChild>
                <Link href="/import">{t("import.wizard.step7.backToList")}</Link>
              </Button>
            </div>
            {errorReportUrl && <p className="sr-only">{errorReportUrl}</p>}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
