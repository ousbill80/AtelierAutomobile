"use client";

// M16 — suivi visuel du dossier sinistre : frise d'avancement (§5), prochaine étape, et suivi
// du remboursement par part (assureur / client) : estimé, envoyé, accordé, facturé, en retard,
// réglé (US-M16-07). Couleur + icône + texte, jamais la couleur seule.
import { useState, type ComponentType } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  CircleDashed,
  Clock,
  FileText,
  Lightbulb,
  Send,
  ThumbsUp,
  Wallet,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { formatDay } from "@/components/repair-orders/i18n";
import { t, type Tone } from "./i18n";

const DAY = 86_400_000;

const STEPS = [
  "OPENED",
  "EXPERT",
  "ESTIMATE_SENT",
  "APPROVED",
  "REPAIRING",
  "INVOICED",
  "PAID",
] as const;

const STATUS_STEP: Record<string, number> = {
  OPENED: 0,
  EXPERT_SCHEDULED: 1,
  ESTIMATE_SENT: 2,
  APPROVED: 3,
  REPAIRING: 4,
  INVOICED: 5,
  PARTIALLY_PAID: 5,
  PAID: 7,
};

type ClaimDates = {
  status: string;
  expertVisitedAt: Date | string | null;
  estimateSentAt: Date | string | null;
  approvedAt: Date | string | null;
};

/** Étape courante ; pour un dossier refusé/annulé, la dernière étape atteinte. */
function currentStep(c: ClaimDates): number {
  if (c.status in STATUS_STEP) return STATUS_STEP[c.status]!;
  if (c.approvedAt) return 3;
  if (c.estimateSentAt) return 2;
  if (c.expertVisitedAt) return 1;
  return 0;
}

export function ClaimProgress({ claim }: { claim: ClaimDates }) {
  const stopped = claim.status === "REJECTED" || claim.status === "CANCELLED";
  const current = currentStep(claim);
  return (
    <section
      aria-label={t("progress.title")}
      className="rounded-lg border border-border bg-surface p-3"
    >
      <ol className="flex max-w-full gap-1 overflow-x-auto pb-1">
        {STEPS.map((step, i) => {
          const state = i < current ? "done" : i === current && !stopped ? "current" : "todo";
          return (
            <li key={step} className="flex min-w-20 flex-1 flex-col items-center gap-1 text-center">
              <span className="flex w-full items-center">
                <span
                  aria-hidden
                  className={`h-0.5 flex-1 ${i === 0 ? "invisible" : i <= current ? "bg-accent" : "bg-border"}`}
                />
                <span
                  aria-hidden
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                    state === "done"
                      ? "border-accent bg-accent text-accent-foreground"
                      : state === "current"
                        ? "border-accent bg-surface text-accent"
                        : "border-border bg-surface text-muted"
                  }`}
                >
                  {state === "done" ? <Check className="size-4" /> : i + 1}
                </span>
                <span
                  aria-hidden
                  className={`h-0.5 flex-1 ${i === STEPS.length - 1 ? "invisible" : i < current ? "bg-accent" : "bg-border"}`}
                />
              </span>
              <span
                className={`text-xs leading-tight ${state === "todo" ? "text-muted" : "font-medium"}`}
              >
                {t(`progress.${step}`)}
                <span className="sr-only"> — {t(`progress.${state}`)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {stopped && (
        <p className="mt-2 flex items-center gap-2 text-sm text-status-bad">
          <Ban className="size-4" aria-hidden />
          {claim.status === "REJECTED"
            ? t("progress.stoppedRejected")
            : t("progress.stoppedCancelled")}
        </p>
      )}
    </section>
  );
}

export function NextStep({ status }: { status: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      <span>
        <span className="font-semibold">{t("nextStep.title")} : </span>
        {t(`nextStep.${status}`)}
      </span>
    </p>
  );
}

type Invoice = {
  billTo: string;
  type: string;
  status: string;
  total: number;
  balance: number;
  amountPaid: number;
  dueDate: Date | string | null;
};

type ShareState = {
  key: string;
  tone: Tone;
  icon: ComponentType<{ className?: string }>;
  days?: number;
};

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-status-ok-bg text-status-ok",
  warn: "bg-status-warn-bg text-status-warn",
  bad: "bg-status-bad-bg text-status-bad",
  off: "bg-status-off-bg text-status-off",
};

function shareState(
  claimStatus: string,
  invoice: Invoice | undefined,
  insurer: boolean,
  now: number,
): ShareState {
  if (claimStatus === "REJECTED") return { key: "rejected", tone: "bad", icon: Ban };
  if (claimStatus === "CANCELLED") return { key: "cancelled", tone: "off", icon: Ban };
  if (invoice) {
    if (invoice.balance <= 0) return { key: "paid", tone: "ok", icon: Check };
    const due = invoice.dueDate ? new Date(invoice.dueDate).getTime() : null;
    if (due !== null && now - due >= DAY) {
      return {
        key: "late",
        tone: "bad",
        icon: AlertTriangle,
        days: Math.floor((now - due) / DAY),
      };
    }
    if (invoice.amountPaid > 0) return { key: "partial", tone: "warn", icon: Wallet };
    return { key: "invoiced", tone: "warn", icon: FileText };
  }
  if (insurer && ["APPROVED", "REPAIRING"].includes(claimStatus)) {
    return { key: "accepted", tone: "ok", icon: ThumbsUp };
  }
  if (insurer && claimStatus === "ESTIMATE_SENT") return { key: "sent", tone: "warn", icon: Send };
  return { key: "estimate", tone: "off", icon: CircleDashed };
}

function ShareCard({
  title,
  amount,
  invoice,
  state,
  testId,
}: {
  title: string;
  amount: number | null;
  invoice: Invoice | undefined;
  state: ShareState;
  testId: string;
}) {
  const Icon = state.icon;
  const total = invoice?.total ?? amount;
  const paid = invoice?.amountPaid ?? 0;
  const ratio = total && total > 0 ? Math.min(1, paid / total) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <span className="text-xs font-medium text-muted">{title}</span>
      <span className="text-2xl font-bold tracking-tight">
        {total === null ? (
          <span className="text-base font-medium text-muted">{t("reimbursement.noAmount")}</span>
        ) : (
          <span data-testid={testId}>{formatFCFA(total)}</span>
        )}
      </span>
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[state.tone]}`}
      >
        <Icon className="size-3.5" aria-hidden />
        {t(`reimbursement.state.${state.key}`, { days: state.days ?? 0 })}
      </span>
      {invoice && total !== null && total > 0 && (
        <>
          <div
            className="h-2 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={paid}
            aria-label={t("reimbursement.paidOf", {
              paid: formatFCFA(paid),
              total: formatFCFA(total),
            })}
          >
            <div
              className={`h-full rounded-full ${state.key === "late" ? "bg-status-bad" : "bg-status-ok"}`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <span className="flex flex-wrap justify-between gap-2 text-xs text-muted">
            <span>
              {t("reimbursement.paidOf", { paid: formatFCFA(paid), total: formatFCFA(total) })}
            </span>
            {invoice.dueDate && invoice.balance > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden />
                {t("reimbursement.dueOn", { date: formatDay(invoice.dueDate, "UTC") })}
              </span>
            )}
          </span>
        </>
      )}
    </div>
  );
}

export function ReimbursementPanel({
  status,
  invoices,
  split,
}: {
  status: string;
  invoices: Invoice[];
  split: { insurerShare: number; customerShare: number } | null;
}) {
  // Instant figé au montage : le calcul du retard reste stable entre deux rendus.
  const [now] = useState(() => Date.now());
  const issued = (billTo: string) =>
    invoices.find(
      (i) => i.billTo === billTo && i.type === "INVOICE" && !["DRAFT", "VOID"].includes(i.status),
    );
  const insurerInvoice = issued("INSURANCE");
  const customerInvoice = issued("CUSTOMER");
  return (
    <section aria-labelledby="reimbursement" className="flex flex-col gap-2">
      <h2 id="reimbursement" className="font-semibold">
        {t("reimbursement.title")}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <ShareCard
          title={t("reimbursement.insurerTitle")}
          amount={split?.insurerShare ?? null}
          invoice={insurerInvoice}
          state={shareState(status, insurerInvoice, true, now)}
          testId="insurer-share"
        />
        <ShareCard
          title={t("reimbursement.customerTitle")}
          amount={split?.customerShare ?? null}
          invoice={customerInvoice}
          state={shareState(status, customerInvoice, false, now)}
          testId="customer-share"
        />
      </div>
    </section>
  );
}
