"use client";

// M14 US-M04-16 / US-M14-04 — espace client d'un OR, mis à jour en temps réel : frise de statut,
// date promise, photos (carrousel), inspection en feux tricolores (couleur + icône + texte),
// remarques de l'atelier, devis et factures de l'OR (accord, paiement). Temps réel : SSE sur
// `/p/{token}/events`, repli polling 30 s si le navigateur ne gère pas SSE ou si le flux échoue,
// pause après 10 min d'onglet inactif (RG-M14-18). Aucune donnée interne (RG-M14-17).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TRACKING_IDLE_DISCONNECT_MS,
  TRACKING_POLL_INTERVAL_MS,
} from "@atelieros/core/portal/tracking";
import { trpc } from "@/trpc/react";
import { fmtDateTime, fmtFCFA, fmtTime, tpl } from "../../_components/format";
import type { PortalLabels } from "../../_components/labels";
import { linkProblemOf, PortalLinkState } from "../../_components/link-state";
import { PortalFrame, PortalSkeleton } from "../../_components/portal-frame";

type Mode = "live" | "polling" | "paused";

/** Abonnement temps réel : appelle `onChange` à chaque mise à jour signalée (ou toutes les 30 s). */
function useLiveUpdates(token: string, enabled: boolean, onChange: () => void): Mode {
  const [mode, setMode] = useState<Mode>("live");
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let stopped = false;

    const stopAll = () => {
      source?.close();
      source = null;
      if (poll) clearInterval(poll);
      poll = null;
    };
    const startPolling = () => {
      stopAll();
      setMode("polling");
      poll = setInterval(() => onChangeRef.current(), TRACKING_POLL_INTERVAL_MS);
    };
    const startLive = () => {
      if (typeof EventSource === "undefined") return startPolling();
      stopAll();
      setMode("live");
      source = new EventSource(`/p/${token}/events`);
      source.addEventListener("update", () => onChangeRef.current());
      source.addEventListener("gone", () => {
        stopAll();
        onChangeRef.current();
      });
      source.addEventListener("bye", () => {
        // Fin de connexion côté serveur (10 min) : on rouvre si l'onglet est visible.
        if (!stopped && document.visibilityState === "visible") startLive();
      });
      source.addEventListener("open", () => {
        failures = 0;
      });
      source.onerror = () => {
        failures += 1;
        if (failures >= 3) startPolling();
      };
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        idleTimer = setTimeout(() => {
          stopAll();
          setMode("paused");
        }, TRACKING_IDLE_DISCONNECT_MS);
      } else {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        if (!source && !poll) {
          onChangeRef.current();
          startLive();
        }
      }
    };

    startLive();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      stopAll();
      if (idleTimer) clearTimeout(idleTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, enabled]);

  return mode;
}

const RESULT_STYLE = {
  URGENT: { icon: "🔴", className: "bg-status-bad-bg text-status-bad" },
  WATCH: { icon: "🟠", className: "bg-status-warn-bg text-status-warn" },
  OK: { icon: "🟢", className: "bg-status-ok-bg text-status-ok" },
} as const;

function docTone(status: string): string {
  if (status === "PAID" || status === "ACCEPTED" || status === "CONVERTED") {
    return "bg-status-ok-bg text-status-ok";
  }
  if (status === "DECLINED" || status === "EXPIRED" || status === "OVERDUE") {
    return "bg-status-bad-bg text-status-bad";
  }
  return "bg-status-warn-bg text-status-warn";
}

function docIcon(status: string): string {
  if (status === "PAID" || status === "ACCEPTED" || status === "CONVERTED") return "✓";
  if (status === "DECLINED" || status === "EXPIRED" || status === "OVERDUE") return "✕";
  return "⏳";
}

export function TrackingView({ token, labels }: { token: string; labels: PortalLabels }) {
  const L = labels.tracking;
  const utils = trpc.useUtils();
  const query = trpc.portal.repairOrder.tracking.useQuery(
    { token },
    { retry: false, refetchOnWindowFocus: false },
  );
  const [refreshError, setRefreshError] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const open = trpc.portal.repairOrder.openDocument.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
  });

  const refresh = useCallback(async () => {
    try {
      const data = await utils.portal.repairOrder.tracking.fetch(
        { token, refresh: true },
        { staleTime: 0 },
      );
      utils.portal.repairOrder.tracking.setData({ token }, data);
      setRefreshError(false);
      setRefreshedAt(new Date());
    } catch (error) {
      const problem = linkProblemOf(error as { message?: string });
      // Lien devenu invalide en cours de suivi : on bascule sur l'état du lien.
      if (problem !== "NETWORK") await query.refetch();
      else setRefreshError(true);
    }
  }, [utils, token, query]);

  const mode = useLiveUpdates(token, query.isSuccess, refresh);

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
  const d = query.data;
  const photos = d.photos;
  const current = photos[Math.min(photoIndex, Math.max(0, photos.length - 1))];
  const payable = d.documents.find(
    (doc) => doc.kind === "invoice" && doc.balance !== null && doc.balance > 0,
  );
  const delivered = d.status === "DELIVERED";

  return (
    <PortalFrame garage={d.garage} labels={labels}>
      <section className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{L.title}</h1>
        <p>
          {d.vehicle.make} {d.vehicle.model} ·{" "}
          <span className="font-medium">{d.vehicle.plate}</span>
        </p>
        <p className="text-sm text-muted">{tpl(L.number, { number: d.number })}</p>
        <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <span
            aria-hidden
            className={`inline-block size-2 rounded-full ${mode === "live" ? "bg-status-ok" : "bg-status-off"}`}
          />
          {mode === "live" ? L.live : mode === "polling" ? L.polling : L.paused}
          {refreshedAt && <span>· {tpl(L.updatedAt, { time: fmtTime(refreshedAt) })}</span>}
        </p>
        {refreshError && (
          <p role="status" className="rounded-md bg-status-warn-bg p-2 text-sm text-status-warn">
            {labels.networkError}
          </p>
        )}
      </section>

      {d.ready && (
        <section
          role="status"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-lg bg-status-ok-bg p-4 text-status-ok"
        >
          <p className="text-lg font-semibold">✓ {L.ready}</p>
          <p className="text-foreground">{L.readyHint}</p>
          {payable && (
            <button
              type="button"
              className="btn btn-primary min-h-12 w-full"
              disabled={open.isPending}
              onClick={() => open.mutate({ token, kind: "invoice", index: payable.index })}
            >
              {tpl(L.payInvoice, { amount: fmtFCFA(payable.balance ?? 0) })}
            </button>
          )}
        </section>
      )}

      {d.cancelled ? (
        <p className="rounded-md bg-surface-2 p-3">{L.cancelled}</p>
      ) : delivered ? (
        <p className="rounded-md bg-status-ok-bg p-3 text-status-ok">✓ {L.delivered}</p>
      ) : (
        <section aria-labelledby="timeline-title" className="flex flex-col gap-2">
          <h2 id="timeline-title" className="font-semibold">
            {L.timeline}
          </h2>
          <ol className="flex flex-col gap-2">
            {d.steps.map((step, i) => {
              const done = i < d.timelineIndex;
              const isCurrent = i === d.timelineIndex;
              return (
                <li
                  key={step.step}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-md p-2 ${isCurrent ? "bg-accent text-accent-foreground" : done ? "bg-status-ok-bg" : "bg-surface"}`}
                >
                  <span aria-hidden className="w-5 text-center font-bold">
                    {done ? "✓" : isCurrent ? "●" : "○"}
                  </span>
                  <span className="flex-1 font-medium">
                    {step.label}
                    <span className="sr-only">
                      {" "}
                      — {done ? L.stepDone : isCurrent ? L.stepCurrent : L.stepTodo}
                    </span>
                  </span>
                  {step.at && <span className="text-sm">{fmtDateTime(step.at)}</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {d.promisedAt && !d.cancelled && !delivered && (
        <p>{tpl(L.promise, { date: fmtDateTime(d.promisedAt) })}</p>
      )}

      {d.signaturePending && (
        <a href={`/p/${token}/reception`} className="btn btn-primary min-h-12">
          ✍ {L.signReception}
        </a>
      )}

      {d.documents.length > 0 && (
        <section aria-labelledby="docs-title" className="flex flex-col gap-2">
          <h2 id="docs-title" className="font-semibold">
            {L.documents}
          </h2>
          {d.documents.map((doc) => {
            const statusLabel =
              doc.kind === "quote"
                ? (L.quoteStatus as Record<string, string>)[doc.status]
                : (L.invoiceStatus as Record<string, string>)[doc.status];
            const action =
              doc.kind === "quote"
                ? doc.awaitingDecision
                  ? L.decideQuote
                  : L.seeQuote
                : doc.balance
                  ? tpl(L.payInvoice, { amount: fmtFCFA(doc.balance) })
                  : L.seeInvoice;
            return (
              <article
                key={`${doc.kind}-${doc.index}`}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {tpl(doc.kind === "quote" ? L.quote : L.invoice, { number: doc.number })}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm ${docTone(doc.status)}`}
                  >
                    <span aria-hidden>{docIcon(doc.status)}</span>
                    {statusLabel ?? doc.status}
                  </span>
                </div>
                <span className="text-sm text-muted">{fmtFCFA(doc.total)}</span>
                <button
                  type="button"
                  className={`btn min-h-12 w-full ${doc.awaitingDecision || doc.balance ? "btn-primary" : "btn-secondary"}`}
                  disabled={open.isPending}
                  onClick={() => open.mutate({ token, kind: doc.kind, index: doc.index })}
                >
                  {open.isPending &&
                  open.variables?.kind === doc.kind &&
                  open.variables.index === doc.index
                    ? L.opening
                    : action}
                </button>
              </article>
            );
          })}
        </section>
      )}

      {photos.length > 0 && current && (
        <section aria-labelledby="photos-title" className="flex min-w-0 flex-col gap-2">
          <h2 id="photos-title" className="font-semibold">
            {L.photos} ({photos.length})
          </h2>
          <figure className="flex flex-col gap-1">
            <img
              key={current.id}
              src={`/api/portail/${token}/photos/${current.id}`}
              alt={tpl(L.photoAlt, { index: photos.indexOf(current) + 1 })}
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full rounded-lg bg-surface-2 object-cover"
            />
            <figcaption className="text-sm text-muted">
              {(L.photoKinds as Record<string, string>)[current.kind] ?? ""}
              {current.caption ? ` · ${current.caption}` : ""}
            </figcaption>
          </figure>
          {photos.length > 1 && (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary min-h-12 flex-1"
                aria-label={L.previous}
                onClick={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)}
              >
                ←
              </button>
              <span className="self-center text-sm" aria-live="polite">
                {photos.indexOf(current) + 1} / {photos.length}
              </span>
              <button
                type="button"
                className="btn btn-secondary min-h-12 flex-1"
                aria-label={L.next}
                onClick={() => setPhotoIndex((i) => (i + 1) % photos.length)}
              >
                →
              </button>
            </div>
          )}
        </section>
      )}

      {d.findings.length > 0 && (
        <section aria-labelledby="findings-title" className="flex flex-col gap-2">
          <h2 id="findings-title" className="font-semibold">
            {L.findings}
          </h2>
          {d.findings.map((f) => {
            const style = RESULT_STYLE[f.result as keyof typeof RESULT_STYLE] ?? RESULT_STYLE.OK;
            return (
              <div key={f.id} className="flex flex-col gap-2 rounded-lg bg-surface p-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium ${style.className}`}
                  >
                    <span aria-hidden>{style.icon}</span>
                    {(L.results as Record<string, string>)[f.result] ?? f.result}
                  </span>
                  <span>{f.label}</span>
                  {f.measurement && <span className="text-sm text-muted">({f.measurement})</span>}
                </span>
                {f.photos.map((p) => (
                  <img
                    key={p}
                    src={`/api/portail/${token}/photos/${p}`}
                    alt={f.label}
                    loading="lazy"
                    decoding="async"
                    className="max-h-48 w-full rounded object-cover"
                  />
                ))}
              </div>
            );
          })}
        </section>
      )}

      {d.notes.length > 0 && (
        <section aria-labelledby="notes-title" className="flex flex-col gap-2">
          <h2 id="notes-title" className="font-semibold">
            {L.notes}
          </h2>
          {d.notes.map((n) => (
            <p key={n.id} className="rounded-lg bg-surface p-3">
              <span className="block text-sm text-muted">{fmtDateTime(n.at)}</span>
              {n.body}
            </p>
          ))}
        </section>
      )}

      {d.lines.length > 0 && (
        <section aria-labelledby="works-title" className="flex flex-col gap-1">
          <h2 id="works-title" className="font-semibold">
            {L.works}
          </h2>
          {d.lines.map((l) => (
            <div key={l.id} className="flex justify-between gap-2">
              <span className="min-w-0 break-words">{l.description}</span>
              <span className="shrink-0">{fmtFCFA(l.total)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-1 font-semibold">
            <span>{L.total}</span>
            <span>{fmtFCFA(d.total)}</span>
          </div>
        </section>
      )}

      {d.pendingLines.length > 0 && (
        <section className="flex flex-col gap-1 rounded-lg bg-status-warn-bg p-3 text-status-warn">
          <h2 className="font-semibold">{L.pending}</h2>
          {d.pendingLines.map((l) => (
            <div key={l.id} className="flex justify-between gap-2">
              <span className="min-w-0 break-words">{l.description}</span>
              <span className="shrink-0">{fmtFCFA(l.total)}</span>
            </div>
          ))}
          <span className="text-sm">{L.pendingHint}</span>
        </section>
      )}

      {d.garage.phone && (
        <a href={`tel:${d.garage.phone}`} className="btn btn-secondary min-h-12">
          📞 {labels.call}
        </a>
      )}
    </PortalFrame>
  );
}
