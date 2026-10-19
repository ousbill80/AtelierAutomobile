"use client";

import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/client";
import { RuleForm } from "../rule-form";
import { toRuleInput } from "../rule-shape";

export function RuleEditView({ id }: { id: string }) {
  const { data: rule, isLoading, isError, refetch } = trpc.reminderRules.get.useQuery({ id });

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-surface-2" />;
  }

  if (isError || !rule) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
        <p className="text-sm text-status-bad">Règle introuvable.</p>
        <Button variant="secondary" onClick={() => refetch()}>
          Réessayer
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Modifier « {rule.name} »</h1>
      <RuleForm key={rule.id} initial={toRuleInput(rule)} />
    </div>
  );
}
