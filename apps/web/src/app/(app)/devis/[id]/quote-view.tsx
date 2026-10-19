"use client";

// M05 §7 — fiche devis : en-tête (n°, version, statut, client, véhicule, OR, validité),
// bandeaux d'état, actions (envoyer, décision, version, convertir, lien, PDF, supprimer),
// éditeur de lignes (brouillon) ou lecture (envoyé/décidé), pied (remise globale, totaux,
// part assurance, marge, acompte), frise, versions, messages.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, Input, MoneyInput, Select, Textarea } from "@atelieros/ui";
import type { QuoteLineInput } from "@atelieros/validators";
import { trpc } from "@/trpc/react";
import { DiscountApprovalBadge, PriorityBadge, QuoteStatusBadge } from "@/components/quotes/badges";
import { DecisionModal } from "@/components/quotes/decision-modal";
import { ErrorBox, ListSkeleton } from "@/components/quotes/error-box";
import { formatDateTime, formatDay, t, toDateInput } from "@/components/quotes/i18n";
import { CatalogSearch, LineRow } from "@/components/quotes/line-editor";
import { SendModal } from "@/components/quotes/send-modal";
import type { QuoteDetail } from "@/components/quotes/types";

const DISCOUNT_REASONS = ["LOYAL_CUSTOMER", "FLEET", "COMMERCIAL_GESTURE", "COMPETITION", "OTHER"] as const;

export function QuoteView({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const router = useRouter();
  const me = trpc.me.get.useQuery();
  const query = trpc.quote.get.useQuery({ id });
  const [flash, setFlash] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState<string | null>(null);

  const refresh = () => {
    void utils.quote.get.invalidate({ id });
    void utils.quote.list.invalidate();
  };
  const onError = (e: { message: string }) => setFlash({ tone: "bad", text: e.message });
  const onDone = (text?: string) => {
    setFlash(text ? { tone: "ok", text } : null);
    refresh();
  };

  const addLine = trpc.quoteLine.add.useMutation({ onSuccess: () => onDone(), onError });
  const updateLine = trpc.quoteLine.update.useMutation({ onSuccess: () => onDone(t("saved")), onError });
  const removeLine = trpc.quoteLine.remove.useMutation({ onSuccess: () => onDone(), onError });
  const addKit = trpc.quote.addKit.useMutation({ onSuccess: () => onDone(), onError });
  const update = trpc.quote.update.useMutation({ onSuccess: () => onDone(t("saved")), onError });
  const requestApproval = trpc.quote.requestDiscountApproval.useMutation({ onSuccess: () => onDone(t("saved")), onError });
  const decideDiscount = trpc.quote.decideDiscount.useMutation({ onSuccess: () => onDone(t("saved")), onError });
  const createVersion = trpc.quote.createVersion.useMutation({
    onSuccess: (r) => {
      setFlash({
        tone: "ok",
        text:
          t("detail.versionCreated", { version: r.quote.version }) +
          (r.priceChanges.length ? ` ${t("detail.priceChanges", { count: r.priceChanges.length })}` : ""),
      });
      router.push(`/devis/${r.quote.id}`);
    },
    onError,
  });
  const convertOrder = trpc.quote.convertToRepairOrder.useMutation({
    onSuccess: (r) => {
      onDone(t("detail.orderCreated", { number: r.number }));
      router.push(`/ordres/${r.repairOrderId}`);
    },
    onError,
  });
  const convertInvoice = trpc.quote.convertToInvoice.useMutation({ onSuccess: () => onDone(t("detail.invoiceCreated")), onError });
  const requestDeposit = trpc.quote.requestDeposit.useMutation({ onSuccess: () => onDone(t("detail.depositInvoice")), onError });
  const regenerate = trpc.quote.regenerateLink.useMutation({
    onSuccess: (r) => {
      void navigator.clipboard?.writeText(r.publicUrl);
      onDone(t("copied"));
    },
    onError,
  });
  const resend = trpc.quote.resend.useMutation({ onSuccess: () => onDone(t("send.sent")), onError });
  const remove = trpc.quote.delete.useMutation({
    onSuccess: () => {
      setFlash({ tone: "ok", text: t("detail.deleted") });
      router.push("/devis");
    },
    onError,
  });

  if (query.isLoading) return <ListSkeleton rows={4} />;
  if (query.isError || !query.data) {
    return <ErrorBox message={query.error?.data?.code === "NOT_FOUND" ? t("notFound") : undefined} onRetry={() => query.refetch()} />;
  }
  const quote = query.data;
  const perms = new Set(me.data?.permissions ?? []);
  const editable = quote.status === "DRAFT" && perms.has("quote:update");
  const busy = addLine.isPending || updateLine.isPending || removeLine.isPending || addKit.isPending || update.isPending;
  const canDecide = perms.has("quote:record_decision") && ["DRAFT", "SENT", "VIEWED", "PARTIALLY_ACCEPTED", "DECLINED"].includes(quote.status) && !quote.supersededAt;
  const canSend = perms.has("quote:send") && quote.status === "DRAFT" && quote.lines.length > 0 && quote.discountApprovalStatus !== "PENDING";
  const pending = quote.status === "SENT" || quote.status === "VIEWED";
  const accepted = quote.status === "ACCEPTED" || quote.status === "PARTIALLY_ACCEPTED";

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-24">
      <Link href="/devis" className="text-sm text-accent">
        ← {t("back")}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            <span className="font-mono">{quote.number}</span>
            {quote.version > 1 && <span className="text-base text-muted">{t("card.version", { version: quote.version })}</span>}
            <QuoteStatusBadge status={quote.status} />
            <DiscountApprovalBadge status={quote.discountApprovalStatus} />
          </h1>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            <Link href={`/clients/${quote.customer.id}`} className="hover:underline">
              {quote.customer.displayName}
            </Link>
            {quote.vehicle && (
              <span>
                {quote.vehicle.make} {quote.vehicle.model} · {quote.vehicle.plate}
              </span>
            )}
            {quote.repairOrder && (
              <Link href={`/ordres/${quote.repairOrder.id}`} className="hover:underline">
                {quote.repairOrder.number}
              </Link>
            )}
            <span>{t(`origin.${quote.origin}`)}</span>
            <span>
              {t("form.validUntil")} {formatDay(quote.validUntil)}
            </span>
            {quote.createdBy && <span>{quote.createdBy.user.name}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold" data-testid="quote-total">
            {formatFCFA(quote.total)}
          </div>
          {quote.acceptedTotal > 0 && (
            <div className="text-sm text-status-ok" data-testid="quote-accepted-total">
              {t("editor.acceptedTotal")} : {formatFCFA(quote.acceptedTotal)}
            </div>
          )}
        </div>
      </header>

      {flash && (
        <p role={flash.tone === "bad" ? "alert" : "status"} className={`rounded-md p-2 text-sm ${flash.tone === "bad" ? "bg-status-bad-bg text-status-bad" : "bg-status-ok-bg text-status-ok"}`}>
          {flash.text}
        </p>
      )}
      {quote.supersededAt && (
        <p className="rounded-md bg-surface-2 p-2 text-sm">
          {t("detail.supersededBanner", { version: quote.version + 1 })}{" "}
          {quote.supersededById && (
            <Link href={`/devis/${quote.supersededById}`} className="text-accent underline">
              →
            </Link>
          )}
        </p>
      )}
      {quote.isExpired && pending && (
        <p className="rounded-md bg-status-warn-bg p-2 text-sm text-status-warn">
          {t("detail.expiredBanner", { date: formatDay(quote.validUntil) })}
        </p>
      )}
      {quote.status === "CONVERTED" && quote.convertedAt && (
        <p className="rounded-md bg-status-ok-bg p-2 text-sm text-status-ok">
          {t("detail.convertedBanner", { date: formatDay(quote.convertedAt) })}
        </p>
      )}
      {quote.discountApprovalStatus === "PENDING" && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-status-warn-bg p-2 text-sm text-status-warn">
          <span>{t("editor.approvalPending")}</span>
          {perms.has("quote:discount_override") && (
            <>
              <Button size="sm" className="min-h-11" loading={decideDiscount.isPending} onClick={() => decideDiscount.mutate({ id, decision: "APPROVE" })}>
                {t("editor.approve")}
              </Button>
              <Button size="sm" variant="secondary" className="min-h-11" onClick={() => decideDiscount.mutate({ id, decision: "APPROVE_PARTIAL", maxRate: quote.myDiscountCap.line })}>
                {t("editor.approveAt", { rate: quote.myDiscountCap.line })}
              </Button>
              <Button size="sm" variant="danger" className="min-h-11" onClick={() => decideDiscount.mutate({ id, decision: "REJECT" })}>
                {t("editor.reject")}
              </Button>
            </>
          )}
        </div>
      )}
      {quote.discountApprovalStatus === "REJECTED" && (
        <p className="rounded-md bg-status-bad-bg p-2 text-sm text-status-bad">{t("editor.approvalRejected")}</p>
      )}

      {/* Barre d'actions */}
      <div className="flex flex-wrap gap-2">
        {canSend && (
          <Button className="min-h-11" onClick={() => setSendOpen(true)}>
            {t("actions.send")}
          </Button>
        )}
        {pending && perms.has("quote:send") && (
          <Button variant="secondary" className="min-h-11" loading={resend.isPending} onClick={() => resend.mutate({ id })}>
            {t("actions.resend")}
          </Button>
        )}
        {canDecide && (
          <Button variant={canSend ? "secondary" : "primary"} className="min-h-11" onClick={() => setDecisionOpen(true)}>
            {t("actions.recordDecision")}
          </Button>
        )}
        {perms.has("quote:update") && !quote.supersededAt && ["SENT", "VIEWED", "EXPIRED", "PARTIALLY_ACCEPTED", "DECLINED"].includes(quote.status) && (
          <Button variant="secondary" className="min-h-11" loading={createVersion.isPending} onClick={() => createVersion.mutate({ id })}>
            {quote.status === "EXPIRED" ? t("actions.reactivate") : t("actions.newVersion")}
          </Button>
        )}
        {accepted && !quote.repairOrderId && quote.vehicleId && perms.has("repair_order:create") && (
          <Button variant="secondary" className="min-h-11" loading={convertOrder.isPending} onClick={() => convertOrder.mutate({ id })}>
            {t("actions.convertOrder")}
          </Button>
        )}
        {accepted && perms.has("invoice:create") && (
          <Button variant="secondary" className="min-h-11" loading={convertInvoice.isPending} onClick={() => convertInvoice.mutate({ id })}>
            {t("actions.convertInvoice")}
          </Button>
        )}
        {(accepted || quote.status === "CONVERTED") && !quote.depositInvoiceId && perms.has("invoice:create") && (
          <Button variant="secondary" className="min-h-11" loading={requestDeposit.isPending} onClick={() => requestDeposit.mutate({ id })}>
            {t("actions.requestDeposit")}
          </Button>
        )}
        {quote.status !== "DRAFT" && perms.has("quote:send") && (
          <Button variant="secondary" className="min-h-11" loading={regenerate.isPending} onClick={() => regenerate.mutate({ id })}>
            {t("actions.regenerateLink")}
          </Button>
        )}
        <a href={`/api/devis/${quote.id}/pdf`} target="_blank" rel="noopener" className="btn btn-secondary min-h-11">
          {t("actions.pdf")}
        </a>
        {quote.insuranceClaimId && (
          <a href={`/api/devis/${quote.id}/pdf?variant=insurer`} target="_blank" rel="noopener" className="btn btn-secondary min-h-11">
            {t("actions.pdfInsurer")}
          </a>
        )}
        {quote.status === "DRAFT" && !quote.sentAt && perms.has("quote:delete") && (
          <Button variant="danger" className="min-h-11" onClick={() => setDeleteReason("")}>
            {t("actions.delete")}
          </Button>
        )}
      </div>
      {deleteReason !== null && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border border-status-bad p-3"
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate({ id, reason: deleteReason });
          }}
        >
          <Input label={t("actions.deleteReason")} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} required />
          <Button type="submit" variant="danger" className="min-h-11" loading={remove.isPending}>
            {t("confirm")}
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setDeleteReason(null)}>
            {t("cancel")}
          </Button>
        </form>
      )}

      {/* Lignes */}
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t("editor.lines")}</h2>
        {editable ? (
          <CatalogSearch
            quote={quote}
            busy={busy}
            onAdd={(line: QuoteLineInput) => addLine.mutate({ quoteId: id, ...line })}
            onAddKit={(laborOperationId) => addKit.mutate({ quoteId: id, laborOperationId })}
          />
        ) : (
          <p className="text-xs text-muted">{t("editor.lockedHint")}</p>
        )}
        {quote.lines.length === 0 && <EmptyState title={t("editor.noResult")} />}
        {quote.groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-2">
            {group.lineIds.length > 1 || group.label !== quote.lines.find((l) => l.id === group.lineIds[0])?.description ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <PriorityBadge priority={group.priority} />
                <span className="font-semibold">{group.label}</span>
                <span className="text-muted">{formatFCFA(group.total)}</span>
                {group.accepted === true && <span className="text-status-ok">✓ {t("detail.accepted")}</span>}
                {group.accepted === false && <span className="text-status-bad">✗ {t("detail.declined")}</span>}
              </div>
            ) : null}
            {group.lineIds.map((lineId) => {
              const line = quote.lines.find((l) => l.id === lineId)!;
              return (
                <LineRow
                  key={line.id}
                  line={line}
                  editable={editable}
                  canViewCost={perms.has("product:view_cost")}
                  myCap={quote.myDiscountCap}
                  busy={busy}
                  onUpdate={(patch) => updateLine.mutate({ id: line.id, patch })}
                  onRemove={() => removeLine.mutate({ id: line.id })}
                />
              );
            })}
          </div>
        ))}
      </section>

      {/* Pied : remise globale, totaux */}
      <Footer quote={quote} editable={editable} perms={perms} busy={busy} onUpdate={(patch) => update.mutate({ id, patch })} onRequestApproval={(reason) => requestApproval.mutate({ id, reason })} />

      {/* Suivi */}
      <section className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <h2 className="font-semibold">{t("detail.timeline")}</h2>
          <ol className="flex flex-col gap-1">
            {quote.timeline.map((step) => (
              <li key={step.key} className="flex justify-between gap-2">
                <span>{step.label}</span>
                <span className="text-muted">{formatDateTime(step.at)}</span>
              </li>
            ))}
          </ol>
          {quote.decidedAt && (
            <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted">
              <span>{t("detail.decidedBy", { channel: quote.decisionChannel ?? "—", name: quote.signerName ?? quote.decisionCounterpart ?? "—" })}</span>
              {quote.recordedBy && <span>{t("detail.recordedBy", { name: quote.recordedBy.user.name })}</span>}
              {quote.decisionHash && <span className="font-mono">{t("detail.hash", { hash: quote.decisionHash.slice(0, 12) + "…" })}</span>}
              {quote.signatureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={quote.signatureUrl} alt={t("detail.signature")} className="h-16 w-40 rounded border border-border bg-white object-contain" />
              )}
              {quote.depositAmount != null && quote.depositAmount > 0 && <span>{t("detail.deposit", { amount: formatFCFA(quote.depositAmount) })}</span>}
            </div>
          )}
          <div className="mt-2 border-t border-border pt-2 text-xs text-muted">
            <span className="font-semibold">{t("detail.link")} : </span>
            {quote.link
              ? quote.link.status === "REVOKED"
                ? t("detail.linkRevoked")
                : quote.link.openCount > 0
                  ? t("detail.linkOpened", { count: quote.link.openCount, date: formatDateTime(quote.link.lastOpenedAt) })
                  : t("detail.linkNeverOpened")
              : t("none")}
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <h2 className="font-semibold">{t("detail.versions")}</h2>
          <ul className="flex flex-col gap-1">
            {quote.versions.map((v) => (
              <li key={v.id} className="flex justify-between gap-2">
                <Link href={`/devis/${v.id}`} className={v.id === quote.id ? "font-semibold" : "hover:underline"}>
                  v{v.version} · {t(`status.${v.status}`)}
                </Link>
                <span className="text-muted">
                  {formatFCFA(v.total)} · {formatDay(v.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          <h2 className="mt-2 font-semibold">{t("detail.messages")}</h2>
          <ul className="flex flex-col gap-1 text-xs">
            {quote.messages.length === 0 && <li className="text-muted">{t("none")}</li>}
            {quote.messages.slice(0, 8).map((m) => (
              <li key={m.id} className="flex flex-col rounded bg-surface-2 p-2">
                <span className="text-muted">
                  {m.direction === "INBOUND" ? "←" : "→"} {m.channel} · {m.status} · {formatDateTime(m.createdAt)}
                </span>
                <span className="line-clamp-2">{m.body}</span>
              </li>
            ))}
          </ul>
          {quote.insurance && (
            <div className="mt-2 border-t border-border pt-2 text-xs">
              <span className="font-semibold">{t("detail.insurance")} : </span>
              {quote.insurance.insuranceCompany.name} · {t("editor.deductible")} {formatFCFA(quote.insurance.deductible)}
              {quote.insurance.gap.gap > 0 && (
                <p className="text-status-warn">
                  {t("detail.insuranceGap", { approved: formatFCFA(quote.insurance.approvedAmount ?? 0), share: formatFCFA(quote.insuranceShare), gap: formatFCFA(quote.insurance.gap.gap) })}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <SendModal quote={quote} open={sendOpen} onClose={() => setSendOpen(false)} onDone={(text) => onDone(text)} onError={onError} />
      {decisionOpen && (
        <DecisionModal quote={quote} open={decisionOpen} onClose={() => setDecisionOpen(false)} onDone={(text) => onDone(text)} onError={onError} />
      )}
    </div>
  );
}

function Footer({
  quote,
  editable,
  perms,
  busy,
  onUpdate,
  onRequestApproval,
}: {
  quote: QuoteDetail;
  editable: boolean;
  perms: Set<string>;
  busy: boolean;
  onUpdate: (patch: { globalDiscountRate?: number | null; globalDiscountAmount?: number | null; discountReason?: string | null; validUntil?: string; notes?: string | null; customerPoNumber?: string | null }) => void;
  onRequestApproval: (reason: string) => void;
}) {
  const [mode, setMode] = useState<"rate" | "amount">(quote.globalDiscountAmount ? "amount" : "rate");
  const [rate, setRate] = useState(String(quote.globalDiscountRate ?? 0));
  const [amount, setAmount] = useState<number | null>(quote.globalDiscountAmount ?? null);
  const [reason, setReason] = useState(quote.discountReason ?? "");
  const [validUntil, setValidUntil] = useState(toDateInput(quote.validUntil));
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [po, setPo] = useState(quote.customerPoNumber ?? "");
  const overCap = mode === "rate" && Number(rate) > quote.myDiscountCap.global;
  return (
    <section className="grid gap-3 rounded-lg border border-border bg-surface p-3 text-sm md:grid-cols-2">
      <div className="flex flex-col gap-2">
        {editable ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onUpdate({
                globalDiscountRate: mode === "rate" ? Number(rate) || 0 : null,
                globalDiscountAmount: mode === "amount" ? (amount ?? 0) : null,
                discountReason: reason.trim() || null,
                validUntil: validUntil || undefined,
                notes: notes.trim() || null,
                customerPoNumber: po.trim() || null,
              });
            }}
          >
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span>{t("editor.globalDiscount")}</span>
                <Select value={mode} onChange={(e) => setMode(e.target.value as "rate" | "amount")}>
                  <option value="rate">%</option>
                  <option value="amount">FCFA</option>
                </Select>
              </label>
              {mode === "rate" ? (
                <Input aria-label={t("editor.globalDiscountRate")} inputMode="numeric" value={rate} invalid={overCap} onChange={(e) => setRate(e.target.value)} className="w-24" />
              ) : (
                <MoneyInput aria-label={t("editor.globalDiscountAmount")} value={amount} onChange={setAmount} />
              )}
            </div>
            {overCap && <p className="text-xs text-status-warn">{t("editor.discountCapExceeded", { cap: quote.myDiscountCap.global })}</p>}
            <label className="flex flex-col gap-1">
              <span>{t("editor.discountReason")}</span>
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">—</option>
                {DISCOUNT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`editor.discountReasons.${r}`)}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-muted">{t("editor.discountReasonRequired")}</span>
            </label>
            <Input label={t("form.validUntil")} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            {quote.customer.type === "COMPANY" && <Input label={t("detail.customerPo")} value={po} onChange={(e) => setPo(e.target.value)} />}
            <label className="flex flex-col gap-1">
              <span>{t("form.notes")}</span>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" className="min-h-11" disabled={busy}>
                {t("saved").replace(".", "")}
              </Button>
              {quote.discountApprovalStatus === "PENDING" && perms.has("quote:update") && (
                <Button type="button" variant="secondary" className="min-h-11" onClick={() => onRequestApproval(reason || "Remise au-delà du plafond")}>
                  {t("editor.requestApproval")}
                </Button>
              )}
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-1 text-xs text-muted">
            {quote.discountReason && (
              <span>
                {t("editor.discountReason")} : {t(`editor.discountReasons.${quote.discountReason}`) || quote.discountReason}
              </span>
            )}
            {quote.notes && <span className="whitespace-pre-line">{quote.notes}</span>}
            {quote.customerPoNumber && (
              <span>
                {t("detail.customerPo")} : {quote.customerPoNumber}
              </span>
            )}
          </div>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-1 self-start">
        <dt>{t("editor.subtotal")}</dt>
        <dd className="text-right">{formatFCFA(quote.subtotal)}</dd>
        <dt>{t("editor.discounts")}</dt>
        <dd className="text-right">−{formatFCFA(quote.discountTotal)}</dd>
        <dt>{t("editor.vatTotal")}</dt>
        <dd className="text-right">{formatFCFA(quote.vatTotal)}</dd>
        <dt className="font-semibold">{t("editor.totalTtc")}</dt>
        <dd className="text-right font-semibold">{formatFCFA(quote.total)}</dd>
        {quote.insuranceShare > 0 && (
          <>
            <dt>{t("editor.insuranceShare")}</dt>
            <dd className="text-right">{formatFCFA(quote.insuranceShare)}</dd>
            <dt>{t("editor.customerShare")}</dt>
            <dd className="text-right">{formatFCFA(quote.customerShare)}</dd>
          </>
        )}
        {quote.acceptedTotal > 0 && (
          <>
            <dt className="text-status-ok">{t("editor.acceptedTotal")}</dt>
            <dd className="text-right text-status-ok">{formatFCFA(quote.acceptedTotal)}</dd>
          </>
        )}
        {quote.margin && (
          <>
            <dt className="text-muted">{t("editor.margin")}</dt>
            <dd className="text-right text-muted">{formatFCFA(quote.margin.estimated)}</dd>
          </>
        )}
        {quote.settings.depositRule && quote.total >= quote.settings.depositRule.thresholdTtc && (
          <>
            <dt className="text-muted">{t("editor.deposit")}</dt>
            <dd className="text-right text-muted">
              {formatFCFA(Math.ceil(((quote.acceptedTotal || quote.total) * quote.settings.depositRule.rate) / 100 / 100) * 100)}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
