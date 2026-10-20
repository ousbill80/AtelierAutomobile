"use client";

// M17 §7 — /parametres/automatisations : modèles fournis activables en un clic (RG-M17-25),
// liste des règles (nom, déclencheur, mode, actif, dernière exécution), éditeur
// « Quand… / Si… / Alors… », test à blanc, propositions à valider (mode PROPOSE) et historique.
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
} from "@atelieros/core/automations";
import {
  Button,
  EmptyState,
  PageHead,
  Select,
  StatusBadge,
  Switch,
  type StatusTone,
} from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";
import { EMPTY_RULE, RuleEditor, type RuleDraft } from "./rule-editor";

type Outputs = inferRouterOutputs<AppRouter>["automations"];
type RuleRow = Outputs["list"][number];
type RunRow = Outputs["runs"]["items"][number];

const RUN_TONES: Record<string, StatusTone> = {
  PENDING: "warn",
  SUCCEEDED: "ok",
  FAILED: "bad",
  SKIPPED: "off",
};
const RUN_ICONS: Record<string, string> = {
  PENDING: "⏳",
  SUCCEEDED: "✓",
  FAILED: "✕",
  SKIPPED: "–",
  AWAITING: "✋",
};

function RunStatus({ status, awaiting }: { status: string; awaiting?: boolean }) {
  const key = awaiting ? "AWAITING" : status;
  return (
    <StatusBadge tone={awaiting ? "warn" : (RUN_TONES[status] ?? "off")}>
      <span aria-hidden="true">{RUN_ICONS[key]}</span> {t(`automations.status.${key}`)}
    </StatusBadge>
  );
}

export default function AutomationsPage() {
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const refresh = () => {
    void utils.automations.list.invalidate();
    void utils.automations.templates.invalidate();
    void utils.automations.runs.invalidate();
    void utils.automations.pendingApprovals.invalidate();
  };

  function showWarnings(warnings: string[], fallback?: string) {
    setNotice(
      warnings.length
        ? t("automations.editor.warning", { names: warnings.join(", ") })
        : (fallback ?? null),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title={t("automations.title")}
        description={t("automations.description")}
        actions={
          <Button onClick={() => setEditing({ ...EMPTY_RULE })} disabled={!!editing}>
            {t("automations.rules.new")}
          </Button>
        }
      />
      {notice && (
        <p role="status" className="rounded-md bg-surface-2 p-3 text-sm">
          {notice}
        </p>
      )}
      {editing && (
        <RuleEditor
          key={editing.id ?? "new"}
          initial={editing}
          onDone={(warnings) => {
            setEditing(null);
            showWarnings(warnings, t("automations.editor.saved"));
            refresh();
          }}
        />
      )}
      <TemplatesSection
        onActivated={(name, warnings) => {
          showWarnings(warnings, t("automations.templates.activated", { name }));
          refresh();
        }}
      />
      <RulesSection onEdit={setEditing} onChanged={showWarnings} />
      <ApprovalsSection onDecided={refresh} />
      <RunsSection />
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-lg font-semibold">{children}</h3>;
}

function TemplatesSection({
  onActivated,
}: {
  onActivated: (name: string, warnings: string[]) => void;
}) {
  const query = trpc.automations.templates.useQuery();
  const activate = trpc.automations.activateTemplate.useMutation();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="automation-templates">
      <span id="automation-templates">
        <SectionTitle>{t("automations.sections.templates")}</SectionTitle>
      </span>
      {query.isError && (
        <ErrorBox message={t("automations.loadError")} onRetry={() => query.refetch()} />
      )}
      {query.isLoading && <ListSkeleton rows={2} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {query.data?.map((tpl) => (
          <div
            key={tpl.key}
            data-testid={`automation-template-${tpl.key}`}
            className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div>
              <p className="font-medium">{tpl.name}</p>
              <p className="text-sm text-muted">
                {t(`automations.triggers.${tpl.trigger}`)} · {t(`automations.mode.${tpl.mode}`)}
                {tpl.delayMinutes > 0 &&
                  ` · ${t("automations.rules.delay", { minutes: tpl.delayMinutes })}`}
              </p>
            </div>
            <div>
              {tpl.isActive ? (
                <StatusBadge tone="ok">
                  <span aria-hidden="true">✓</span> {t("automations.templates.active")}
                </StatusBadge>
              ) : !tpl.available ? (
                <StatusBadge tone="off">
                  <span aria-hidden="true">⏳</span> {t("automations.templates.unavailable")}
                </StatusBadge>
              ) : (
                <Button
                  variant="secondary"
                  loading={activate.isPending && activate.variables?.key === tpl.key}
                  onClick={async () => {
                    const result = await activate.mutateAsync({ key: tpl.key });
                    onActivated(tpl.name, result.warnings);
                  }}
                >
                  {t("automations.templates.activate")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RulesSection({
  onEdit,
  onChanged,
}: {
  onEdit: (draft: RuleDraft) => void;
  onChanged: (warnings: string[]) => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.automations.list.useQuery();
  const [testing, setTesting] = useState<string | null>(null);
  const toggle = trpc.automations.toggle.useMutation({
    onSuccess: (result) => {
      onChanged(result.warnings);
      void utils.automations.list.invalidate();
      void utils.automations.templates.invalidate();
    },
  });
  const remove = trpc.automations.delete.useMutation({
    onSuccess: () => {
      void utils.automations.list.invalidate();
      void utils.automations.templates.invalidate();
      void utils.automations.runs.invalidate();
    },
  });

  async function edit(rule: RuleRow) {
    const full = await utils.automations.get.fetch({ id: rule.id });
    onEdit({
      id: full.id,
      name: full.name,
      trigger: full.trigger as AutomationTrigger,
      conditions: full.conditions as AutomationCondition[],
      actions: full.actions as AutomationAction[],
      mode: full.mode,
      delayMinutes: full.delayMinutes,
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{t("automations.sections.rules")}</SectionTitle>
      {query.isError && (
        <ErrorBox message={t("automations.loadError")} onRetry={() => query.refetch()} />
      )}
      {query.isLoading && <ListSkeleton />}
      {query.data && query.data.length === 0 && (
        <EmptyState
          title={t("automations.rules.empty")}
          description={t("automations.rules.emptyHint")}
        />
      )}
      {query.data?.map((rule) => (
        <div
          key={rule.id}
          data-testid={`automation-rule-${rule.id}`}
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{rule.name}</p>
              <p className="text-sm text-muted">
                {t(`automations.triggers.${rule.trigger}`)} · {t(`automations.mode.${rule.mode}`)}
                {rule.delayMinutes > 0 &&
                  ` · ${t("automations.rules.delay", { minutes: rule.delayMinutes })}`}
              </p>
              <p className="text-sm text-muted">
                {rule.actionTypes.map((type) => t(`automations.actions.${type}`)).join(" · ")}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                {rule.lastRun ? (
                  <>
                    <RunStatus status={rule.lastRun.status} />
                    {t("automations.rules.lastRun", {
                      date: formatDateTime(rule.lastRun.executedAt),
                    })}
                  </>
                ) : (
                  <span className="text-muted">{t("automations.rules.neverRun")}</span>
                )}
              </p>
              {!rule.available && (
                <p className="text-sm text-status-warn">
                  {t("automations.rules.unavailableTrigger")}
                </p>
              )}
            </div>
            <div className="flex min-h-11 items-center gap-2">
              <span className="text-sm">{t("automations.rules.activeLabel")}</span>
              <Switch
                label={t("automations.rules.activeLabel")}
                checked={rule.isActive}
                disabled={toggle.isPending || (!rule.available && !rule.isActive)}
                onChange={(e) => toggle.mutate({ id: rule.id, isActive: e.target.checked })}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => edit(rule)}>
              {t("automations.rules.edit")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setTesting((v) => (v === rule.id ? null : rule.id))}
            >
              {t("automations.rules.test")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm(t("automations.rules.confirmDelete", { name: rule.name }))) {
                  remove.mutate({ id: rule.id });
                }
              }}
            >
              {t("automations.rules.delete")}
            </Button>
          </div>
          {testing === rule.id && <TestPanel ruleId={rule.id} onClose={() => setTesting(null)} />}
        </div>
      ))}
    </section>
  );
}

const SAMPLE_TYPES = [
  "repair_order",
  "invoice",
  "quote",
  "customer",
  "payment",
  "appointment",
] as const;

function TestPanel({ ruleId, onClose }: { ruleId: string; onClose: () => void }) {
  const [type, setType] = useState<(typeof SAMPLE_TYPES)[number]>("repair_order");
  const [entityId, setEntityId] = useState("");
  const [submitted, setSubmitted] = useState<{
    type: (typeof SAMPLE_TYPES)[number];
    id: string;
  } | null>(null);
  const samples = trpc.automations.sampleEntities.useQuery({ type });
  const result = trpc.automations.test.useQuery(
    { ruleId, sampleEntity: submitted ?? { type, id: "-" } },
    { enabled: !!submitted, retry: false },
  );
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-3" data-testid="automation-test">
      <p className="font-medium">{t("automations.test.title")}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <Select
          aria-label={t("automations.test.type")}
          value={type}
          onChange={(e) => {
            setType(e.target.value as (typeof SAMPLE_TYPES)[number]);
            setEntityId("");
          }}
        >
          {SAMPLE_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`automations.test.types.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("automations.test.pick")}
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
        >
          <option value="">
            {samples.data && samples.data.length === 0 ? t("automations.test.none") : "—"}
          </option>
          {samples.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
        <Button disabled={!entityId} onClick={() => setSubmitted({ type, id: entityId })}>
          {t("automations.test.run")}
        </Button>
      </div>
      {result.isFetching && <ListSkeleton rows={1} />}
      {result.isError && <ErrorBox message={result.error.message} />}
      {result.data && (
        <div className="flex flex-col gap-2 text-sm">
          <StatusBadge tone={result.data.matched ? "ok" : "off"}>
            <span aria-hidden="true">{result.data.matched ? "✓" : "–"}</span>{" "}
            {result.data.matched ? t("automations.test.matched") : t("automations.test.notMatched")}
          </StatusBadge>
          {result.data.siteExcluded && <p>{t("automations.test.siteExcluded")}</p>}
          <ul className="flex flex-col gap-1">
            {result.data.actions.map((action, i) => (
              <li key={i} className="break-words rounded bg-surface p-2">
                <span className="font-medium">{t(`automations.actions.${action.type}`)}</span> —{" "}
                {action.preview}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <Button variant="ghost" onClick={onClose}>
          {t("automations.test.close")}
        </Button>
      </div>
    </div>
  );
}

function ApprovalsSection({ onDecided }: { onDecided: () => void }) {
  const query = trpc.automations.pendingApprovals.useQuery();
  const accept = trpc.ai.suggestion.accept.useMutation({ onSuccess: onDecided });
  const dismiss = trpc.ai.suggestion.dismiss.useMutation({ onSuccess: onDecided });
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{t("automations.sections.approvals")}</SectionTitle>
      {query.isError && (
        <ErrorBox message={t("automations.loadError")} onRetry={() => query.refetch()} />
      )}
      {query.isLoading && <ListSkeleton rows={1} />}
      {query.data && query.data.length === 0 && (
        <p className="text-sm text-muted">{t("automations.approvals.empty")}</p>
      )}
      {query.data?.map((suggestion) => {
        const payload = suggestion.payload as {
          ruleName?: string;
          actions?: { type: string; preview: string }[];
        };
        return (
          <div
            key={suggestion.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <p className="font-medium">
              {t("automations.approvals.rule", { name: payload.ruleName ?? "" })}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {payload.actions?.map((action, i) => (
                <li key={i} className="break-words">
                  {t(`automations.actions.${action.type}`)} — {action.preview}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                loading={accept.isPending}
                onClick={() => accept.mutate({ suggestionId: suggestion.id })}
              >
                {t("automations.approvals.approve")}
              </Button>
              <Button
                variant="secondary"
                loading={dismiss.isPending}
                onClick={() => dismiss.mutate({ suggestionId: suggestion.id })}
              >
                {t("automations.approvals.dismiss")}
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function RunsSection() {
  const query = trpc.automations.runs.useQuery({});
  const [cursor, setCursor] = useState<string | null>(null);
  const more = trpc.automations.runs.useQuery(
    { cursor: cursor ?? undefined },
    { enabled: !!cursor },
  );
  const items: RunRow[] = [...(query.data?.items ?? []), ...(more.data?.items ?? [])];
  const nextCursor = more.data ? more.data.nextCursor : query.data?.nextCursor;
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{t("automations.sections.runs")}</SectionTitle>
      {query.isError && (
        <ErrorBox message={t("automations.loadError")} onRetry={() => query.refetch()} />
      )}
      {query.isLoading && <ListSkeleton rows={2} />}
      {query.data && items.length === 0 && (
        <p className="text-sm text-muted">{t("automations.runs.empty")}</p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((run) => (
          <li
            key={run.id}
            className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <RunStatus status={run.status} awaiting={run.awaitingApproval} />
              <span className="font-medium">{run.ruleName}</span>
            </div>
            <span className="text-muted">
              {run.executedAt
                ? t("automations.runs.executedAt", { date: formatDateTime(run.executedAt) })
                : t("automations.runs.scheduledFor", { date: formatDateTime(run.scheduledFor) })}
              {run.attempts > 0 && ` · ${t("automations.runs.attempts", { count: run.attempts })}`}
            </span>
            {run.error && <span className="break-words text-muted">{run.error}</span>}
          </li>
        ))}
      </ul>
      {nextCursor && (
        <div>
          <Button variant="secondary" onClick={() => setCursor(nextCursor)}>
            {t("automations.runs.more")}
          </Button>
        </div>
      )}
    </section>
  );
}
