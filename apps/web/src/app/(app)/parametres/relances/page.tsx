"use client";

// PRD M10 §7.3 — règles de relance. Simplification documentée (déjà actée ailleurs dans cette
// session pour M10) : liste éditable plutôt que la frise chronologique glisser-déposer du PRD.
import { useState } from "react";
import Link from "next/link";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/client";
import { REMINDER_TYPE_LABELS } from "../../relances/reminder-labels";
import { stepCount, toRuleInput } from "./rule-shape";

export default function ReminderRulesPage() {
  const utils = trpc.useUtils();
  const { data: rules, isLoading, isError, refetch } = trpc.reminderRules.list.useQuery();
  const toggle = trpc.reminderRules.toggle.useMutation({
    onSuccess: () => utils.reminderRules.list.invalidate(),
  });
  const [simulatingId, setSimulatingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Règles de relance</h1>
        <Link href="/parametres/relances/nouveau" className="btn btn-primary">
          Nouvelle règle
        </Link>
      </div>

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
          <p className="text-sm text-status-bad">Impossible de charger les règles.</p>
          <Button variant="secondary" onClick={() => refetch()}>
            Réessayer
          </Button>
        </div>
      )}

      {rules && rules.length === 0 && (
        <EmptyState
          title="Aucune règle de relance."
          description="Créez votre première règle pour démarrer les relances automatiques."
          action={
            <Link href="/parametres/relances/nouveau" className="btn btn-primary">
              Nouvelle règle
            </Link>
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
                  {REMINDER_TYPE_LABELS[rule.type] ?? rule.type} · {stepCount(rule)} palier(s)
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={rule.isActive}
                    onChange={(e) => toggle.mutate({ id: rule.id, isActive: e.target.checked })}
                  />
                  Active
                </label>
                <Link href={`/parametres/relances/${rule.id}`} className="btn btn-secondary">
                  Modifier
                </Link>
                <Button
                  variant="ghost"
                  onClick={() => setSimulatingId((v) => (v === rule.id ? null : rule.id))}
                >
                  Simuler
                </Button>
              </div>
            </div>

            {simulatingId === rule.id && <SimulatePanel rule={rule} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function SimulatePanel({ rule }: { rule: Parameters<typeof toRuleInput>[0] }) {
  const input = toRuleInput(rule);
  const { data, isLoading, isError } = trpc.reminderRules.simulate.useQuery({
    rule: input,
    days: 30,
  });

  return (
    <div className="rounded-md bg-surface-2 p-3 text-sm">
      {isLoading && <p className="text-muted">Calcul en cours…</p>}
      {isError && <p className="text-status-bad">Impossible de simuler cette règle.</p>}
      {data && (
        <div className="flex flex-col gap-2">
          <p>
            Sur les 30 prochains jours : <span className="font-semibold">{data.total}</span>{" "}
            relance(s).
          </p>
          <ul className="flex flex-wrap gap-3">
            {Object.entries(data.byStep).map(([step, count]) => (
              <li key={step}>
                {step} : {count}
              </li>
            ))}
          </ul>
          {data.noChannel > 0 && (
            <p className="text-status-warn">{data.noChannel} candidat(s) sans canal.</p>
          )}
          {data.sample.length > 0 && (
            <div>
              <p className="mb-1 text-muted">Échantillon :</p>
              <ul className="flex flex-col gap-1">
                {data.sample.map((s, i) => (
                  <li key={i} className="font-mono text-xs">
                    {s.entityId} — palier {s.stepKey}
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
