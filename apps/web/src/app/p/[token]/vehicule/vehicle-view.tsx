"use client";

// M14 US-M14-07 — historique et échéances d'un véhicule (jeton VEHICLE) : cartes VT / révision /
// assurance avec badge (couleur + icône + texte), liste des passages, facture et suivi en cours.
import { trpc } from "@/trpc/react";
import { fmtBusinessDay, fmtDay, fmtFCFA, fmtKm, tpl } from "../../_components/format";
import type { PortalLabels } from "../../_components/labels";
import { linkProblemOf, PortalLinkState } from "../../_components/link-state";
import { PortalFrame, PortalSkeleton } from "../../_components/portal-frame";

type DeadlineState = "OK" | "SOON" | "OVERDUE" | "UNKNOWN";

const BADGE: Record<DeadlineState, { icon: string; className: string }> = {
  OK: { icon: "✓", className: "bg-status-ok-bg text-status-ok" },
  SOON: { icon: "⏰", className: "bg-status-warn-bg text-status-warn" },
  OVERDUE: { icon: "⚠", className: "bg-status-bad-bg text-status-bad" },
  UNKNOWN: { icon: "?", className: "bg-surface-2 text-muted" },
};

function DeadlineCard({
  title,
  date,
  state,
  daysLeft,
  extra,
  L,
}: {
  title: string;
  date: Date | string | null;
  state: DeadlineState;
  daysLeft: number | null;
  extra?: string | null;
  L: PortalLabels["vehicle"];
}) {
  const badge = BADGE[state];
  const countdown =
    daysLeft === null
      ? null
      : daysLeft === 0
        ? L.today
        : daysLeft > 0
          ? tpl(L.inDays, { days: daysLeft })
          : tpl(L.overdueBy, { days: -daysLeft });
  return (
    <article className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm ${badge.className}`}
        >
          <span aria-hidden>{badge.icon}</span>
          {L.badges[state]}
        </span>
      </div>
      <p>{date ? fmtBusinessDay(date) : L.unknown}</p>
      {countdown && <p className="text-sm text-muted">{countdown}</p>}
      {extra && <p className="text-sm text-muted">{extra}</p>}
    </article>
  );
}

export function VehicleView({ token, labels }: { token: string; labels: PortalLabels }) {
  const L = labels.vehicle;
  const query = trpc.portal.vehicle.get.useQuery(
    { token },
    { retry: false, refetchOnWindowFocus: false },
  );
  const open = trpc.portal.vehicle.openDocument.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
  });
  if (query.isLoading) return <PortalSkeleton label={labels.loading} />;
  if (query.isError || !query.data) {
    return (
      <PortalFrame labels={labels}>
        <PortalLinkState
          problem={linkProblemOf(query.error)}
          token={token}
          labels={labels}
          onRetry={() => query.refetch()}
        />
      </PortalFrame>
    );
  }
  const { garage, vehicle, deadlines, visits } = query.data;
  return (
    <PortalFrame garage={garage} labels={labels}>
      <section className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{L.title}</h1>
        <p>
          {vehicle.make} {vehicle.model}
          {vehicle.year ? ` (${vehicle.year})` : ""} ·{" "}
          <span className="font-medium">{vehicle.plate}</span>
        </p>
        {vehicle.mileage !== null && (
          <p className="text-sm text-muted">{tpl(L.mileage, { km: fmtKm(vehicle.mileage) })}</p>
        )}
      </section>

      <section aria-labelledby="deadlines-title" className="flex flex-col gap-2">
        <h2 id="deadlines-title" className="font-semibold">
          {L.deadlines}
        </h2>
        <DeadlineCard title={L.inspection} L={L} {...deadlines.inspection} />
        <DeadlineCard
          title={L.service}
          L={L}
          {...deadlines.service}
          extra={
            deadlines.service.mileage
              ? tpl(L.aroundKm, { km: fmtKm(deadlines.service.mileage) })
              : null
          }
        />
        <DeadlineCard title={L.insurance} L={L} {...deadlines.insurance} />
      </section>

      <section aria-labelledby="history-title" className="flex flex-col gap-2">
        <h2 id="history-title" className="font-semibold">
          {L.history}
        </h2>
        {visits.length === 0 ? (
          <p className="rounded-lg bg-surface p-3 text-muted">{L.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visits.map((v) => (
              <li key={v.index} className="flex flex-col gap-1 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{fmtDay(v.date)}</span>
                  {v.inProgress ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-status-warn-bg px-2 py-0.5 text-sm text-status-warn">
                      <span aria-hidden>🔧</span>
                      {L.inProgress}
                    </span>
                  ) : (
                    <span>{fmtFCFA(v.amount)}</span>
                  )}
                </div>
                <p className="break-words">{v.summary || v.number}</p>
                {v.mileage !== null && (
                  <p className="text-sm text-muted">{tpl(L.visitKm, { km: fmtKm(v.mileage) })}</p>
                )}
                {v.inProgress ? (
                  <button
                    type="button"
                    className="btn btn-primary min-h-12"
                    disabled={open.isPending}
                    onClick={() => open.mutate({ token, kind: "repair_order", index: v.index })}
                  >
                    {L.follow}
                  </button>
                ) : (
                  v.hasInvoice && (
                    <button
                      type="button"
                      className="btn btn-secondary min-h-12"
                      disabled={open.isPending}
                      onClick={() => open.mutate({ token, kind: "invoice", index: v.index })}
                    >
                      {L.invoicePdf}
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalFrame>
  );
}
