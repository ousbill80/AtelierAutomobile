"use client";

// PRD M09 §7.2 — fiche dossier de recouvrement. Écarts documentés : mise en demeure,
// « Relancer maintenant », assignation et dérogation de crédit non exposés dans cet écran.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { formatFCFA } from "@atelieros/core/money";
import { Button, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { ErrorBox } from "../error-box";
import { CASE_STATUS_TONE, INVOICE_STATUS_TONE, formatDay, riskLabelOf, t } from "../i18n";

type CaseData = inferRouterOutputs<AppRouter>["collections"]["getCase"];
type Dialog =
  "payment" | "promise" | "call" | "note" | "dispute" | "resolve" | "pause" | "writeOff" | null;

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
  const components = customer.riskComponents as Record<string, number> | null;
  const isActive = ACTIVE.includes(kase.status);
  const phoneDigits = customer.phone?.replace(/\D/g, "");
  const statementFrom = `${data.today.slice(0, 4)}-01-01`;
  const openInvoices = data.invoices.filter((i) => i.balance > 0 && i.status !== "WRITTEN_OFF");

  return (
    <div className="flex flex-col gap-5 pb-10">
      <Link href="/creances" className="min-h-11 text-sm text-muted underline">
        {t("case.back")}
      </Link>

      <header className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{customer.displayName}</h1>
          <StatusBadge tone={CASE_STATUS_TONE[kase.status] ?? "off"}>
            {t(`caseStatus.${kase.status}`)}
          </StatusBadge>
          <span
            title={
              components
                ? t("risk.components", {
                    A: components.A ?? 0,
                    B: components.B ?? 0,
                    C: components.C ?? 0,
                    D: components.D ?? 0,
                    E: components.E ?? 0,
                  })
                : undefined
            }
          >
            <StatusBadge tone={risk.tone}>
              {t("risk.label")} : {t(risk.key)}
              {customer.riskScore !== null ? ` (${customer.riskScore})` : ""}
            </StatusBadge>
          </span>
          {customer.creditHold && <StatusBadge tone="bad">{t("creditHold")}</StatusBadge>}
          {kase.unreachable && <StatusBadge tone="bad">{t("unreachable")}</StatusBadge>}
        </div>
        {components && (
          <p className="text-xs text-muted">
            {t("risk.components", {
              A: components.A ?? 0,
              B: components.B ?? 0,
              C: components.C ?? 0,
              D: components.D ?? 0,
              E: components.E ?? 0,
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {customer.phone && (
            <a
              href={`tel:${customer.phone}`}
              onClick={() => setDialog("call")}
              className="inline-flex min-h-11 items-center rounded-md bg-surface-2 px-4 text-sm font-medium"
            >
              {t("case.call")} {customer.phone}
            </a>
          )}
          {phoneDigits && (
            <a
              href={`https://wa.me/${phoneDigits}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center rounded-md bg-surface-2 px-4 text-sm font-medium"
            >
              {t("case.whatsapp")}
            </a>
          )}
          <a
            href={`/api/creances/releve/${customer.id}?from=${statementFrom}&to=${data.today}`}
            className="inline-flex min-h-11 items-center rounded-md bg-surface-2 px-4 text-sm font-medium"
          >
            {t("case.statement")}
          </a>
        </div>
        {customer.contacts.length > 0 && (
          <p className="text-sm">
            <span className="text-muted">{t("case.accountingContacts")} : </span>
            {customer.contacts.map((c) => [c.name, c.phone].filter(Boolean).join(" ")).join(" · ")}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Info label={t("columns.totalDue")} value={formatFCFA(data.exposure.totalDue)} />
          <Info label={t("columns.overdue")} value={formatFCFA(data.exposure.overdueDue)} />
          <Info
            label={t("columns.maxDays")}
            value={t("days", { count: data.exposure.maxDaysOverdue })}
          />
          <Info
            label={t("credit." + data.credit.level)}
            value={
              customer.creditLimit !== null
                ? t("case.creditLimit", {
                    limit: formatFCFA(customer.creditLimit),
                    exposure: formatFCFA(data.credit.exposure),
                  })
                : t("case.noCreditLimit", { exposure: formatFCFA(data.credit.exposure) })
            }
          />
        </div>
        {data.credit.message && (
          <p
            className={`rounded-md p-3 text-sm ${data.credit.level === "BLOCK" ? "bg-status-bad-bg text-status-bad" : "bg-status-warn-bg text-status-warn"}`}
          >
            {data.credit.level === "BLOCK" ? "■ " : "▲ "}
            {data.credit.message}
          </p>
        )}
        {kase.status === "PAUSED" && kase.pausedUntil && (
          <p className="text-sm text-muted">
            {t("case.pausedUntil", { date: formatDay(kase.pausedUntil) })}
          </p>
        )}
      </header>

      {isActive && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog("payment")}>{t("actions.recordPayment")}</Button>
          {kase.status !== "DISPUTED" && (
            <Button variant="secondary" onClick={() => setDialog("promise")}>
              {t("actions.addPromise")}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setDialog("call")}>
            {t("actions.logCall")}
          </Button>
          <Button variant="secondary" onClick={() => setDialog("note")}>
            {t("actions.addNote")}
          </Button>
          {kase.status === "DISPUTED" ? (
            <Button variant="secondary" onClick={() => setDialog("resolve")}>
              {t("actions.resolveDispute")}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setDialog("dispute")}>
              {t("actions.openDispute")}
            </Button>
          )}
          {kase.status === "PAUSED" ? (
            <Button
              variant="secondary"
              onClick={() => resume.mutate({ caseId: kase.id })}
              disabled={resume.isPending}
            >
              {t("actions.resume")}
            </Button>
          ) : (
            ["OPEN", "PROMISED", "ESCALATED"].includes(kase.status) && (
              <Button variant="secondary" onClick={() => setDialog("pause")}>
                {t("actions.pause")}
              </Button>
            )
          )}
          {["OPEN", "PROMISED"].includes(kase.status) && (
            <Button
              variant="secondary"
              onClick={() => escalate.mutate({ caseId: kase.id })}
              disabled={escalate.isPending}
            >
              {t("actions.escalate")}
            </Button>
          )}
          <Button variant="danger" onClick={() => setDialog("writeOff")}>
            {t("actions.writeOff")}
          </Button>
        </div>
      )}
      {(resume.error || escalate.error || cancelPromise.error) && (
        <p className="text-sm text-status-bad">
          {(resume.error ?? escalate.error ?? cancelPromise.error)?.message}
        </p>
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

      <Section title={t("case.sequence")}>
        {data.reminders.length === 0 ? (
          <p className="text-sm text-muted">{t("case.noReminders")}</p>
        ) : (
          <ol className="flex flex-wrap gap-2">
            {data.reminders.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm"
              >
                <span className="font-medium">{r.stepKey}</span>
                <StatusBadge
                  tone={
                    r.status === "SENT"
                      ? "ok"
                      : r.status === "CANCELLED" || r.status === "SKIPPED"
                        ? "off"
                        : "warn"
                  }
                >
                  {t(`reminderStatus.${r.status}`)}
                </StatusBadge>
                <span className="text-xs text-muted">{formatDay(r.sentAt ?? r.scheduledFor)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={t("case.invoices")}>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-muted">{t("case.noInvoices")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.invoices.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm md:flex-row md:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium">
                    {i.number ?? "—"}
                    {i.fneNumber ? ` · ${t("case.fne", { number: i.fneNumber })}` : ""}
                  </span>
                  <span className="text-xs text-muted">
                    {t("columns.dueDate")} : {formatDay(i.dueDate)} ·{" "}
                    {t("days", { count: i.daysOverdue })}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <StatusBadge tone={INVOICE_STATUS_TONE[i.status] ?? "off"}>
                    {t(`invoiceStatus.${i.status}`)}
                  </StatusBadge>
                  <span>
                    {formatFCFA(i.balance)} / {formatFCFA(i.total)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("case.promises")}>
        {kase.promises.length === 0 ? (
          <p className="text-sm text-muted">{t("case.noPromises")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {kase.promises.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
              >
                <span>
                  {formatFCFA(p.amount)} · {formatDay(p.promisedDate)}
                  {p.channel ? ` · ${t(`promiseChannels.${p.channel}`)}` : ""}
                </span>
                <span className="flex items-center gap-2">
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
                  {p.status === "PENDING" && (
                    <Button
                      variant="ghost"
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
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("case.timeline")}>
        <Timeline data={data} />
      </Section>
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
    <ul className="flex flex-col gap-2">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col rounded-md border border-border p-3 text-sm">
          <span className="text-xs text-muted">
            {formatDay(e.at)}
            {e.who ? ` · ${e.who}` : ""}
          </span>
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-semibold">{title}</h2>
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
  error,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-4"
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
          <Button type="submit" disabled={pending}>
            {t("actions.save")}
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
  return (
    <DialogShell
      title={t("actions.recordPayment")}
      onClose={onClose}
      pending={mutation.isPending}
      error={mutation.error?.message}
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
