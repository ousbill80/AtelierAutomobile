"use client";

// PRD M10 §7.3 — règles de relance. Simplification documentée (déjà actée ailleurs dans cette
// session pour M10) : liste éditable plutôt que la frise chronologique glisser-déposer du PRD.
import { useState } from "react";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { LinkButton } from "@/components/link-button";
import { REMINDER_TYPE_LABELS } from "../../relances/reminder-labels";
import type { ReminderRuleUpsertInput } from "@atelieros/validators";
import { stepCount, toRuleInput } from "./rule-shape";
import { t } from "@/i18n/t";

export default function ReminderRulesPage() {
  const utils = trpc.useUtils();
  const { data: rules, isLoading, isError, refetch } = trpc.reminderRules.list.useQuery();
  const me = trpc.me.get.useQuery(undefined, { staleTime: 60_000 });
  const canManage = (me.data?.permissions ?? []).includes("reminder:rules_manage");
  const toggle = trpc.reminderRules.toggle.useMutation({
    onSettled: () => utils.reminderRules.list.invalidate(),
  });
  const [simulatingId, setSimulatingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("reminders.rules.title")}</h1>
        {canManage && (
          <LinkButton href="/parametres/relances/nouveau">{t("reminders.rules.new")}</LinkButton>
        )}
      </div>

      {me.data && !canManage && (
        <p className="rounded-md bg-surface-2 p-3 text-sm text-muted">
          {t("reminders.rules.readOnly")}
        </p>
      )}

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-border bg-surface-2"
            />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">{t("reminders.rules.loadError")}</p>
          <Button variant="secondary" onClick={() => refetch()}>
            {t("reminders.rules.retry")}
          </Button>
        </div>
      )}

      {rules && rules.length === 0 && (
        <EmptyState
          title={t("reminders.rules.emptyTitle")}
          description={t("reminders.rules.emptyHint")}
          action={
            canManage ? (
              <LinkButton href="/parametres/relances/nouveau">
                {t("reminders.rules.new")}
              </LinkButton>
            ) : undefined
          }
        />
      )}

      <div className="flex flex-col gap-3">
        {rules?.map((rule) => (
          <div
            key={rule.id}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{rule.name}</p>
                <p className="text-sm text-muted">
                  {t("reminders.rules.summary", {
                    type: REMINDER_TYPE_LABELS[rule.type] ?? rule.type,
                    count: stepCount(rule),
                  })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={rule.isActive}
                    disabled={!canManage || (toggle.isPending && toggle.variables?.id === rule.id)}
                    onChange={(e) => toggle.mutate({ id: rule.id, isActive: e.target.checked })}
                  />
                  {t("reminders.rules.active")}
                </label>
                <LinkButton href={`/parametres/relances/${rule.id}`} variant="secondary">
                  {t("reminders.rules.edit")}
                </LinkButton>
                {canManage && (
                  <Button
                    variant="ghost"
                    onClick={() => setSimulatingId((v) => (v === rule.id ? null : rule.id))}
                  >
                    {t("reminders.rules.simulate")}
                  </Button>
                )}
              </div>
            </div>

            {toggle.error && toggle.variables?.id === rule.id && (
              <p role="alert" className="text-sm text-status-bad">
                {t("reminders.rules.toggleError", { message: toggle.error.message })}
              </p>
            )}

            {canManage && simulatingId === rule.id && <SimulatePanel rule={rule} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function SimulatePanel({ rule }: { rule: Parameters<typeof toRuleInput>[0] }) {
  const parsed = toRuleInput(rule);
  if (!parsed.ok) {
    return (
      <p role="alert" className="rounded-md bg-status-bad-bg p-3 text-sm text-status-bad">
        {t("reminders.rules.invalidRule", { message: parsed.message })}
      </p>
    );
  }
  return <SimulateResult input={parsed.input} />;
}

function SimulateResult({ input }: { input: ReminderRuleUpsertInput }) {
  const { data, isLoading, isError, error } = trpc.reminderRules.simulate.useQuery(
    { rule: input, days: 30 },
    { retry: false },
  );

  return (
    <div className="rounded-md bg-surface-2 p-3 text-sm">
      {isLoading && <p className="text-muted">{t("reminders.rules.simulating")}</p>}
      {isError && (
        <p role="alert" className="text-status-bad">
          {t("reminders.rules.simulateError")} {error.message}
        </p>
      )}
      {data && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">{t("reminders.rules.simulateTotal", { total: data.total })}</p>
          <ul className="flex flex-wrap gap-3">
            {Object.entries(data.byStep).map(([step, count]) => (
              <li key={step}>{t("reminders.rules.stepCount", { step, count })}</li>
            ))}
          </ul>
          {data.noChannel > 0 && (
            <p className="text-status-warn">
              {t("reminders.rules.noChannel", { count: data.noChannel })}
            </p>
          )}
          {data.sample.length > 0 && (
            <div>
              <p className="mb-1 text-muted">{t("reminders.rules.sample")}</p>
              <ul className="flex flex-col gap-1">
                {data.sample.map((s, i) => (
                  <li key={i} className="text-xs">
                    {t("reminders.rules.sampleLine", {
                      entity:
                        [s.plate, s.customer].filter(Boolean).join(" · ") ||
                        t("reminders.rules.sampleUnknown"),
                      step: s.stepKey,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
