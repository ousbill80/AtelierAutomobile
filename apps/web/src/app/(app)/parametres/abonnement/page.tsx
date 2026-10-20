"use client";

// M15 §7 `/parametres/abonnement` — US-M15-07 : offre actuelle, jauges d'usage (80 % / 100 %),
// comparatif des offres et demande de changement (RG-M15-19/20). Réservé à `settings:billing`.
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { formatDate } from "@atelieros/core/calendar";
import { Button, Field, Modal, PageHead, StatusBadge, Textarea } from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type PlanOutput = inferRouterOutputs<AppRouter>["plan"]["get"];
type Tier = PlanOutput["plan"];
type Gauge = PlanOutput["gauges"][number];

const LEVEL_TONE = { OK: "ok", WARNING: "warn", REACHED: "bad" } as const;
const LEVEL_ICON = { OK: "✓", WARNING: "!", REACHED: "✕" } as const;
const GB = 1024 * 1024 * 1024;

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value).replace(/\u202f|\u00a0/g, " ");
}

function formatQuantity(key: string, value: number): string {
  if (key === "storageBytes") {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value / GB)} Go`;
  }
  return formatNumber(value);
}

function GaugeRow({ gauge }: { gauge: Gauge }) {
  const ratio = gauge.limit ? Math.min(1, gauge.used / gauge.limit) : 0;
  const limit =
    gauge.limit === null ? t("subscription.unlimited") : formatQuantity(gauge.key, gauge.limit);
  return (
    <li className="flex flex-col gap-1 rounded-md border p-3" data-testid={`gauge-${gauge.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{t(`subscription.gauges.${gauge.key}`)}</span>
        <span>
          {formatQuantity(gauge.key, gauge.used)}/{limit}
        </span>
      </div>
      {gauge.limit !== null ? (
        <div
          className="h-2 w-full overflow-hidden rounded bg-surface-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={gauge.limit}
          aria-valuenow={gauge.used}
          aria-label={t(`subscription.gauges.${gauge.key}`)}
        >
          <div
            className={
              gauge.level === "REACHED"
                ? "h-full bg-status-bad"
                : gauge.level === "WARNING"
                  ? "h-full bg-status-warn"
                  : "h-full bg-status-ok"
            }
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      ) : null}
      {gauge.level !== "OK" ? (
        <StatusBadge tone={LEVEL_TONE[gauge.level]}>
          <span aria-hidden="true">{LEVEL_ICON[gauge.level]} </span>
          {t(`subscription.levels.${gauge.level}`)}
        </StatusBadge>
      ) : null}
    </li>
  );
}

function featureLines(plan: PlanOutput["catalog"][number]) {
  return [
    { label: t("subscription.features.aiAssistant"), included: plan.features.aiAssistant },
    { label: t("subscription.features.multiSite"), included: plan.features.multiSite },
    { label: t("subscription.features.portalFull"), included: plan.features.portal === "full" },
    {
      label: t("subscription.features.publicApiFull"),
      included: plan.features.publicApi === "full",
    },
  ];
}

function Skeletons() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

export default function SubscriptionPage() {
  const utils = trpc.useUtils();
  const plan = trpc.plan.get.useQuery();
  const me = trpc.me.get.useQuery();
  const timeZone = me.data?.activeOrganization?.timezone ?? "Africa/Abidjan";
  const [target, setTarget] = useState<Tier | null>(null);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [impact, setImpact] = useState<string[]>([]);
  const request = trpc.plan.requestChange.useMutation({
    onSuccess(result) {
      setNotice(
        result.status === "APPLIED"
          ? t("subscription.applied", { plan: t(`subscription.plans.${result.plan}`) })
          : null,
      );
      setImpact(
        result.downgradeImpact.map((i) =>
          t("subscription.impact", {
            label: t(`subscription.gauges.${i.key}`),
            used: formatNumber(i.used),
            limit: formatNumber(i.limit),
            excess: formatNumber(i.excess),
          }),
        ),
      );
      setTarget(null);
      setMessage("");
      void utils.plan.get.invalidate();
      void utils.me.get.invalidate();
    },
  });

  if (plan.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
        <p className="text-sm text-status-bad">{t("subscription.loadError")}</p>
        <Button variant="secondary" onClick={() => void plan.refetch()}>
          {t("subscription.retry")}
        </Button>
      </div>
    );
  }
  if (!plan.data) return <Skeletons />;

  const data = plan.data;
  const isDowngrade =
    target !== null &&
    data.catalog.findIndex((p) => p.tier === target) <
      data.catalog.findIndex((p) => p.tier === data.plan);

  return (
    <div className="flex flex-col gap-6">
      <PageHead title={t("subscription.title")} description={t("subscription.description")} />
      <p className="text-base font-semibold" data-testid="current-plan">
        {t("subscription.currentPlan", { plan: t(`subscription.plans.${data.plan}`) })}
      </p>
      {notice ? (
        <p role="status" className="text-sm text-status-ok">
          ✓ {notice}
        </p>
      ) : null}
      {impact.length > 0 ? (
        <div role="status" className="rounded-md border border-status-warn p-3 text-sm">
          <p>⚠ {t("subscription.downgradeWarning")}</p>
          <ul className="mt-1 list-disc pl-5">
            {impact.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.pendingRequest?.targetPlan ? (
        <p role="status" className="rounded-md border p-3 text-sm">
          ⏳{" "}
          {t("subscription.pending", {
            plan: t(`subscription.plans.${data.pendingRequest.targetPlan}`),
            date: formatDate(new Date(data.pendingRequest.requestedAt), timeZone),
          })}
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("subscription.usageTitle")}</h3>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {data.gauges.map((gauge) => (
            <GaugeRow key={gauge.key} gauge={gauge} />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("subscription.compareTitle")}</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {data.catalog.map((offer) => {
            const isCurrent = offer.tier === data.plan;
            return (
              <article
                key={offer.tier}
                className="flex flex-col gap-2 rounded-lg border p-4"
                data-testid={`plan-${offer.tier}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold">{t(`subscription.plans.${offer.tier}`)}</h4>
                  {isCurrent ? (
                    <StatusBadge tone="ok">✓ {t("subscription.current")}</StatusBadge>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-1 text-sm">
                  {(
                    [
                      "activeMembers",
                      "activeSites",
                      "autoMessagesPerMonth",
                      "aiCreditsPerMonth",
                    ] as const
                  ).map((key) => (
                    <li key={key}>
                      {t(`subscription.gauges.${key}`)} :{" "}
                      {offer.quotas[key] === null
                        ? t("subscription.unlimited")
                        : formatNumber(offer.quotas[key]!)}
                    </li>
                  ))}
                  {featureLines(offer).map((line) => (
                    <li key={line.label}>
                      <span aria-hidden="true">{line.included ? "✓ " : "— "}</span>
                      <span className="sr-only">
                        {line.included
                          ? t("subscription.included")
                          : t("subscription.notIncluded")}{" "}
                      </span>
                      {line.label}
                    </li>
                  ))}
                  <li>
                    {t("subscription.features.auditRetention", {
                      days: offer.quotas.auditRetentionDays,
                    })}
                  </li>
                </ul>
                {!isCurrent ? (
                  <Button
                    variant="secondary"
                    className="mt-auto min-h-11"
                    onClick={() => {
                      request.reset();
                      setTarget(offer.tier);
                    }}
                  >
                    {t("subscription.choose", { plan: t(`subscription.plans.${offer.tier}`) })}
                  </Button>
                ) : null}
              </article>
            );
          })}
        </div>
        <p className="text-xs text-muted">{t("subscription.smsCostNote")}</p>
      </section>

      <Modal
        open={target !== null}
        title={
          target
            ? t("subscription.requestModalTitle", { plan: t(`subscription.plans.${target}`) })
            : ""
        }
        onClose={() => setTarget(null)}
        footer={
          <Button
            loading={request.isPending}
            onClick={() =>
              target && request.mutate({ targetPlan: target, message: message || undefined })
            }
          >
            {t("subscription.submit")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t("subscription.requestHint")}</p>
          {isDowngrade ? (
            <p className="text-sm text-status-warn">⚠ {t("subscription.downgradeWarning")}</p>
          ) : null}
          <Field label={t("subscription.messageLabel")}>
            <Textarea
              value={message}
              maxLength={1000}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          {request.error ? (
            <p role="alert" className="error">
              {request.error.message}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
