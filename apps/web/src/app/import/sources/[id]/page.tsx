"use client";

// M13 §7 — `/import/sources/[id]` (et `/import/sources/nouvelle`) : connexion directe en
// lecture seule, requêtes par entité avec aperçu, planning en langage simple, « Tester la
// connexion », « Synchroniser maintenant » et journal des 30 dernières exécutions.
import { use, useState, type ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Database, Loader2 } from "lucide-react";
import { EmptyState } from "@atelieros/ui/src/empty-state";
import { StatusBadge } from "@atelieros/ui/src/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { trpc } from "@/trpc/client";
import { formatDateTime, SCHEDULE_PRESETS } from "../shared";

const DB_TYPES = ["postgres", "mysql", "mssql"] as const;
const ENTITIES = ["customers", "vehicles", "invoices", "payments"] as const;
const POLICIES = ["UPSERT", "UPSERT_OVERWRITE", "CREATE_ONLY"] as const;
const DEFAULT_PORTS: Record<(typeof DB_TYPES)[number], number> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
};

type Entity = (typeof ENTITIES)[number];

interface FormState {
  name: string;
  dbType: (typeof DB_TYPES)[number];
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  schedule: string;
  isActive: boolean;
  policy: (typeof POLICIES)[number];
  queries: Record<Entity, string>;
}

const EMPTY_FORM: FormState = {
  name: "",
  dbType: "mssql",
  host: "",
  port: "",
  database: "",
  user: "",
  password: "",
  ssl: false,
  schedule: "0 2 * * *",
  isActive: true,
  policy: "UPSERT",
  queries: { customers: "", vehicles: "", invoices: "", payments: "" },
};

type SourceDetail = inferRouterOutputs<AppRouter>["dataSources"]["get"];

function formFromSource(source: SourceDetail): FormState {
  const c = source.connection;
  return {
    name: source.name,
    dbType: (DB_TYPES as readonly string[]).includes(c.dbType)
      ? (c.dbType as FormState["dbType"])
      : "mssql",
    host: c.host ?? "",
    port: c.port ? String(c.port) : "",
    database: c.database ?? "",
    user: c.user ?? "",
    password: "",
    ssl: c.ssl ?? false,
    schedule: source.schedule ?? "0 2 * * *",
    isActive: source.isActive,
    policy: c.policy ?? "UPSERT",
    queries: {
      customers: c.queries.customers ?? "",
      vehicles: c.queries.vehicles ?? "",
      invoices: c.queries.invoices ?? "",
      payments: c.queries.payments ?? "",
    },
  };
}

const SELECT_CLASS =
  "flex h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

export default function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "nouvelle";
  const query = trpc.dataSources.get.useQuery({ id }, { enabled: !isNew });

  if (!isNew && query.isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </main>
    );
  }
  if (!isNew && (query.isError || !query.data)) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
        <EmptyState
          icon={Database}
          title={query.error?.message ?? t("import.sources.error")}
          action={
            <Button variant="outline" onClick={() => query.refetch()}>
              {t("import.sources.retry")}
            </Button>
          }
        />
      </main>
    );
  }
  return <SourceEditor key={id} id={id} isNew={isNew} source={query.data} />;
}

function SourceEditor({
  id,
  isNew,
  source,
}: {
  id: string;
  isNew: boolean;
  source: SourceDetail | undefined;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<FormState>(() => (source ? formFromSource(source) : EMPTY_FORM));
  const [customSchedule, setCustomSchedule] = useState(
    () =>
      Boolean(source) && !(SCHEDULE_PRESETS as readonly string[]).includes(source?.schedule ?? ""),
  );
  const isAgent = source?.connection.dbType === "agent";
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [preview, setPreview] = useState<{
    entity: Entity;
    columns: string[];
    rows: string[][];
  } | null>(null);

  const onError = (error: { message: string }) => setMessage({ tone: "bad", text: error.message });
  const create = trpc.dataSources.create.useMutation({ onError });
  const update = trpc.dataSources.update.useMutation({ onError });
  const test = trpc.dataSources.test.useMutation({ onError });
  const previewQuery = trpc.dataSources.previewQuery.useMutation({ onError });
  const runNow = trpc.dataSources.runNow.useMutation({ onError });
  const remove = trpc.dataSources.delete.useMutation({ onError });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function commonPayload() {
    const queries = Object.fromEntries(
      ENTITIES.map((e) => [e, form.queries[e].trim() || undefined]),
    ) as Partial<Record<Entity, string>>;
    return {
      name: form.name,
      schedule: form.schedule,
      isActive: form.isActive,
      policy: form.policy,
      queries,
    };
  }

  function payload() {
    return {
      ...commonPayload(),
      dbType: form.dbType,
      host: form.host,
      port: form.port ? Number(form.port) : DEFAULT_PORTS[form.dbType],
      database: form.database,
      user: form.user,
      password: form.password || undefined,
      ssl: form.ssl,
    };
  }

  async function save() {
    setMessage(null);
    if (isNew) {
      const created = await create.mutateAsync(payload());
      router.replace(`/import/sources/${created.id}`);
    } else {
      // Source d'un agent local : la connexion à la base reste sur le PC du garage.
      await update.mutateAsync({ id, ...(isAgent ? commonPayload() : payload()) });
      await utils.dataSources.get.invalidate({ id });
    }
    setMessage({ tone: "ok", text: t("import.sources.form.saved") });
  }

  async function runTest() {
    setMessage(null);
    const result = isNew
      ? await test.mutateAsync({ ...payload(), password: form.password })
      : await test.mutateAsync({ id });
    if (!result.ok) {
      setMessage({ tone: "bad", text: result.error });
      return;
    }
    const text = t("import.sources.form.testOk", { tables: result.tables });
    setMessage(
      result.canWrite
        ? { tone: "bad", text: `${text}. ${t("import.sources.form.testCanWrite")}` }
        : { tone: "ok", text },
    );
  }

  async function runPreview(entity: Entity) {
    setMessage(null);
    const result = await previewQuery.mutateAsync({ id, entity, sql: form.queries[entity] });
    if (result) setPreview({ entity, ...result });
  }

  async function syncNow() {
    setMessage(null);
    const result = await runNow.mutateAsync({ id });
    await utils.dataSources.get.invalidate({ id });
    setMessage({
      tone: "ok",
      text: result.queued ? t("import.sources.form.runQueued") : t("import.sources.form.runDone"),
    });
  }

  const busy = create.isPending || update.isPending;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <Link
        href="/import/sources"
        className="flex min-h-11 items-center gap-1 text-sm text-muted hover:underline"
      >
        <ArrowLeft className="size-4" />
        {t("import.sources.back")}
      </Link>
      <h1 className="text-2xl font-semibold text-foreground">
        {isNew
          ? t("import.sources.form.titleNew")
          : t("import.sources.form.titleEdit", { name: source?.name ?? "" })}
      </h1>

      {message && (
        <div role="status" aria-live="polite">
          <StatusBadge
            tone={message.tone}
            icon={message.tone === "ok" ? CheckCircle2 : AlertTriangle}
          >
            {message.text}
          </StatusBadge>
        </div>
      )}
      {source?.lastError && (
        <p className="flex items-center gap-2 text-sm text-status-bad">
          <AlertTriangle className="size-4" />
          {t("import.sources.form.lastError")} : {source.lastError} ·{" "}
          {t("import.sources.form.failures", { count: source.consecutiveFailures })}
        </p>
      )}

      {isAgent ? (
        <p className="rounded-md border border-border bg-surface p-3 text-sm text-muted">
          {t("import.sources.form.agentSourceHint")}
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t("import.sources.form.sectionConnection")}</CardTitle>
            <CardDescription>{t("import.sources.form.readOnlyHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("import.sources.form.name")}>
              <Input
                value={form.name}
                placeholder={t("import.sources.form.namePlaceholder")}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label={t("import.sources.form.dbType")}>
              <select
                className={SELECT_CLASS}
                value={form.dbType}
                onChange={(e) => set("dbType", e.target.value as FormState["dbType"])}
              >
                {DB_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {t(`import.sources.dbTypes.${d}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("import.sources.form.host")}>
              <Input value={form.host} onChange={(e) => set("host", e.target.value)} />
            </Field>
            <Field label={t("import.sources.form.port")}>
              <Input
                inputMode="numeric"
                value={form.port}
                placeholder={String(DEFAULT_PORTS[form.dbType])}
                onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label={t("import.sources.form.database")}>
              <Input value={form.database} onChange={(e) => set("database", e.target.value)} />
            </Field>
            <Field label={t("import.sources.form.user")}>
              <Input
                autoComplete="off"
                value={form.user}
                onChange={(e) => set("user", e.target.value)}
              />
            </Field>
            <Field label={t("import.sources.form.password")}>
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                placeholder={
                  source?.connection.hasPassword ? t("import.sources.form.passwordSaved") : ""
                }
                onChange={(e) => set("password", e.target.value)}
              />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="size-5"
                checked={form.ssl}
                onChange={(e) => set("ssl", e.target.checked)}
              />
              {t("import.sources.form.ssl")}
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button variant="outline" onClick={runTest} disabled={test.isPending}>
                {test.isPending && <Loader2 className="size-4 animate-spin" />}
                {t("import.sources.form.test")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("import.sources.form.sectionQueries")}</CardTitle>
          <CardDescription>{t("import.sources.form.queriesHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {ENTITIES.map((entity) => (
            <div key={entity} className="flex flex-col gap-2">
              <Field label={t(`import.list.entity.${entity}`)}>
                <textarea
                  className="min-h-24 w-full rounded-md border border-border bg-surface p-3 font-mono text-xs text-foreground"
                  spellCheck={false}
                  value={form.queries[entity]}
                  placeholder={t("import.sources.form.queryPlaceholder")}
                  onChange={(e) => set("queries", { ...form.queries, [entity]: e.target.value })}
                />
              </Field>
              {!isNew && form.queries[entity].trim() && (
                <Button
                  variant="ghost"
                  className="self-start"
                  onClick={() => runPreview(entity)}
                  disabled={previewQuery.isPending}
                >
                  {t("import.sources.form.preview")}
                </Button>
              )}
              {preview?.entity === entity && (
                <div className="overflow-x-auto rounded-md border border-border">
                  {preview.rows.length === 0 ? (
                    <p className="p-3 text-sm text-muted">
                      {t("import.sources.form.previewEmpty")}
                    </p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          {preview.columns.map((c) => (
                            <th key={c} className="border-b border-border p-2 text-left">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row, i) => (
                          <tr key={i}>
                            {row.map((cell, j) => (
                              <td key={j} className="border-b border-border p-2">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
          <Field label={t("import.sources.form.policy")}>
            <select
              className={SELECT_CLASS}
              value={form.policy}
              onChange={(e) => set("policy", e.target.value as FormState["policy"])}
            >
              {POLICIES.map((p) => (
                <option key={p} value={p}>
                  {t(`import.sources.form.policies.${p}`)}
                </option>
              ))}
            </select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("import.sources.form.sectionSchedule")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("import.sources.form.schedule")}>
            <select
              className={SELECT_CLASS}
              value={customSchedule ? "custom" : form.schedule}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setCustomSchedule(true);
                } else {
                  setCustomSchedule(false);
                  set("schedule", e.target.value);
                }
              }}
            >
              {SCHEDULE_PRESETS.map((s) => (
                <option key={s} value={s}>
                  {t(`import.sources.schedules.${s}`)}
                </option>
              ))}
              <option value="custom">{t("import.sources.schedules.custom")}</option>
            </select>
          </Field>
          {customSchedule && (
            <Field label={t("import.sources.form.cron")}>
              <Input value={form.schedule} onChange={(e) => set("schedule", e.target.value)} />
            </Field>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-5"
              checked={form.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
            />
            {t("import.sources.form.active")}
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("import.sources.form.save")}
        </Button>
        {!isNew && (
          <>
            {!isAgent && (
              <Button variant="outline" onClick={syncNow} disabled={runNow.isPending}>
                {runNow.isPending && <Loader2 className="size-4 animate-spin" />}
                {t("import.sources.form.runNow")}
              </Button>
            )}
            {source?.isActive && (
              <Button
                variant="ghost"
                onClick={async () => {
                  await remove.mutateAsync({ id });
                  await utils.dataSources.get.invalidate({ id });
                  setMessage({ tone: "ok", text: t("import.sources.form.deactivated") });
                }}
              >
                {t("import.sources.form.deactivate")}
              </Button>
            )}
          </>
        )}
      </div>

      {!isNew && source && (
        <Card>
          <CardHeader>
            <CardTitle>{t("import.sources.runs.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {source.runs.length === 0 ? (
              <p className="text-sm text-muted">{t("import.sources.runs.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {source.runs.map((run) => (
                  <li
                    key={run.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm"
                  >
                    <span className="text-muted">{formatDateTime(run.createdAt)}</span>
                    <span className="font-medium">{t(`import.list.entity.${run.entity}`)}</span>
                    <span>
                      {t("import.sources.runs.created")} {run.createdCount} ·{" "}
                      {t("import.sources.runs.updated")} {run.updatedCount} ·{" "}
                      {t("import.sources.runs.unchanged")} {run.unchangedCount} ·{" "}
                      {t("import.sources.runs.errors")} {run.errorCount}
                    </span>
                    <StatusBadge
                      tone={
                        run.status === "COMPLETED" ? "ok" : run.status === "FAILED" ? "bad" : "info"
                      }
                      icon={run.status === "COMPLETED" ? CheckCircle2 : AlertTriangle}
                    >
                      {t(`import.list.status.${run.status}`)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
