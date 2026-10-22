"use client";

// M16 §7 — fiche sinistre : Résumé (statut, répartition RG-M16-03, étapes), Expertise, Devis
// (accord, écart RG-M16-05), Factures et paiements, Documents (checklist RG-M16-09, photos),
// Chronologie (`ClaimActivity`). Actions selon le statut et les permissions.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  Field,
  Input,
  Modal,
  MoneyInput,
  PlateBadge,
  Select,
  Tabs,
  Textarea,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime, formatDay } from "@/components/repair-orders/i18n";
import { InvoiceStatusBadge } from "@/components/billing/badges";
import { BlockerBadge, ClaimStatusBadge, type Blocker } from "@/components/claims/badges";
import { ClaimProgress, NextStep, ReimbursementPanel } from "@/components/claims/claim-progress";
import { ATTACHMENT_KINDS, t } from "@/components/claims/i18n";
import { compressPhoto } from "@/components/tablet/photo";
import { ClaimsNav } from "../../nav";

const TABS = ["summary", "expertise", "quote", "invoices", "documents", "timeline"] as const;
type Tab = (typeof TABS)[number];
type ModalKind = "expert" | "visit" | "approval" | "reject" | "cancel" | "activity" | null;

const BEFORE_APPROVAL = ["OPENED", "EXPERT_SCHEDULED", "ESTIMATE_SENT"];
const CLOSED = ["INVOICED", "PARTIALLY_PAID", "PAID", "REJECTED", "CANCELLED"];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function ClaimView({ id }: { id: string }) {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const utils = trpc.useUtils();
  const q = trpc.claim.get.useQuery({ id });
  const [tab, setTab] = useState<Tab>("summary");
  const [modal, setModal] = useState<ModalKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const done = async (message?: string) => {
    setModal(null);
    setError(null);
    setNotice(message ?? null);
    await utils.claim.get.invalidate({ id });
  };
  const fail = (e: { message: string }) => setError(e.message);
  const createQuote = trpc.claim.createQuote.useMutation({
    onSuccess: () => done(),
    onError: fail,
  });
  const sendEstimate = trpc.claim.sendEstimate.useMutation({
    onSuccess: (r) =>
      done(
        r.missingDocuments.length
          ? t("missing", { list: r.missingDocuments.map((k) => t(`kinds.${k}`)).join(", ") })
          : undefined,
      ),
    onError: fail,
  });
  const invoice = trpc.claim.invoice.useMutation({ onSuccess: () => done(), onError: fail });

  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.isError || !q.data) {
    return <ErrorBox onRetry={() => q.refetch()} message={q.error?.message ?? t("loadError")} />;
  }
  const d = q.data;
  const c = d.claim;
  const tz = d.timeZone;
  const manage = perms.has("insurance:manage");
  const currentQuote = d.quotes.find((x) => !x.supersededAt) ?? d.quotes[0] ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ClaimsNav />
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl font-semibold">{c.number}</h1>
          <ClaimStatusBadge status={c.status} />
        </div>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col">
            <dt className="text-xs text-muted">{t("fields.vehicle")}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Link href={`/vehicules/${d.vehicle.id}`} aria-label={d.vehicle.plate}>
                <PlateBadge plate={d.vehicle.plate} />
              </Link>
              <span className="truncate">
                {d.vehicle.make} {d.vehicle.model}
              </span>
            </dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-xs text-muted">{t("fields.customer")}</dt>
            <dd className="truncate font-medium">
              <Link href={`/clients/${d.customer.id}`} className="hover:underline">
                {d.customer.displayName}
              </Link>
            </dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-xs text-muted">{t("fields.insurer")}</dt>
            <dd className="truncate font-medium">
              <Link href={`/assurances/compagnies/${d.insurer.id}`} className="hover:underline">
                {d.insurer.name}
              </Link>
            </dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-xs text-muted">{t("fields.claimNumber")}</dt>
            <dd className="truncate font-mono">{c.claimNumber ?? "—"}</dd>
          </div>
        </dl>
        {d.blockers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(d.blockers as Blocker[]).map((b) => (
              <BlockerBadge key={b.code} blocker={b} />
            ))}
          </div>
        )}
        {d.policyExpired && (
          <p role="status" className="text-sm text-status-warn">
            ⚠ {t("policyExpired")}
          </p>
        )}
        {d.duplicate && (
          <p role="status" className="text-sm text-status-warn">
            ⚠ {t("duplicate", { number: d.duplicate.number })}
          </p>
        )}
        {c.status === "REJECTED" && c.rejectReason && (
          <p className="text-sm text-status-bad">
            ✕ {t("rejectedBecause", { reason: c.rejectReason })}
          </p>
        )}
      </div>

      <ClaimProgress claim={c} />
      <NextStep status={c.status} />

      <div className="flex flex-wrap gap-2">
        {manage && ["OPENED", "EXPERT_SCHEDULED"].includes(c.status) && (
          <Button variant="secondary" className="min-h-11" onClick={() => setModal("expert")}>
            {t("actions.scheduleExpert")}
          </Button>
        )}
        {manage && c.status === "EXPERT_SCHEDULED" && !c.expertVisitedAt && (
          <Button variant="secondary" className="min-h-11" onClick={() => setModal("visit")}>
            {t("actions.recordVisit")}
          </Button>
        )}
        {manage && perms.has("quote:create") && !currentQuote && !CLOSED.includes(c.status) && (
          <Button
            variant="secondary"
            className="min-h-11"
            loading={createQuote.isPending}
            onClick={() => createQuote.mutate({ id })}
          >
            {t("actions.createQuote")}
          </Button>
        )}
        {manage && currentQuote && !CLOSED.includes(c.status) && c.status !== "ESTIMATE_SENT" && (
          <Button
            variant="secondary"
            className="min-h-11"
            loading={sendEstimate.isPending}
            onClick={() => sendEstimate.mutate({ id, quoteId: currentQuote.id, channel: "email" })}
          >
            {t("actions.sendEstimate")}
          </Button>
        )}
        {perms.has("claim:approve_record") && c.status === "ESTIMATE_SENT" && (
          <Button className="min-h-11" onClick={() => setModal("approval")}>
            {t("actions.recordApproval")}
          </Button>
        )}
        {perms.has("claim:invoice") && ["APPROVED", "REPAIRING"].includes(c.status) && (
          <Button
            className="min-h-11"
            loading={invoice.isPending}
            onClick={() => invoice.mutate({ id })}
          >
            {t("actions.invoice")}
          </Button>
        )}
        {(manage || perms.has("claim:followup")) && (
          <Button variant="secondary" className="min-h-11" onClick={() => setModal("activity")}>
            {t("actions.addActivity")}
          </Button>
        )}
        {perms.has("claim:approve_record") && BEFORE_APPROVAL.includes(c.status) && (
          <Button variant="secondary" className="min-h-11" onClick={() => setModal("reject")}>
            {t("actions.reject")}
          </Button>
        )}
        {manage && !CLOSED.includes(c.status) && (
          <Button variant="secondary" className="min-h-11" onClick={() => setModal("cancel")}>
            {t("actions.cancelClaim")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-status-warn">
          ⚠ {notice}
        </p>
      )}

      <div className="max-w-full overflow-x-auto">
        <Tabs
          items={TABS.map((key) => ({ key, label: t(`tabs.${key}`) }))}
          activeKey={tab}
          onChange={(key) => setTab(key as Tab)}
        />
      </div>

      {tab === "summary" && (
        <section className="flex flex-col gap-3">
          <ReimbursementPanel status={c.status} invoices={d.invoices} split={d.split} />
          <div className="rounded-lg border border-border bg-surface p-3">
            <h2 className="mb-2 font-semibold">{t("split")}</h2>
            {d.split ? (
              <>
                <Row label={t("fields.total")} value={formatFCFA(d.split.E + d.split.C)} />
                <Row label={t("fields.deductible")} value={formatFCFA(d.split.D)} />
                {d.split.V > 0 && (
                  <Row label={t("fields.depreciation")} value={formatFCFA(d.split.V)} />
                )}
                {d.split.X > 0 && <Row label={t("fields.gap")} value={formatFCFA(d.split.X)} />}
                {c.approvedAmount !== null && (
                  <Row label={t("fields.approvedAmount")} value={formatFCFA(c.approvedAmount)} />
                )}
                <Row label={t("fields.insurerShare")} value={formatFCFA(d.split.insurerShare)} />
                <Row label={t("fields.customerShare")} value={formatFCFA(d.split.customerShare)} />
              </>
            ) : (
              <p className="text-sm text-muted">{t("noLines")}</p>
            )}
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            <h2 className="mb-2 font-semibold">{t("steps")}</h2>
            <Row label={t("fields.accidentDate")} value={formatDay(c.accidentDate, "UTC")} />
            <Row label={t("fields.expertVisitAt")} value={formatDateTime(c.expertVisitAt, tz)} />
            <Row
              label={t("fields.expertVisitedAt")}
              value={formatDateTime(c.expertVisitedAt, tz)}
            />
            <Row label={t("fields.estimateSentAt")} value={formatDateTime(c.estimateSentAt, tz)} />
            <Row label={t("fields.approvedAt")} value={formatDateTime(c.approvedAt, tz)} />
            <Row
              label={t("fields.repairOrder")}
              value={
                d.repairOrder ? (
                  <Link className="underline" href={`/ordres/${d.repairOrder.id}`}>
                    {d.repairOrder.number}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Row label={t("fields.policyNumber")} value={c.policyNumber ?? "—"} />
            <Row label={t("fields.accidentPlace")} value={c.accidentPlace ?? "—"} />
          </div>
          {manage && !["INVOICED", "PARTIALLY_PAID", "PAID"].includes(c.status) && (
            <ClaimNumberForm id={id} value={c.claimNumber} onSaved={() => done(t("saved"))} />
          )}
        </section>
      )}

      {tab === "expertise" && (
        <section className="rounded-lg border border-border bg-surface p-3">
          <Row label={t("fields.expertName")} value={c.expertName ?? "—"} />
          <Row label={t("fields.expertFirm")} value={c.expertFirm ?? "—"} />
          <Row label={t("fields.expertPhone")} value={c.expertPhone ?? "—"} />
          <Row label={t("fields.expertEmail")} value={c.expertEmail ?? "—"} />
          <Row label={t("fields.expertVisitAt")} value={formatDateTime(c.expertVisitAt, tz)} />
          <Row label={t("fields.expertVisitedAt")} value={formatDateTime(c.expertVisitedAt, tz)} />
        </section>
      )}

      {tab === "quote" && (
        <section className="flex flex-col gap-2">
          {d.quotes.length === 0 ? (
            <p className="text-sm text-muted">{t("noQuote")}</p>
          ) : (
            d.quotes.map((x) => (
              <Link
                key={x.id}
                href={`/devis/${x.id}`}
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm hover:border-accent"
              >
                <span className="font-mono font-semibold">
                  {x.number} v{x.version}
                </span>
                <span>{formatFCFA(x.total)}</span>
              </Link>
            ))
          )}
          {c.approvedAmount !== null && (
            <div className="rounded-lg border border-border bg-surface p-3">
              <Row label={t("fields.approvedAmount")} value={formatFCFA(c.approvedAmount)} />
              <Row label={t("fields.approvalRef")} value={c.approvalRef ?? "—"} />
              {c.gapHandling && <Row label={t("gap.title")} value={t(`gap.${c.gapHandling}`)} />}
            </div>
          )}
        </section>
      )}

      {tab === "invoices" && (
        <section className="flex flex-col gap-2">
          {d.invoices.length === 0 ? (
            <p className="text-sm text-muted">{t("noInvoice")}</p>
          ) : (
            d.invoices.map((inv) => (
              <Link
                key={inv.id}
                href={`/factures/${inv.id}`}
                className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 text-sm hover:border-accent"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{inv.number ?? t("draft")}</span>
                  <span className="text-xs font-semibold">
                    {inv.billTo === "INSURANCE"
                      ? t("fields.insurerShare")
                      : t("fields.customerShare")}
                  </span>
                  <InvoiceStatusBadge status={inv.status} />
                </span>
                <span className="flex flex-wrap gap-3 text-xs">
                  <span>
                    {t("fields.total")} {formatFCFA(inv.total)}
                  </span>
                  {inv.status !== "DRAFT" && (
                    <span>{t("dueAmount", { amount: formatFCFA(inv.balance) })}</span>
                  )}
                  {inv.dueDate && <span>{formatDay(inv.dueDate, "UTC")}</span>}
                </span>
              </Link>
            ))
          )}
        </section>
      )}

      {tab === "documents" && (
        <DocumentsTab
          id={id}
          canUpload={manage}
          attachments={d.attachments}
          missing={d.missingDocuments}
          required={d.insurer.requiredDocuments}
          onUploaded={() => done()}
        />
      )}

      {tab === "timeline" && (
        <section>
          {d.activities.length === 0 ? (
            <p className="text-sm text-muted">{t("noActivity")}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {d.activities.map((a) => {
                const data = (a.data ?? {}) as { to?: string };
                return (
                  <li key={a.id} className="rounded-lg border border-border bg-surface p-2 text-sm">
                    <span className="flex flex-wrap gap-2 text-xs text-muted">
                      <span>{formatDateTime(a.createdAt, tz)}</span>
                      <span className="font-semibold">{t(`activityType.${a.type}`)}</span>
                      {a.type === "status_change" && data.to && (
                        <ClaimStatusBadge status={data.to} />
                      )}
                    </span>
                    {a.body && <p>{a.body}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {modal === "expert" && (
        <ExpertModal id={id} onClose={() => setModal(null)} onDone={() => done()} />
      )}
      {modal === "visit" && (
        <VisitModal id={id} onClose={() => setModal(null)} onDone={() => done()} />
      )}
      {modal === "approval" && (
        <ApprovalModal
          id={id}
          estimate={d.split?.E ?? 0}
          deductible={c.deductible}
          canAbsorb={perms.has("claim:absorb_gap")}
          onClose={() => setModal(null)}
          onDone={(warnings) => done(warnings[0])}
        />
      )}
      {(modal === "reject" || modal === "cancel") && (
        <ReasonModal id={id} kind={modal} onClose={() => setModal(null)} onDone={() => done()} />
      )}
      {modal === "activity" && (
        <ActivityModal id={id} onClose={() => setModal(null)} onDone={() => done()} />
      )}
    </div>
  );
}

function ClaimNumberForm({
  id,
  value,
  onSaved,
}: {
  id: string;
  value: string | null;
  onSaved: () => void;
}) {
  const [claimNumber, setClaimNumber] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = trpc.claim.update.useMutation({
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id, claimNumber: claimNumber.trim() || null });
      }}
    >
      <Field label={t("fields.claimNumber")} error={error}>
        <Input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" className="min-h-11" loading={save.isPending}>
        {t("save")}
      </Button>
    </form>
  );
}

function ExpertModal({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [expertName, setExpertName] = useState("");
  const [expertFirm, setExpertFirm] = useState("");
  const [expertPhone, setExpertPhone] = useState("");
  const [visitAt, setVisitAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = trpc.claim.scheduleExpert.useMutation({
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });
  return (
    <Modal
      open
      title={t("actions.scheduleExpert")}
      onClose={onClose}
      footer={
        <Button
          loading={save.isPending}
          disabled={expertName.trim().length < 2 || !visitAt}
          onClick={() =>
            save.mutate({
              id,
              expertName,
              expertFirm: expertFirm || undefined,
              expertPhone: expertPhone || undefined,
              expertVisitAt: new Date(visitAt),
            })
          }
        >
          {t("save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label={t("fields.expertName")}
          value={expertName}
          onChange={(e) => setExpertName(e.target.value)}
        />
        <Input
          label={t("fields.expertFirm")}
          value={expertFirm}
          onChange={(e) => setExpertFirm(e.target.value)}
        />
        <Input
          label={t("fields.expertPhone")}
          value={expertPhone}
          onChange={(e) => setExpertPhone(e.target.value)}
        />
        <Input
          label={t("fields.expertVisitAt")}
          type="datetime-local"
          value={visitAt}
          onChange={(e) => setVisitAt(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-status-bad">
            ⚠ {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function VisitModal({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [visitedAt, setVisitedAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = trpc.claim.recordExpertVisit.useMutation({
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });
  return (
    <Modal
      open
      title={t("actions.recordVisit")}
      onClose={onClose}
      footer={
        <Button
          loading={save.isPending}
          disabled={!visitedAt}
          onClick={() => save.mutate({ id, visitedAt: new Date(visitedAt) })}
        >
          {t("save")}
        </Button>
      }
    >
      <Input
        label={t("fields.expertVisitedAt")}
        type="datetime-local"
        value={visitedAt}
        onChange={(e) => setVisitedAt(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
      )}
    </Modal>
  );
}

function ApprovalModal({
  id,
  estimate,
  deductible: initialDeductible,
  canAbsorb,
  onClose,
  onDone,
}: {
  id: string;
  estimate: number;
  deductible: number;
  canAbsorb: boolean;
  onClose: () => void;
  onDone: (warnings: string[]) => void;
}) {
  const [approved, setApproved] = useState<number | null>(estimate || null);
  const [deductible, setDeductible] = useState<number | null>(initialDeductible);
  const [depreciation, setDepreciation] = useState<number | null>(null);
  const [approvalRef, setApprovalRef] = useState("");
  const [gapHandling, setGapHandling] = useState<"" | "REVISE" | "CUSTOMER" | "GARAGE">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = trpc.claim.recordApproval.useMutation({
    onSuccess: (r) => onDone(r.warnings),
    onError: (e) => setError(e.message),
  });
  const gap = approved !== null && estimate > approved ? estimate - approved : 0;
  return (
    <Modal
      open
      title={t("actions.recordApproval")}
      onClose={onClose}
      footer={
        <Button
          loading={save.isPending}
          disabled={approved === null || deductible === null}
          onClick={() =>
            save.mutate({
              id,
              approvedAmount: approved ?? 0,
              deductible: deductible ?? 0,
              depreciation: depreciation ?? undefined,
              approvalRef: approvalRef || undefined,
              gapHandling: gapHandling || undefined,
              reason: reason || undefined,
            })
          }
        >
          {t("save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("fields.approvedAmount")}>
          <MoneyInput value={approved} onChange={setApproved} />
        </Field>
        <Field label={t("fields.deductible")}>
          <MoneyInput value={deductible} onChange={setDeductible} />
        </Field>
        <Field label={t("fields.depreciation")}>
          <MoneyInput value={depreciation} onChange={setDepreciation} />
        </Field>
        <Input
          label={t("fields.approvalRef")}
          value={approvalRef}
          onChange={(e) => setApprovalRef(e.target.value)}
        />
        {gap > 0 && (
          <Field label={`${t("gap.title")} : ${formatFCFA(gap)}`}>
            <Select
              value={gapHandling}
              onChange={(e) => setGapHandling(e.target.value as typeof gapHandling)}
            >
              <option value="">—</option>
              <option value="REVISE">{t("gap.REVISE")}</option>
              <option value="CUSTOMER">{t("gap.CUSTOMER")}</option>
              {canAbsorb && <option value="GARAGE">{t("gap.GARAGE")}</option>}
            </Select>
          </Field>
        )}
        {gapHandling === "GARAGE" && (
          <Input
            label={t("fields.reason")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-status-bad">
            ⚠ {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function ReasonModal({
  id,
  kind,
  onClose,
  onDone,
}: {
  id: string;
  kind: "reject" | "cancel";
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const opts = { onSuccess: onDone, onError: (e: { message: string }) => setError(e.message) };
  const reject = trpc.claim.reject.useMutation(opts);
  const cancel = trpc.claim.cancel.useMutation(opts);
  const m = kind === "reject" ? reject : cancel;
  return (
    <Modal
      open
      title={kind === "reject" ? t("actions.reject") : t("actions.cancelClaim")}
      onClose={onClose}
      footer={
        <Button
          loading={m.isPending}
          disabled={reason.trim().length < 3}
          onClick={() => m.mutate({ id, reason })}
        >
          {t("confirm")}
        </Button>
      }
    >
      <Field label={t("fields.reason")}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
      )}
    </Modal>
  );
}

function ActivityModal({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [type, setType] = useState<"call" | "note" | "email" | "visit">("call");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = trpc.claim.addActivity.useMutation({
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });
  return (
    <Modal
      open
      title={t("actions.addActivity")}
      onClose={onClose}
      footer={
        <Button
          loading={save.isPending}
          disabled={!body.trim()}
          onClick={() => save.mutate({ id, type, body })}
        >
          {t("save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("fields.kind")}>
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {(["call", "note", "email", "visit"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`activityType.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("fields.notes")}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-status-bad">
            ⚠ {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function DocumentsTab({
  id,
  canUpload,
  attachments,
  missing,
  required,
  onUploaded,
}: {
  id: string;
  canUpload: boolean;
  attachments: { id: string; kind: string; mimeType: string; url: string }[];
  missing: string[];
  required: string[];
  onUploaded: () => void;
}) {
  const [kind, setKind] = useState<(typeof ATTACHMENT_KINDS)[number]>("photo_damage");
  const [error, setError] = useState<string | null>(null);
  const upload = trpc.claim.uploadDocument.useMutation({
    onSuccess: onUploaded,
    onError: (e) => setError(e.message),
  });

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.type.startsWith("image/")) {
      const photo = await compressPhoto(file);
      upload.mutate({ id, kind, ...photo });
      return;
    }
    if (file.size > 10_000_000) {
      setError(t("fileTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      upload.mutate({
        id,
        kind,
        mimeType: "application/pdf",
        dataBase64: url.slice(url.indexOf(",") + 1),
      });
    };
    reader.readAsDataURL(file);
  }

  const present = new Set(attachments.map((a) => a.kind));
  const checklist =
    required.length > 0
      ? required
      : missing.concat([...present].filter((k) => !missing.includes(k)));
  return (
    <section className="flex flex-col gap-3">
      <ul className="grid gap-2 text-sm sm:grid-cols-2" aria-label={t("fields.requiredDocuments")}>
        {checklist.map((k) => {
          const ok = present.has(k);
          const count = attachments.filter((a) => a.kind === k).length;
          return (
            <li
              key={k}
              className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 ${
                ok
                  ? "border-status-ok/30 bg-status-ok-bg"
                  : "border-status-warn/40 bg-status-warn-bg"
              }`}
            >
              <span
                aria-hidden
                className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                  ok ? "bg-status-ok text-white" : "border-2 border-status-warn text-status-warn"
                }`}
              >
                {ok ? "✓" : "!"}
              </span>
              <span className={`flex-1 ${ok ? "" : "font-medium text-status-warn"}`}>
                {t(`kinds.${k}`)}
              </span>
              {count > 0 && <span className="text-xs text-muted">× {count}</span>}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">
        {missing.length === 0
          ? t("missingNone")
          : t("missing", { list: missing.map((k) => t(`kinds.${k}`)).join(", ") })}
      </p>
      {canUpload && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("fields.kind")}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {ATTACHMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <label className="btn btn-secondary min-h-11 cursor-pointer">
            {t("actions.upload")}
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {error}
        </p>
      )}
      {attachments.length === 0 ? (
        <p className="text-sm text-muted">{t("noDocuments")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {attachments.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 text-xs">
              <a href={a.url} target="_blank" rel="noreferrer" className="block min-h-11">
                {a.mimeType.startsWith("image/") ? (
                  <img
                    src={a.url}
                    alt={t(`kinds.${a.kind}`)}
                    className="h-24 w-full rounded object-cover"
                  />
                ) : (
                  <span className="flex h-24 items-center justify-center rounded bg-surface-2">
                    PDF
                  </span>
                )}
              </a>
              <span>{t(`kinds.${a.kind}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
