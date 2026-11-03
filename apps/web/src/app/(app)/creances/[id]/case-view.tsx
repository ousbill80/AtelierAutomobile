"use client";

// PRD M09 §7.2 — fiche dossier de recouvrement. Écarts documentés : assignation et dérogation
// de crédit non exposées dans cet écran ; mise en demeure sans image de signature (M15).
import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { formatFCFA } from "@atelieros/core/money";
import { EduTip } from "@/components/edu-tip";
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  ChevronLeft,
  Clock,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Phone,
  PhoneCall,
  Send,
  Wallet,
  X,
} from "lucide-react";
import { describeStep } from "@atelieros/core/reminders/stepLabel";
import { DeliveryTicks } from "@/components/messaging/delivery-ticks";
import { Button, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { PaymentAccountNotice, usePaymentAccountBlock } from "@/components/billing/payment-account";
import { ErrorBox } from "../error-box";
import { RemindDialog } from "../remind-dialog";
import { FormalNoticeSection } from "./formal-notice";
import { CASE_STATUS_TONE, INVOICE_STATUS_TONE, formatDay, riskLabelOf, t } from "../i18n";

type CaseData = inferRouterOutputs<AppRouter>["collections"]["getCase"];
type Dialog =
  | "payment"
  | "promise"
  | "call"
  | "note"
  | "dispute"
  | "resolve"
  | "pause"
  | "writeOff"
  | "remind"
  | null;

const PAYMENT_METHODS = [
  "CASH",
  "WAVE",
  "ORANGE_MONEY",
  "MTN_MOMO",
  "MOOV_MONEY",
  "BANK_TRANSFER",
  "CHEQUE",
] as const;
const ACTIVE = ["OPEN", "PROMISED", "PAUSED", "DISPUTED", "ESCALATED"];

export function CaseView({ id }: { id: string }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [remindSent, setRemindSent] = useState(false);
  const utils = trpc.useUtils();
  const query = trpc.collections.getCase.useQuery({ id });

  function refresh() {
    setDialog(null);
    void utils.collections.invalidate();
  }

  const resume = trpc.collections.resume.useMutation({ onSuccess: refresh });
  const escalate = trpc.collections.escalate.useMutation({ onSuccess: refresh });
  const cancelPromise = trpc.collections.cancelPromise.useMutation({ onSuccess: refresh });

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorBox message={t("case.loadError")} onRetry={() => query.refetch()} />;
  }

  const data = query.data;
  const kase = data.case;
  const customer = kase.customer;
  const risk = riskLabelOf(customer.riskScore);
  const isActive = ACTIVE.includes(kase.status);
  const canRemind = ["OPEN", "PROMISED", "ESCALATED"].includes(kase.status);
  const phoneDigits = customer.phone?.replace(/\D/g, "");
  const statementFrom = `${data.today.slice(0, 4)}-01-01`;
  const openInvoices = data.invoices.filter((i) => i.balance > 0 && i.status !== "WRITTEN_OFF");
  const tone = delayTone(data.exposure.maxDaysOverdue);

  // Actions secondaires, regroupées dans « Plus d'actions ».
  const moreActions: { key: string; label: string; onClick: () => void; danger?: boolean }[] = [];
  if (isActive) {
    moreActions.push({
      key: "note",
      label: t("actions.addNote"),
      onClick: () => setDialog("note"),
    });
    if (kase.status === "DISPUTED") {
      moreActions.push({
        key: "resolve",
        label: t("actions.resolveDispute"),
        onClick: () => setDialog("resolve"),
      });
    } else {
      moreActions.push({
        key: "dispute",
        label: t("actions.openDispute"),
        onClick: () => setDialog("dispute"),
      });
    }
    if (kase.status === "PAUSED") {
      moreActions.push({
        key: "resume",
        label: t("actions.resume"),
        onClick: () => resume.mutate({ caseId: kase.id }),
      });
    } else if (canRemind) {
      moreActions.push({
        key: "pause",
        label: t("actions.pause"),
        onClick: () => setDialog("pause"),
      });
    }
    if (["OPEN", "PROMISED"].includes(kase.status)) {
      moreActions.push({
        key: "escalate",
        label: t("actions.escalate"),
        onClick: () => escalate.mutate({ caseId: kase.id }),
      });
    }
    moreActions.push({
      key: "writeOff",
      label: t("actions.writeOff"),
      onClick: () => setDialog("writeOff"),
      danger: true,
    });
  }

  return (
    <div className="flex flex-col gap-5 pb-10">
      <Link
        href="/creances"
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-muted hover:text-foreground"
      >
        <ChevronLeft size={16} aria-hidden /> {t("case.back")}
      </Link>

      {/* En-tête : qui, combien, depuis quand. */}
      <header className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-2 text-base font-bold"
            >
              {initialsOf(customer.displayName)}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold">{customer.displayName}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusBadge tone={CASE_STATUS_TONE[kase.status] ?? "off"}>
                  {t(`caseStatus.${kase.status}`)}
                </StatusBadge>
                <StatusBadge tone={risk.tone}>
                  {t(risk.key)}
                  {customer.riskScore !== null ? ` · ${customer.riskScore}/100` : ""}
                </StatusBadge>
                <EduTip text={t("case.riskHelp")} example={t("case.riskExample")} />
                {customer.creditHold && <StatusBadge tone="bad">{t("creditHold")}</StatusBadge>}
                {kase.unreachable && <StatusBadge tone="bad">{t("unreachable")}</StatusBadge>}
              </div>
              {customer.contacts.length > 0 && (
                <p className="mt-1 text-sm text-muted">
                  {t("case.accountingContacts")} :{" "}
                  <span className="text-foreground">
                    {customer.contacts
                      .map((c) => [c.name, c.phone].filter(Boolean).join(" "))
                      .join(" · ")}
                  </span>
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {customer.phone && (
              <a
                href={`tel:${customer.phone}`}
                onClick={() => setDialog("call")}
                className="btn btn-secondary min-h-11"
              >
                <Phone size={16} aria-hidden /> {t("case.callShort")}
              </a>
            )}
            {phoneDigits && (
              <a
                href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(
                  t("case.whatsappText", {
                    name: customer.displayName,
                    amount: formatFCFA(data.exposure.overdueDue || data.exposure.totalDue),
                  }),
                )}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary min-h-11"
              >
                <MessageCircle size={16} aria-hidden /> {t("case.whatsapp")}
              </a>
            )}
            <a
              href={`/api/creances/releve/${customer.id}?from=${statementFrom}&to=${data.today}`}
              className="btn btn-secondary min-h-11"
            >
              <FileText size={16} aria-hidden /> {t("case.statementShort")}
            </a>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure
            label={t("columns.totalDue")}
            help={t("kpiHelp.totalDue")}
            example={t("kpiExample.totalDue")}
          >
            {formatFCFA(data.exposure.totalDue)}
          </Figure>
          <Figure
            label={t("columns.overdue")}
            help={t("kpiHelp.overdue")}
            example={t("kpiExample.overdue")}
            danger={data.exposure.overdueDue > 0}
          >
            {formatFCFA(data.exposure.overdueDue)}
          </Figure>
          <Figure
            label={t("case.oldestDelay")}
            help={t("kpiHelp.maxDays")}
            example={t("kpiExample.maxDays")}
          >
            <span className={`inline-flex rounded-full px-2 py-0.5 text-base ${DELAY_PILL[tone]}`}>
              {t("days", { count: data.exposure.maxDaysOverdue })}
            </span>
          </Figure>
          <Figure
            label={t("case.creditTitle")}
            help={t("kpiHelp.credit")}
            example={t("kpiExample.credit")}
          >
            <span className="text-base">
              {customer.creditLimit !== null
                ? t("case.creditLimitShort", { limit: formatFCFA(customer.creditLimit) })
                : t("case.noCreditLimitShort")}
            </span>
          </Figure>
        </dl>

        {data.credit.message && (
          <p
            className={`flex items-start gap-2 rounded-lg p-3 text-sm ${data.credit.level === "BLOCK" ? "bg-status-bad-bg text-status-bad" : "bg-status-warn-bg text-status-warn"}`}
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            {data.credit.message}
          </p>
        )}
        {kase.status === "PAUSED" && kase.pausedUntil && (
          <p className="text-sm text-muted">
            {t("case.pausedUntil", { date: formatDay(kase.pausedUntil) })}
          </p>
        )}
      </header>

      {/* Actions : les 4 plus fréquentes visibles, le reste dans « Plus d'actions ». */}
      {isActive && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Button className="col-span-2 sm:col-span-1" onClick={() => setDialog("payment")}>
            <Wallet size={16} aria-hidden /> {t("actions.recordPayment")}
          </Button>
          {canRemind && (
            <Button variant="secondary" onClick={() => setDialog("remind")}>
              <Send size={16} aria-hidden /> {t("actions.remindShort")}
            </Button>
          )}
          {kase.status !== "DISPUTED" && (
            <Button variant="secondary" onClick={() => setDialog("promise")}>
              <CalendarCheck size={16} aria-hidden /> {t("actions.addPromise")}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setDialog("call")}>
            <PhoneCall size={16} aria-hidden /> {t("actions.logCall")}
          </Button>
          <MoreActions actions={moreActions} />
        </div>
      )}
      {(resume.error || escalate.error || cancelPromise.error) && (
        <p className="text-sm text-status-bad">
          {(resume.error ?? escalate.error ?? cancelPromise.error)?.message}
        </p>
      )}
      {remindSent && (
        <p role="status" className="rounded-md bg-status-ok-bg p-3 text-sm text-status-ok">
          ✓ {t("remind.sent")}
        </p>
      )}

      {dialog === "remind" && (
        <RemindDialog
          caseIds={[kase.id]}
          title={t("remind.title", { name: customer.displayName })}
          onClose={() => setDialog(null)}
          onDone={() => {
            setRemindSent(true);
            void utils.collections.invalidate();
          }}
        />
      )}
      {dialog === "payment" && (
        <PaymentDialog
          customerId={customer.id}
          today={data.today}
          max={data.exposure.totalDue}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
      {dialog === "promise" && (
        <PromiseDialog
          caseId={kase.id}
          today={data.today}
          defaultAmount={kase.overdueDue}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
      {dialog === "call" && (
        <CallDialog caseId={kase.id} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog === "note" && (
        <NoteDialog caseId={kase.id} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog === "dispute" && (
        <DisputeDialog
          caseId={kase.id}
          invoices={openInvoices}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
      {dialog === "resolve" && (
        <ResolveDialog caseId={kase.id} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog === "pause" && (
        <PauseDialog caseId={kase.id} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog === "writeOff" && (
        <WriteOffDialog
          invoices={openInvoices.filter((i) => i.status !== "DISPUTED")}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title={t("case.invoices")} count={data.invoices.length}>
            {data.invoices.length === 0 ? (
              <p className="text-sm text-muted">{t("case.noInvoices")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.invoices.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {i.number ?? "—"}
                        {i.fneNumber ? (
                          <span className="font-normal text-muted">
                            {" "}
                            · {t("case.fne", { number: i.fneNumber })}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted">
                        {t("columns.dueDate")} {formatDay(i.dueDate)}
                        {i.daysOverdue > 0
                          ? ` · ${t("days", { count: i.daysOverdue })} ${t("case.late")}`
                          : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <StatusBadge tone={INVOICE_STATUS_TONE[i.status] ?? "off"}>
                        {t(`invoiceStatus.${i.status}`)}
                      </StatusBadge>
                      <span className="text-right tabular-nums">
                        <span className="block font-semibold">{formatFCFA(i.balance)}</span>
                        <span className="block text-xs text-muted">
                          {t("case.ofTotal", { total: formatFCFA(i.total) })}
                        </span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t("case.sequence")} count={data.reminders.length}>
            {data.reminders.length === 0 ? (
              <p className="text-sm text-muted">{t("case.noReminders")}</p>
            ) : (
              <ol className="flex flex-col">
                {data.reminders.map((r, index) => {
                  const done = r.status === "SENT";
                  const off = r.status === "CANCELLED" || r.status === "SKIPPED";
                  return (
                    <li key={r.id} className="relative flex gap-3 pb-4 last:pb-0">
                      {index < data.reminders.length - 1 && (
                        <span
                          aria-hidden
                          className="absolute top-6 left-[11px] h-full w-px bg-border"
                        />
                      )}
                      <span
                        aria-hidden
                        className={`relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${done ? "bg-status-ok text-white" : off ? "bg-surface-2 text-muted" : "bg-status-warn-bg text-status-warn"}`}
                      >
                        {done ? <Check size={14} /> : off ? <X size={14} /> : <Clock size={13} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="font-medium">{stepLabel(r.stepKey)}</span>
                          {r.channel && (
                            <span className="text-muted">· {t(`list.channels.${r.channel}`)}</span>
                          )}
                          <StatusBadge tone={done ? "ok" : off ? "off" : "warn"}>
                            {t(`reminderStatus.${r.status}`)}
                          </StatusBadge>
                          {done && <DeliveryTicks state={r.delivery} />}
                        </p>
                        <p className="text-xs text-muted">
                          {formatDay(r.sentAt ?? r.scheduledFor)}
                          {off && r.skippedReason ? ` · ${r.skippedReason}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>

          <Section title={t("case.timeline")}>
            <Timeline data={data} />
          </Section>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Section title={t("case.promises")} count={kase.promises.length}>
            {kase.promises.length === 0 ? (
              <p className="text-sm text-muted">{t("case.noPromises")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {kase.promises.map((p) => (
                  <li key={p.id} className="flex flex-col gap-1.5 py-2.5 text-sm">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold tabular-nums">{formatFCFA(p.amount)}</span>
                      <StatusBadge
                        tone={
                          p.status === "KEPT"
                            ? "ok"
                            : p.status === "PENDING"
                              ? "warn"
                              : p.status === "CANCELLED"
                                ? "off"
                                : "bad"
                        }
                      >
                        {t(`promiseStatus.${p.status}`)}
                      </StatusBadge>
                    </span>
                    <span className="text-xs text-muted">
                      {t("case.promisedFor", { date: formatDay(p.promisedDate) })}
                      {p.channel ? ` · ${t(`promiseChannels.${p.channel}`)}` : ""}
                    </span>
                    {p.status === "PENDING" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        disabled={cancelPromise.isPending}
                        onClick={() =>
                          cancelPromise.mutate({
                            promiseId: p.id,
                            reason: t("actions.cancelPromise"),
                          })
                        }
                      >
                        {t("actions.cancelPromise")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <FormalNoticeSection
            caseId={kase.id}
            active={canRemind}
            today={data.today}
            notice={data.formalNotice}
            onChanged={() => void utils.collections.invalidate()}
          />
        </aside>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() ||
    "?"
  );
}

function delayTone(days: number): "ok" | "warn" | "bad" {
  if (days <= 7) return "ok";
  if (days <= 30) return "warn";
  return "bad";
}

const DELAY_PILL: Record<"ok" | "warn" | "bad", string> = {
  ok: "bg-status-ok-bg text-status-ok",
  warn: "bg-status-warn-bg text-status-warn",
  bad: "bg-status-bad-bg text-status-bad",
};

/** Palier en clair : « 3 jours après l'échéance », « Relance envoyée à la main »… */
function stepLabel(stepKey: string): string {
  const step = describeStep(stepKey);
  switch (step.kind) {
    case "before":
      return t("steps.before", { days: step.days });
    case "after":
      return t("steps.after", { days: step.days });
    case "on":
      return t("steps.on");
    case "manual":
      return t("steps.manual");
    case "promise":
      return t("steps.promise");
    default:
      return step.key;
  }
}

function Figure({
  label,
  help,
  example,
  danger,
  children,
}: {
  label: string;
  help?: string;
  example?: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative flex flex-col gap-1 rounded-lg bg-surface-2/70 p-3 pr-9">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${danger ? "text-status-bad" : ""}`}>
        {children}
      </dd>
      {help ? (
        <span className="absolute top-1 right-1">
          <EduTip text={help} example={example} />
        </span>
      ) : null}
    </div>
  );
}

function MoreActions({
  actions,
}: {
  actions: { key: string; label: string; onClick: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;
  return (
    <div className="relative">
      <Button
        variant="ghost"
        className="w-full sm:w-auto"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} aria-hidden /> {t("actions.more")}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 flex w-full min-w-60 flex-col rounded-lg border border-border bg-surface p-1 shadow-lg sm:w-auto"
        >
          {actions.map((a) => (
            <button
              key={a.key}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
              className={`min-h-11 rounded-md px-3 text-left text-sm hover:bg-surface-2 ${a.danger ? "mt-1 border-t border-border text-status-bad" : ""}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Timeline({ data }: { data: CaseData }) {
  const entries = [
    ...data.case.notes.map((n) => ({
      id: n.id,
      at: new Date(n.createdAt),
      text: n.body,
      who: n.createdBy?.user?.name ?? null,
      kind: n.type,
    })),
    ...data.payments.map((p) => ({
      id: p.id,
      at: new Date(p.receivedAt),
      text: t("case.paymentLine", {
        number: p.number,
        amount: formatFCFA(p.amount),
        method: t(`methods.${p.method}`),
      }),
      who: null,
      kind: "payment",
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  if (entries.length === 0) return <p className="text-sm text-muted">{t("case.noTimeline")}</p>;
  return (
    <ul className="divide-y divide-border">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3 py-2.5 text-sm">
          <span
            aria-hidden
            className={`mt-1.5 size-2 shrink-0 rounded-full ${e.kind === "payment" ? "bg-status-ok" : e.kind === "call" ? "bg-accent" : "bg-border"}`}
          />
          <span className="min-w-0">
            <span className="block">{e.text}</span>
            <span className="text-xs text-muted">
              {formatDay(e.at)}
              {e.who ? ` · ${e.who}` : ""}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        {title}
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-surface-2 px-2 text-xs font-medium text-muted">
            {count}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

const fieldClass = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm";

function DialogShell({
  title,
  onClose,
  onSubmit,
  pending,
  submitDisabled,
  submitLabel,
  error,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 md:items-center md:p-4"
    >
      <form
        className="flex max-h-[90vh] w-full flex-col gap-3 overflow-y-auto rounded-t-lg bg-surface p-4 md:max-w-lg md:rounded-lg"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        {children}
        {error && <p className="text-sm text-status-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button type="submit" disabled={pending || submitDisabled}>
            {submitLabel ?? t("actions.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

function toInt(value: string): number {
  return Number.parseInt(value.replace(/\s/g, ""), 10) || 0;
}

interface DialogProps {
  onClose: () => void;
  onDone: () => void;
}

function PaymentDialog({
  customerId,
  today,
  max,
  onClose,
  onDone,
}: DialogProps & { customerId: string; today: string; max: number }) {
  const [amount, setAmount] = useState(max > 0 ? String(max) : "");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("CASH");
  const [reference, setReference] = useState("");
  const mutation = trpc.payment.record.useMutation({ onSuccess: onDone });
  const account = usePaymentAccountBlock(method, date);
  return (
    <DialogShell
      title={t("actions.recordPayment")}
      onClose={onClose}
      pending={mutation.isPending}
      submitDisabled={Boolean(account.message) || account.pending}
      error={account.message ? null : mutation.error?.message}
      onSubmit={() =>
        mutation.mutate({
          customerId,
          amount: toInt(amount),
          method,
          receivedAt: date,
          reference: reference || undefined,
        })
      }
    >
      <Field label={t("form.amount")}>
        <input
          className={fieldClass}
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label={t("form.date")}>
        <input
          type="date"
          className={fieldClass}
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field label={t("form.method")}>
        <select
          className={fieldClass}
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`methods.${m}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("form.reference")}>
        <input
          className={fieldClass}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </Field>
      <p className="text-xs text-muted">{t("form.autoAllocation")}</p>
      <PaymentAccountNotice message={account.message} />
    </DialogShell>
  );
}

function PromiseDialog({
  caseId,
  today,
  defaultAmount,
  onClose,
  onDone,
}: DialogProps & { caseId: string; today: string; defaultAmount: number }) {
  const [rows, setRows] = useState([{ amount: String(defaultAmount), date: today }]);
  const [channel, setChannel] = useState<"phone" | "whatsapp" | "in_person" | "email">("phone");
  const [note, setNote] = useState("");
  const mutation = trpc.collections.addPromise.useMutation({ onSuccess: onDone });
  return (
    <DialogShell
      title={t("actions.addPromise")}
      onClose={onClose}
      pending={mutation.isPending}
      error={mutation.error?.message}
      onSubmit={() =>
        mutation.mutate({
          caseId,
          channel,
          note: note || undefined,
          installments: rows.map((r) => ({ amount: toInt(r.amount), date: r.date })),
        })
      }
    >
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-2 gap-2">
          <Field label={t("form.amount")}>
            <input
              className={fieldClass}
              inputMode="numeric"
              value={row.amount}
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))
              }
            />
          </Field>
          <Field label={t("form.date")}>
            <input
              type="date"
              className={fieldClass}
              min={today}
              value={row.date}
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, date: e.target.value } : r)))
              }
            />
          </Field>
          {rows.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              {t("actions.removeInstallment")}
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => setRows([...rows, { amount: "", date: today }])}
      >
        {t("actions.addInstallment")}
      </Button>
      <Field label={t("form.channel")}>
        <select
          className={fieldClass}
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
        >
          {(["phone", "whatsapp", "in_person", "email"] as const).map((c) => (
            <option key={c} value={c}>
              {t(`promiseChannels.${c}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("form.note")}>
        <textarea className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </DialogShell>
  );
}

function CallDialog({ caseId, onClose, onDone }: DialogProps & { caseId: string }) {
  const [outcome, setOutcome] = useState<"REACHED" | "NO_ANSWER" | "WRONG_NUMBER" | "CALLBACK">(
    "REACHED",
  );
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const mutation = trpc.collections.logCall.useMutation({ onSuccess: onDone });
  return (
    <DialogShell
      title={t("actions.logCall")}
      onClose={onClose}
      pending={mutation.isPending}
      error={mutation.error?.message}
      onSubmit={() =>
        mutation.mutate({
          caseId,
          outcome,
          note: note || undefined,
          callbackAt: callbackAt ? new Date(callbackAt) : undefined,
        })
      }
    >
      <Field label={t("form.outcome")}>
        <select
          className={fieldClass}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as typeof outcome)}
        >
          {(["REACHED", "NO_ANSWER", "WRONG_NUMBER", "CALLBACK"] as const).map((o) => (
            <option key={o} value={o}>
              {t(`callOutcomes.${o}`)}
            </option>
          ))}
        </select>
      </Field>
      {outcome === "CALLBACK" && (
        <Field label={t("form.callbackAt")}>
          <input
            type="datetime-local"
            className={fieldClass}
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
          />
        </Field>
      )}
      <Field label={t("form.note")}>
        <textarea className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </DialogShell>
  );
}

function NoteDialog({ caseId, onClose, onDone }: DialogProps & { caseId: string }) {
  const [body, setBody] = useState("");
  const [type, setType] = useState<"note" | "visit">("note");
  const mutation = trpc.collections.addNote.useMutation({ onSuccess: onDone });
  return (
    <DialogShell
      title={t("actions.addNote")}
      onClose={onClose}
      pending={mutation.isPending}
      error={mutation.error?.message}
      onSubmit={() => mutation.mutate({ caseId, body, type })}
    >
      <Field label={t("form.noteType")}>
        <select
          className={fieldClass}
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          <option value="note">{t("noteTypes.note")}</option>
          <option value="visit">{t("noteTypes.visit")}</option>
        </select>
      </Field>
      <Field label={t("form.note")}>
        <textarea className={fieldClass} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
    </DialogShell>
  );
}

type InvoiceRow = CaseData["invoices"][number];

function InvoicePicker({
  invoices,
  selected,
  onChange,
}: {
  invoices: InvoiceRow[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      {invoices.map((i) => (
        <label key={i.id} className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={selected.has(i.id)}
            onChange={() => {
              const next = new Set(selected);
              if (next.has(i.id)) next.delete(i.id);
              else next.add(i.id);
              onChange(next);
            }}
          />
          {i.number ?? "—"} · {formatFCFA(i.balance)} · {t("days", { count: i.daysOverdue })}
        </label>
      ))}
    </fieldset>
  );
}

function DisputeDialog({
  caseId,
  invoices,
  onClose,
  onDone,
}: DialogProps & { caseId: string; invoices: InvoiceRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const mutation = trpc.collections.openDispute.useMutation({ onSuccess: onDone });
  return (
    <DialogShell
      title={t("actions.openDispute")}
      onClose={onClose}
      pending={mutation.isPending}
      error={mutation.error?.message}
      onSubmit={() =>
        mutation.mutate({
          caseId,
          invoiceIds: [...selected],
          reason,
          disputedAmount: amount ? toInt(amount) : undefined,
        })
      }
    >
      <p className="text-sm text-muted">{t("form.disputedInvoices")}</p>
      <InvoicePicker
        invoices={invoices.filter((i) => i.status !== "DISPUTED")}
        selected={selected}
        onChange={setSelected}
      />
      <Field label={t("form.reason")}>
        <textarea
          className={fieldClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Field label={t("form.disputedAmount")}>
        <input
          className={fieldClass}
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
    </DialogShell>
  );
}

function ResolveDialog({ caseId, onClose, onDone }: DialogProps & { caseId: string }) {
  const [resolution, setResolution] = useState<"PAY" | "CREDIT_NOTE" | "WRITE_OFF">("PAY");
  const [note, setNote] = useState("");
  const mutation = trpc.collections.resolveDispute.useMutation({ onSuccess: onDone });
  return (
    <DialogShell
      title={t("actions.resolveDispute")}
      onClose={onClose}
      pending={mutation.isPending}
      error={mutation.error?.message}
      onSubmit={() => mutation.mutate({ caseId, resolution, note })}
    >
      <Field label={t("form.resolution")}>
        <select
          className={fieldClass}
          value={resolution}
          onChange={(e) => setResolution(e.target.value as typeof resolution)}
        >
          {(["PAY", "CREDIT_NOTE", "WRITE_OFF"] as const).map((r) => (
            <option key={r} value={r}>
              {t(`resolutions.${r}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("form.note")}>
        <textarea className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </DialogShell>
  );
}

function PauseDialog({ caseId, onClose, onDone }: DialogProps & { caseId: string }) {
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const mutation = trpc.collections.pause.useMutation({ onSuccess: onDone });
  return (
    <DialogShell
      title={t("actions.pause")}
      onClose={onClose}
      pending={mutation.isPending}
      error={mutation.error?.message}
      onSubmit={() => mutation.mutate({ caseId, until, reason })}
    >
      <Field label={t("form.until")}>
        <input
          type="date"
          className={fieldClass}
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
      </Field>
      <Field label={t("form.reason")}>
        <input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </DialogShell>
  );
}

function WriteOffDialog({ invoices, onClose, onDone }: DialogProps & { invoices: InvoiceRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [confirmAmount, setConfirmAmount] = useState("");
  const mutation = trpc.collections.writeOff.useMutation({ onSuccess: onDone });
  return (
    <DialogShell
      title={t("actions.writeOff")}
      onClose={onClose}
      pending={mutation.isPending}
      error={mutation.error?.message}
      onSubmit={() =>
        mutation.mutate({
          invoiceIds: [...selected],
          reason,
          confirmAmount: confirmAmount ? toInt(confirmAmount) : undefined,
        })
      }
    >
      <InvoicePicker invoices={invoices} selected={selected} onChange={setSelected} />
      <Field label={t("form.reason")}>
        <textarea
          className={fieldClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Field label={t("form.confirmAmount")}>
        <input
          className={fieldClass}
          inputMode="numeric"
          value={confirmAmount}
          onChange={(e) => setConfirmAmount(e.target.value)}
        />
      </Field>
    </DialogShell>
  );
}
