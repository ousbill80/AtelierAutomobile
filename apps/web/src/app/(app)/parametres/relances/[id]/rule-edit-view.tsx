"use client";

import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { RuleForm } from "../rule-form";
import { toRuleInput } from "../rule-shape";
import { t } from "@/i18n/t";

export function RuleEditView({ id }: { id: string }) {
  const { data: rule, isLoading, isError, refetch } = trpc.reminderRules.get.useQuery({ id });

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-surface-2" />;
  }

  if (isError || !rule) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
        <p className="text-sm text-status-bad">{t("reminders.rules.notFound")}</p>
        <Button variant="secondary" onClick={() => refetch()}>
          {t("reminders.rules.retry")}
        </Button>
      </div>
    );
  }

  const parsed = toRuleInput(rule);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">
        {t("reminders.rules.editTitle", { name: rule.name })}
      </h1>
      {parsed.ok ? (
        <RuleForm key={rule.id} initial={parsed.input} />
      ) : (
        <p role="alert" className="rounded-md bg-status-bad-bg p-3 text-sm text-status-bad">
          {t("reminders.rules.invalidRuleEdit", { message: parsed.message })}
        </p>
      )}
    </div>
  );
}
