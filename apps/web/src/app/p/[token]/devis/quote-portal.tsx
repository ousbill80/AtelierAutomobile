"use client";

// M05 US-M05-05/06 + M14 §4.2 — page publique du devis, mobile d'abord : en-tête garage,
// véhicule, groupes par priorité (badge couleur + icône + texte), explication, photos, prix,
// interrupteur Accepter/Refuser, barre fixe « Total accepté », signature, motif de refus,
// question / rappel / PDF. Police ≥ 16 px, cibles ≥ 44 px, aucune donnée interne.
import { useMemo, useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, SignaturePad, StatusBadge, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { formatDay, PRIORITY_TONE, t } from "@/components/quotes/i18n";
import type { PortalQuote } from "@/components/quotes/types";

const REASONS = ["TOO_EXPENSIVE", "LATER", "ELSEWHERE", "OTHER"] as const;
type Reason = (typeof REASONS)[number];

export function QuotePortal({ token }: { token: string }) {
  const query = trpc.portal.quote.get.useQuery({ token }, { retry: false });
  if (query.isLoading) return <div className="mx-auto h-64 w-full max-w-lg animate-pulse rounded-lg bg-surface-2" />;
  if (query.isError || !query.data) {
    const code = (query.error?.data as { code?: string } | undefined)?.code;
    const message = query.error?.message ?? "";
    return (
      <main className="mx-auto flex w-full max-w-lg flex-col gap-3 p-4 text-base">
        <p role="alert" className="rounded-md bg-status-bad-bg p-4 text-status-bad">
          {message.includes("mis à jour") ? t("portal.superseded") : message.includes("expiré") ? t("portal.expired") : t("portal.invalid")}
          {code ? "" : ""}
        </p>
      </main>
    );
  }
  return <PortalBody token={token} data={query.data} refetch={() => void query.refetch()} />;
}

function PortalBody({ token, data: d, refetch }: { token: string; data: PortalQuote; refetch: () => void }) {
  const [choices, setChoices] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(d.groups.map((g) => [g.key, g.accepted ?? (!g.isOptional && g.priority === "URGENT")])),
  );
  const [step, setStep] = useState<"choose" | "sign" | "decline" | "done">(d.state === "DECIDED" ? "done" : "choose");
  const [name, setName] = useState(d.customerName);
  const [signature, setSignature] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState<Reason>("LATER");
  const [comment, setComment] = useState("");
  const [question, setQuestion] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [result, setResult] = useState<{ status: string; acceptedTotal: number; deposit: number | null } | null>(null);

  const decide = trpc.portal.quote.decide.useMutation({
    onSuccess: (r) => {
      setResult(r);
      setStep("done");
      refetch();
    },
  });
  const ask = trpc.portal.quote.ask.useMutation();

  const parentDeclined = (g: PortalQuote["groups"][number]) => Boolean(g.requiresGroupKey && choices[g.requiresGroupKey] === false);
  const acceptedTotal = useMemo(
    () => d.groups.filter((g) => choices[g.key] && !parentDeclined(g)).reduce((s, g) => s + g.total, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [choices, d.groups],
  );
  const anyAccepted = acceptedTotal > 0 || d.groups.some((g) => choices[g.key] && !parentDeclined(g));
  const readOnly = d.state !== "OPEN";
  const decisions = d.groups.map((g) => ({ groupKey: g.key, accepted: Boolean(choices[g.key]) && !parentDeclined(g) }));

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-32 text-base">
      <header className="flex flex-col gap-1">
        <span className="text-sm text-muted">
          {d.garage.name}
          {d.garage.siteName ? ` · ${d.garage.siteName}` : ""}
        </span>
        <h1 className="text-xl font-semibold">{t("portal.title")}</h1>
        <span>{t("portal.number", { number: d.number })}</span>
        {d.vehicle && (
          <span className="font-medium">
            {d.vehicle.make} {d.vehicle.model}
            {d.vehicle.year ? ` (${d.vehicle.year})` : ""} · {d.vehicle.plate}
          </span>
        )}
        <span className="text-sm text-muted">{t("portal.validUntil", { date: formatDay(d.validUntil) })}</span>
      </header>

      {d.state === "EXPIRED" && <p className="rounded-md bg-status-warn-bg p-3 text-status-warn">{t("portal.expired")}</p>}
      {d.state === "SUPERSEDED" && <p className="rounded-md bg-surface-2 p-3">{t("portal.superseded")}</p>}
      {d.state === "CONVERTED" && <p className="rounded-md bg-status-ok-bg p-3 text-status-ok">{t("portal.converted")}</p>}
      {d.state === "DECIDED" && !result && (
        <p className="rounded-md bg-status-ok-bg p-3 text-status-ok">
          {t("portal.decided", { date: formatDay(d.decidedAt) })}
          {d.acceptedTotal > 0 ? ` ${t("portal.acceptedTotal", { amount: formatFCFA(d.acceptedTotal) })}` : ""}
        </p>
      )}

      {step === "done" && result && (
        <section className="flex flex-col gap-2 rounded-md bg-status-ok-bg p-4 text-status-ok" role="status">
          <p className="font-semibold">{result.status === "DECLINED" ? t("portal.thanksDeclined") : t("portal.thanks")}</p>
          {result.acceptedTotal > 0 && <p>{t("portal.acceptedTotal", { amount: formatFCFA(result.acceptedTotal) })}</p>}
          {result.deposit ? (
            <p>
              {t("portal.deposit", { amount: formatFCFA(result.deposit) })} — {t("portal.depositHint")}
            </p>
          ) : null}
        </section>
      )}

      <p className="text-sm text-muted">{t("portal.summary", { count: d.groups.length })}</p>
      <ul className="flex flex-col gap-3" aria-label={t("portal.title")}>
        {d.groups.map((g) => {
          const disabled = readOnly || step !== "choose" || parentDeclined(g);
          const chosen = Boolean(choices[g.key]) && !parentDeclined(g);
          const priorityKey = g.priority ?? "NONE";
          return (
            <li key={g.key} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={PRIORITY_TONE[priorityKey] ?? "off"} label={t(`priority.${priorityKey}`)} />
                  <span className="font-semibold">{g.label}</span>
                  {g.isOptional && <span className="text-sm text-muted">({t("portal.optional")})</span>}
                </span>
                <span className="font-semibold">{formatFCFA(g.total)}</span>
              </div>
              {g.explanation && <p className="text-sm">{g.explanation}</p>}
              {d.showLinePrices && (
                <ul className="flex flex-col gap-1 text-sm text-muted">
                  {g.lines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                      <span>
                        {l.description}
                        {l.quantity !== 1 ? ` × ${l.quantity.toLocaleString("fr-FR")}` : ""}
                      </span>
                      <span>{l.payer === "WARRANTY" ? t("portal.warranty") : l.total != null ? formatFCFA(l.total) : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
              {g.photos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {g.photos.map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} src={src} alt={g.label} loading="lazy" className="h-28 w-40 flex-none rounded object-cover" />
                  ))}
                </div>
              )}
              {parentDeclined(g) && (
                <p className="text-sm text-status-warn">{t("portal.requires", { label: d.groups.find((x) => x.key === g.requiresGroupKey)?.label ?? "" })}</p>
              )}
              {readOnly || step === "done" ? (
                g.accepted != null && (
                  <span className={g.accepted ? "text-status-ok" : "text-status-bad"}>
                    {g.accepted ? `✓ ${t("portal.chosen")}` : `✗ ${t("portal.notChosen")}`}
                  </span>
                )
              ) : (
                <div className="flex gap-2" role="group" aria-label={g.label}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    disabled={disabled}
                    onClick={() => setChoices((c) => ({ ...c, [g.key]: true }))}
                    className={`min-h-11 flex-1 rounded-md border px-3 text-base ${chosen ? "border-status-ok bg-status-ok-bg font-semibold text-status-ok" : "border-border"}`}
                  >
                    ✓ {t("portal.chosen")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={!chosen}
                    disabled={disabled}
                    onClick={() => setChoices((c) => ({ ...c, [g.key]: false }))}
                    className={`min-h-11 flex-1 rounded-md border px-3 text-base ${!chosen ? "border-status-bad bg-status-bad-bg font-semibold text-status-bad" : "border-border"}`}
                  >
                    ✗ {t("portal.notChosen")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {d.insuranceShare > 0 && <p className="text-sm">{t("portal.insurance", { amount: formatFCFA(d.insuranceShare) })}</p>}

      {step === "sign" && (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
          <Input label={t("portal.signerName")} value={name} onChange={(e) => setName(e.target.value)} />
          {d.requireSignature ? (
            <SignaturePad label={t("portal.signature")} clearLabel={t("portal.clearSignature")} onChange={setSignature} />
          ) : (
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              {t("portal.iAccept", { amount: formatFCFA(acceptedTotal) })}
            </label>
          )}
          {decide.error && (
            <p role="alert" className="text-status-bad">
              ⚠ {decide.error.message.includes("mis à jour") ? t("portal.changed") : decide.error.message}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="min-h-11" onClick={() => setStep("choose")}>
              {t("portal.back")}
            </Button>
            <Button
              className="min-h-11 flex-1"
              loading={decide.isPending}
              disabled={name.trim().length < 2 || (d.requireSignature ? !signature : !agree)}
              onClick={() =>
                decide.mutate({
                  token,
                  decisions,
                  signerName: name.trim(),
                  signatureDataUrl: signature ?? undefined,
                  declineReason: decisions.some((x) => !x.accepted) ? reason : undefined,
                  contentHash: d.contentHash,
                })
              }
            >
              {t("portal.confirm")}
            </Button>
          </div>
        </section>
      )}

      {step === "decline" && (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
          <span className="font-semibold">{t("portal.declineReason")}</span>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("portal.declineReason")}>
            {REASONS.map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-2">
                <input type="radio" name="reason" className="h-5 w-5" checked={reason === r} onChange={() => setReason(r)} />
                {t(`portal.reasons.${r}`)}
              </label>
            ))}
          </div>
          <Textarea rows={2} placeholder={t("portal.declineComment")} value={comment} onChange={(e) => setComment(e.target.value)} />
          <Input label={t("portal.signerName")} value={name} onChange={(e) => setName(e.target.value)} />
          {decide.error && (
            <p role="alert" className="text-status-bad">
              ⚠ {decide.error.message}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="min-h-11" onClick={() => setStep("choose")}>
              {t("portal.back")}
            </Button>
            <Button
              variant="danger"
              className="min-h-11 flex-1"
              loading={decide.isPending}
              disabled={name.trim().length < 2}
              onClick={() =>
                decide.mutate({
                  token,
                  decisions: [],
                  accepted: false,
                  signerName: name.trim(),
                  declineReason: reason,
                  declineComment: comment.trim() || undefined,
                  contentHash: d.contentHash,
                })
              }
            >
              {t("portal.declineAll")}
            </Button>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        {askOpen ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <Textarea rows={3} placeholder={t("portal.askPlaceholder")} value={question} onChange={(e) => setQuestion(e.target.value)} />
            {ask.isSuccess && <p className="text-status-ok">✓ {ask.variables?.callback ? t("portal.callbackSent") : t("portal.askSent")}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" className="min-h-11" loading={ask.isPending} disabled={question.trim().length < 2} onClick={() => ask.mutate({ token, message: question.trim() })}>
                {t("portal.askSend")}
              </Button>
              <Button variant="ghost" className="min-h-11" onClick={() => setAskOpen(false)}>
                {t("close")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="min-h-11" onClick={() => setAskOpen(true)}>
              💬 {t("portal.ask")}
            </Button>
            <Button variant="secondary" className="min-h-11" loading={ask.isPending} onClick={() => ask.mutate({ token, callback: true })}>
              📞 {t("portal.callback")}
            </Button>
            <a href={`/api/portail/${token}/devis/pdf`} className="btn btn-secondary min-h-11" target="_blank" rel="noopener">
              ⬇ {t("portal.pdf")}
            </a>
            {d.garage.whatsapp && (
              <a href={`https://wa.me/${d.garage.whatsapp.replace(/\D/g, "")}`} className="btn btn-secondary min-h-11" target="_blank" rel="noopener">
                {t("portal.whatsapp")}
              </a>
            )}
            {d.garage.phone && (
              <a href={`tel:${d.garage.phone}`} className="btn btn-secondary min-h-11">
                {t("portal.call")}
              </a>
            )}
          </div>
        )}
        {ask.isSuccess && !askOpen && <p className="text-status-ok">✓ {ask.variables?.callback ? t("portal.callbackSent") : t("portal.askSent")}</p>}
      </section>

      <p className="text-xs text-muted">
        {t("portal.terms")} : {d.terms}
      </p>

      {!readOnly && step === "choose" && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface p-3">
          <div className="mx-auto flex w-full max-w-lg flex-col gap-2">
            <span className="font-semibold" data-testid="portal-accepted-total">
              {t("portal.acceptedTotal", { amount: formatFCFA(acceptedTotal) })}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" className="min-h-11" onClick={() => setStep("decline")}>
                {t("portal.declineAll")}
              </Button>
              <Button className="min-h-11 flex-1" disabled={!anyAccepted} onClick={() => setStep("sign")}>
                {t("portal.validate")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
