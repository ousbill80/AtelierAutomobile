"use client";

// M05 US-M05-05/06 · M14 §4.2 — page publique du devis (mobile d'abord, police ≥ 16 px) :
// groupes par priorité (badge couleur + icône + texte), explication, photos, interrupteur
// Accepter / Refuser, total accepté en direct (barre fixe), signature, motif de refus,
// question / rappel / PDF, acompte. Lecture seule si décidé, expiré ou en cours de mise à jour.
import { useMemo, useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, SignaturePad } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  fmtDateTime as formatDateTime,
  fmtDay as formatDay,
  makeT,
  type Messages,
} from "../../_components/format";
import type { PortalLabels } from "../../_components/labels";
import { linkProblemOf, PortalLinkState } from "../../_components/link-state";

type Choice = boolean | undefined;

export function QuotePortalView({
  token,
  labels,
  messages,
}: {
  token: string;
  labels: PortalLabels;
  messages: Messages;
}) {
  const t = makeT(messages);
  const query = trpc.portal.quote.get.useQuery(
    { token },
    { retry: false, refetchOnWindowFocus: false },
  );
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [step, setStep] = useState<"choose" | "sign" | "done">("choose");
  const [signerName, setSignerName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const decide = trpc.portal.quote.decide.useMutation({
    onSuccess: () => {
      setStep("done");
      void query.refetch();
    },
    onError: (e) => {
      if (e.data?.code === "CONFLICT") void query.refetch().then(() => setStep("choose"));
    },
  });
  const ask = trpc.portal.quote.ask.useMutation({ onSuccess: () => setAskOpen(false) });
  const depositLink = trpc.portal.quote.depositLink.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
  });

  const view = query.data;
  // Valeurs par défaut : urgents « Accepter », optionnels « non choisi » (US-M05-05).
  const effective = useMemo(() => {
    const out: Record<string, Choice> = {};
    for (const g of view?.groups ?? []) {
      out[g.key] = g.key in choices ? choices[g.key] : g.isOptional ? undefined : true;
    }
    // Dépendances : un groupe dont le groupe requis est refusé est désactivé.
    for (const g of view?.groups ?? []) {
      if (g.requiresGroupKey && out[g.requiresGroupKey] === false) out[g.key] = false;
    }
    return out;
  }, [choices, view]);

  if (query.isLoading) {
    return (
      <div
        className="mx-auto mt-6 h-64 w-full max-w-lg animate-pulse rounded-lg bg-surface-2"
        aria-busy="true"
      />
    );
  }
  if (query.isError || !view) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-col gap-3 p-4 text-base">
        <PortalLinkState
          problem={linkProblemOf(query.error)}
          token={token}
          labels={labels}
          onRetry={() => query.refetch()}
        />
      </main>
    );
  }

  const acceptedTotal = view.groups.reduce((s, g) => s + (effective[g.key] ? g.total : 0), 0);
  const anyAccepted = view.groups.some((g) => effective[g.key]);
  const missing = view.groups.filter((g) => !g.isOptional && effective[g.key] === undefined);
  const decided = ["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED", "CONVERTED"].includes(view.status);
  const readOnly = !view.decidable;
  const urgentCount = view.groups.filter((g) => g.priority).length;

  function submit(declineAll = false) {
    if (!view) return;
    decide.mutate({
      token,
      quoteId: view.quoteId,
      decisions: view.groups.map((g) => ({
        groupKey: g.key,
        accepted: declineAll ? false : effective[g.key] === true,
      })),
      signerName: signerName.trim() || view.customerName,
      signatureDataUrl: !declineAll && signature ? signature : undefined,
      acceptTerms: acceptTerms || undefined,
      declineReason: declineReason || undefined,
      contentHash: view.contentHash,
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-40 text-base">
      <header className="flex flex-col gap-1">
        <p className="text-lg font-semibold">{view.garage.name}</p>
        {view.garage.phone && <p className="text-sm text-muted">{view.garage.phone}</p>}
      </header>
      <section className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
        <h1 className="text-xl font-semibold">
          {t("portal.title", { number: view.number })}
          {view.version > 1 ? ` (v${view.version})` : ""}
        </h1>
        {view.vehicle && (
          <p>
            {view.vehicle.make} {view.vehicle.model} · {view.vehicle.plate}
          </p>
        )}
        <p className="text-sm text-muted">
          {t("portal.validUntil", { date: formatDay(view.validUntil, view.timeZone) })}
        </p>
        {urgentCount > 0 && (
          <p className="font-semibold">{t("portal.recommended", { count: urgentCount })}</p>
        )}
      </section>

      {view.updated && (
        <p className="rounded-md bg-status-warn-bg p-3 text-status-warn">{t("portal.updated")}</p>
      )}
      {view.pendingUpdate && (
        <p className="rounded-md bg-surface-2 p-3">{t("portal.pendingUpdate")}</p>
      )}
      {view.expired && (
        <p role="status" className="rounded-md bg-status-bad-bg p-3 text-status-bad">
          {t("portal.expired", { date: formatDay(view.validUntil, view.timeZone) })}
        </p>
      )}
      {decided && view.decidedAt && (
        <p role="status" className="rounded-md bg-status-ok-bg p-3 text-status-ok">
          ✓{" "}
          {step === "done"
            ? t("portal.thanks")
            : t("portal.decidedOn", { date: formatDateTime(view.decidedAt, view.timeZone) })}
        </p>
      )}
      {view.alreadyApproved.length > 0 && (
        <p className="text-sm text-muted">
          {t("alreadyApproved")} : {view.alreadyApproved.join(", ")}
        </p>
      )}

      {step !== "sign" &&
        view.groups.map((g) => {
          const choice = decided ? g.accepted : effective[g.key];
          const blocked = Boolean(g.requiresGroupKey && effective[g.requiresGroupKey] === false);
          return (
            <article
              key={g.key}
              className={`flex flex-col gap-2 rounded-lg border bg-surface p-3 ${g.priority === "URGENT" ? "border-status-bad" : g.priority === "WATCH" ? "border-status-warn" : "border-border"}`}
              aria-label={g.label}
            >
              <div className="flex flex-wrap items-center gap-2">
                {g.priority && (
                  <span className={`pill ${g.priority === "URGENT" ? "pill-bad" : "pill-warn"}`}>
                    {g.priority === "URGENT" ? "⚠ " : "👁 "}
                    {t(`portal.priority.${g.priority}`)}
                  </span>
                )}
                <h2 className="font-semibold">{g.label}</h2>
              </div>
              {g.explanation && <p className="text-sm">{g.explanation}</p>}
              {g.photoIds.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {g.photoIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="shrink-0"
                      onClick={() => setZoom(id)}
                      aria-label={t("portal.zoom")}
                    >
                      <img
                        src={`/api/portail/${token}/photos/${id}`}
                        alt=""
                        loading="lazy"
                        className="h-20 w-20 rounded-md object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
              {view.showLinePrices && (
                <ul className="text-sm text-muted">
                  {g.lines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                      <span>{l.description}</span>
                      <span>
                        {l.payer === "WARRANTY" || l.payer === "INTERNAL"
                          ? t("lines.coveredByGarage")
                          : formatFCFA(l.total ?? 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{formatFCFA(g.total)} TTC</span>
                {readOnly ? (
                  <span className={choice ? "text-status-ok" : "text-status-bad"}>
                    {choice === true
                      ? `✓ ${t("portal.accepted")}`
                      : choice === false
                        ? `✕ ${t("portal.declined")}`
                        : ""}
                  </span>
                ) : (
                  <span className="flex gap-2" role="radiogroup" aria-label={g.label}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={choice === true}
                      disabled={blocked}
                      className={`min-h-11 rounded-md border px-3 ${choice === true ? "border-status-ok bg-status-ok-bg text-status-ok" : "border-border"}`}
                      onClick={() => setChoices((c) => ({ ...c, [g.key]: true }))}
                    >
                      ✓ {t("portal.accept")}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={choice === false}
                      className={`min-h-11 rounded-md border px-3 ${choice === false ? "border-status-bad bg-status-bad-bg text-status-bad" : "border-border"}`}
                      onClick={() => setChoices((c) => ({ ...c, [g.key]: false }))}
                    >
                      ✕ {t("portal.decline")}
                    </button>
                  </span>
                )}
              </div>
              {blocked && g.requiresLabel && (
                <p className="text-sm text-muted">
                  {t("portal.requires", { label: g.requiresLabel })}
                </p>
              )}
            </article>
          );
        })}

      {step === "sign" && (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
          <h2 className="font-semibold">{t("portal.signTitle")}</h2>
          <p>{t("portal.signSummary", { amount: formatFCFA(acceptedTotal) })}</p>
          <label className="flex flex-col gap-1">
            {t("portal.yourName")}
            <input
              className="input"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder={view.customerName}
            />
          </label>
          {anyAccepted &&
            (view.requireSignature ? (
              <SignaturePad
                label={t("portal.signHere")}
                clearLabel={t("decision.clear")}
                onChange={setSignature}
              />
            ) : (
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                />
                {t("portal.iAccept", { amount: formatFCFA(acceptedTotal) })}
              </label>
            ))}
          {view.groups.some((g) => effective[g.key] === false) && (
            <label className="flex flex-col gap-1">
              {t("portal.declineReason")}
              <select
                className="select min-h-11"
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
              >
                <option value="">—</option>
                {["too_expensive", "later", "elsewhere", "other"].map((r) => (
                  <option key={r} value={r}>
                    {t(`declineReasons.${r}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {decide.error && (
            <p role="alert" className="text-status-bad">
              ⚠ {decide.error.message.replace(/^[A-Z_]+ : /, "")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setStep("choose")}>
              ← {t("portal.back")}
            </Button>
            <Button
              loading={decide.isPending}
              disabled={anyAccepted && (view.requireSignature ? !signature : !acceptTerms)}
              onClick={() => submit()}
            >
              {t("portal.confirm")}
            </Button>
          </div>
        </section>
      )}

      {step === "done" && view.depositAmount && !view.depositPayable && !view.depositPaid ? (
        <p className="rounded-md bg-surface-2 p-3">
          {t("portal.deposit", { amount: formatFCFA(view.depositAmount) })}
        </p>
      ) : null}
      {view.depositAmount && view.depositPayable ? (
        <section className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
          <p>{t("portal.deposit", { amount: formatFCFA(view.depositAmount) })}</p>
          <Button loading={depositLink.isPending} onClick={() => depositLink.mutate({ token })}>
            {t("portal.payDeposit", { amount: formatFCFA(view.depositAmount) })}
          </Button>
          {depositLink.error && (
            <p role="alert" className="text-status-bad">
              ⚠ {depositLink.error.message}
            </p>
          )}
        </section>
      ) : null}
      {view.depositAmount && view.depositPaid ? (
        <p role="status" className="rounded-md bg-surface-2 p-3 text-status-ok">
          ✓ {t("portal.depositPaid", { amount: formatFCFA(view.depositAmount) })}
        </p>
      ) : null}

      {view.termsText && <p className="text-xs text-muted">{view.termsText}</p>}

      <section className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setAskOpen((o) => !o)}>
          {t("portal.ask")}
        </Button>
        <Button
          variant="secondary"
          loading={ask.isPending}
          onClick={() => ask.mutate({ token, callback: true })}
        >
          {t("portal.callback")}
        </Button>
        {view.expired && (
          <Button variant="secondary" onClick={() => ask.mutate({ token, refresh: true })}>
            {t("portal.requestRefresh")}
          </Button>
        )}
        <a
          className="btn btn-secondary min-h-11"
          href={`/api/portail/${token}/devis/pdf`}
          target="_blank"
          rel="noreferrer"
        >
          {t("portal.pdf")}
        </a>
      </section>
      {ask.isSuccess && (
        <p role="status" className="text-status-ok">
          ✓ {t("portal.askSent")}
        </p>
      )}
      {askOpen && (
        <section className="flex flex-col gap-2">
          <textarea
            className="textarea"
            aria-label={t("portal.question")}
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button
            disabled={!question.trim()}
            loading={ask.isPending}
            onClick={() => ask.mutate({ token, message: question })}
          >
            {t("portal.sendQuestion")}
          </Button>
        </section>
      )}

      {!readOnly && step === "choose" && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface p-3 shadow-lg">
          <div className="mx-auto flex max-w-lg flex-col gap-2">
            <p className="flex justify-between font-semibold" data-testid="portal-accepted-total">
              <span>{t("portal.acceptedTotal")}</span>
              <span>{formatFCFA(acceptedTotal)} TTC</span>
            </p>
            {missing.length > 0 && (
              <p className="text-sm text-status-warn">{t("portal.chooseAll")}</p>
            )}
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={missing.length > 0 || !anyAccepted}
                onClick={() => setStep("sign")}
              >
                {t("portal.validate")}
              </Button>
              {!anyAccepted && (
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={missing.length > 0}
                  onClick={() => setStep("sign")}
                >
                  {t("portal.declineAll")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {zoom && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoom(null)}
          aria-label={t("portal.closeZoom")}
        >
          <img
            src={`/api/portail/${token}/photos/${zoom}`}
            alt=""
            className="max-h-full max-w-full rounded-md"
          />
        </button>
      )}
    </main>
  );
}
