"use client";

// M17 §7 `/parametres/ia` — interrupteurs par fonction (RG-M17-10), optimisation horaire,
// consommation du mois (jauge crédits, top fonctions, taux d'acceptation) et journal des 100
// derniers appels (fonction, date, statut, crédits, accepté). Réservé à `ai:configure`.
import { AI_FEATURES, isFeatureInPlan, type AiFeature } from "@atelieros/core/ai";
import { Button, PageHead, StatusBadge } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "off"> = {
  OK: "ok",
  INVALID_OUTPUT: "warn",
  TIMEOUT: "warn",
  ERROR: "bad",
  QUOTA_EXCEEDED: "bad",
  DISABLED: "off",
};

function featureLabel(feature: string): string {
  return (AI_FEATURES as readonly string[]).includes(feature)
    ? t(`aiSettings.features.${feature}`)
    : feature;
}

function Toggle({
  label,
  checked,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <span className="flex flex-col">
        <span>{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="h-5 w-5 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function Skeletons() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

export default function AiSettingsPage() {
  const utils = trpc.useUtils();
  const settings = trpc.ai.settings.get.useQuery();
  const usage = trpc.ai.usage.useQuery();
  const journal = trpc.ai.interactions.list.useQuery({});
  const update = trpc.ai.settings.update.useMutation({
    onSuccess: () => {
      void utils.ai.settings.get.invalidate();
      void utils.ai.status.invalidate();
    },
  });

  if (settings.isError || usage.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
        <p className="text-sm text-status-bad">{t("aiSettings.loadError")}</p>
        <Button
          variant="secondary"
          onClick={() => {
            void settings.refetch();
            void usage.refetch();
          }}
        >
          {t("aiSettings.retry")}
        </Button>
      </div>
    );
  }
  if (!settings.data || !usage.data) return <Skeletons />;

  const ai = settings.data.ai;
  const plan = usage.data.plan;
  const ratio = usage.data.quota ? Math.min(1, usage.data.credits / usage.data.quota) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHead title={t("aiSettings.title")} description={t("aiSettings.description")} />
      <p className="text-sm text-muted">
        {t("aiSettings.provider", {
          name:
            settings.data.provider === "console"
              ? t("aiSettings.providerConsole")
              : settings.data.provider,
        })}
      </p>
      {update.isSuccess && (
        <p role="status" className="text-sm text-status-ok">
          {t("aiSettings.saved")}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <Toggle
          label={t("aiSettings.enabled")}
          checked={ai.enabled}
          onChange={(enabled) => update.mutate({ enabled })}
        />
        <Toggle
          label={t("aiSettings.assistantEnabled")}
          checked={ai.assistantEnabled}
          disabled={!ai.enabled}
          onChange={(assistantEnabled) => update.mutate({ assistantEnabled })}
        />
        <Toggle
          label={t("aiSettings.autoTimeOptimization")}
          checked={ai.autoTimeOptimization}
          disabled={!ai.enabled}
          onChange={(autoTimeOptimization) => update.mutate({ autoTimeOptimization })}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("aiSettings.featuresTitle")}</h3>
        {AI_FEATURES.map((feature: AiFeature) => (
          <Toggle
            key={feature}
            label={featureLabel(feature)}
            checked={ai.features[feature]}
            disabled={!ai.enabled || !isFeatureInPlan(plan, feature)}
            hint={isFeatureInPlan(plan, feature) ? undefined : t("aiSettings.notInPlan")}
            onChange={(value) => update.mutate({ features: { [feature]: value } })}
          />
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("aiSettings.usageTitle")}</h3>
        <p className="text-sm" data-testid="ai-credits">
          {t("aiSettings.usageCredits", { used: usage.data.credits, quota: usage.data.quota })}
        </p>
        <div
          className="h-3 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={usage.data.quota}
          aria-valuenow={usage.data.credits}
        >
          <div
            className={`h-full ${ratio >= 1 ? "bg-status-bad" : ratio >= 0.8 ? "bg-status-warn" : "bg-accent"}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
        {ratio >= 1 && (
          <p className="text-sm text-status-bad">⚠ {t("aiSettings.usageQuotaReached")}</p>
        )}
        <h4 className="mt-2 text-sm font-medium">{t("aiSettings.usageByFeature")}</h4>
        {usage.data.byFeature.length === 0 ? (
          <p className="text-sm text-muted">{t("aiSettings.usageEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {usage.data.byFeature.map((row) => (
              <li
                key={row.feature}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span>{featureLabel(row.feature)}</span>
                <span className="text-muted">
                  {t("aiSettings.colCalls")} {row.calls} · {t("aiSettings.colCredits")}{" "}
                  {row.credits} · {t("aiSettings.colAcceptance")}{" "}
                  {row.acceptanceRate === null
                    ? t("aiSettings.undecided")
                    : `${Math.round(row.acceptanceRate * 100)} %`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("aiSettings.journalTitle")}</h3>
        {journal.isLoading && <Skeletons />}
        {journal.data && journal.data.length === 0 && (
          <p className="text-sm text-muted">{t("aiSettings.journalEmpty")}</p>
        )}
        <ul className="flex flex-col gap-1">
          {journal.data?.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="flex flex-col">
                <span>{featureLabel(row.feature)}</span>
                <span className="text-xs text-muted">
                  {new Intl.DateTimeFormat("fr-FR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(row.createdAt))}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={STATUS_TONE[row.status] ?? "off"}>
                  {t(`aiSettings.status.${row.status in STATUS_TONE ? row.status : "ERROR"}`)}
                </StatusBadge>
                <span className="text-muted">
                  {t("aiSettings.colCredits")} {row.credits} · {t("aiSettings.colAccepted")}{" "}
                  {row.accepted === null
                    ? t("aiSettings.undecided")
                    : row.accepted
                      ? t("aiSettings.yes")
                      : t("aiSettings.no")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
