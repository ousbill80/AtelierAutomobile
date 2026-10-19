"use client";

// M04 US-M04-16 — suivi public de la réparation (sans compte) : frise de statut, promesse,
// constats partagés, travaux validés. RG-M04-18 : aucune donnée interne.
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { InspectionResultBadge } from "@/components/repair-orders/badges";
import { formatDateTime, t } from "@/components/repair-orders/i18n";
import { trpc } from "@/trpc/react";

export function TrackingView({ token }: { token: string }) {
  const query = trpc.portal.repairOrder.tracking.useQuery({ token }, { retry: false });
  if (query.isLoading)
    return <div className="mx-auto h-64 w-full max-w-lg animate-pulse rounded-lg bg-surface-2" />;
  if (query.isError || !query.data) {
    return (
      <p role="alert" className="p-6 text-center text-status-bad">
        {t("portal.invalid")}
      </p>
    );
  }
  const d = query.data;
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <span className="text-sm text-muted">{d.garage.name}</span>
        <h1 className="text-xl font-semibold">{t("portal.title")}</h1>
        <span className="text-sm">
          {d.vehicle.make} {d.vehicle.model} · {d.vehicle.plate}
        </span>
        <span className="text-xs text-muted">{t("portal.number", { number: d.number })}</span>
      </header>
      {d.cancelled ? (
        <p className="rounded-md bg-surface-2 p-3">{t("portal.cancelled")}</p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label={t("portal.title")}>
          {d.steps.map((step, i) => {
            const done = i < d.timelineIndex;
            const current = i === d.timelineIndex;
            return (
              <li
                key={step.step}
                aria-current={current ? "step" : undefined}
                className={`flex items-center gap-3 rounded-md p-2 ${current ? "bg-accent text-accent-foreground" : done ? "bg-status-ok-bg" : "bg-surface"}`}
              >
                <span aria-hidden className="w-5 text-center font-bold">
                  {done ? "✓" : current ? "●" : "○"}
                </span>
                <span className="flex-1 font-medium">{step.label}</span>
                {step.at && <span className="text-xs">{formatDateTime(step.at)}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {d.promisedAt && !d.cancelled && (
        <p className="text-sm">{t("portal.promise", { date: formatDateTime(d.promisedAt) })}</p>
      )}
      {d.signaturePending && (
        <Link href={`/p/${token}/reception`} className="btn btn-primary min-h-11">
          ✍ {t("portal.signReception")}
        </Link>
      )}
      {d.findings.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">{t("portal.findings")}</h2>
          {d.findings.map((f) => (
            <div key={f.id} className="flex flex-col gap-1 rounded-md bg-surface p-2 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <InspectionResultBadge result={f.result} />
                {f.label}
                {f.measurement ? ` (${f.measurement})` : ""}
              </span>
              {f.photos.map((p) => (
                <img
                  key={p}
                  src={`/api/portail/${token}/photos/${p}`}
                  alt={f.label}
                  loading="lazy"
                  className="max-h-48 rounded object-cover"
                />
              ))}
            </div>
          ))}
        </section>
      )}
      {d.lines.length > 0 && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="font-semibold">{t("portal.works")}</h2>
          {d.lines.map((l) => (
            <div key={l.id} className="flex justify-between gap-2">
              <span>{l.description}</span>
              <span>{formatFCFA(l.total)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-1 font-semibold">
            <span>{t("portal.total")}</span>
            <span>{formatFCFA(d.total)}</span>
          </div>
        </section>
      )}
      {d.pendingLines.length > 0 && (
        <section className="flex flex-col gap-1 rounded-md bg-status-warn-bg p-2 text-sm text-status-warn">
          <h2 className="font-semibold">{t("portal.pending")}</h2>
          {d.pendingLines.map((l) => (
            <div key={l.id} className="flex justify-between gap-2">
              <span>{l.description}</span>
              <span>{formatFCFA(l.total)}</span>
            </div>
          ))}
          <span className="text-xs">{t("portal.pendingHint")}</span>
        </section>
      )}
      {d.garage.phone && (
        <a href={`tel:${d.garage.phone}`} className="btn btn-secondary min-h-11">
          📞 {t("portal.call")}
        </a>
      )}
    </main>
  );
}
