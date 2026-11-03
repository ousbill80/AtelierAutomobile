"use client";

// M08 §7 `/caisse/paiements` — tous les paiements : mode, statut, non affectés ; annuler,
// confirmer / rejeter un chèque, rembourser un trop-perçu, imprimer le reçu.
import { useState } from "react";
import Link from "next/link";
import { Ban, CircleCheck, Receipt, Send, TriangleAlert } from "lucide-react";
import type { DeliveryState } from "@atelieros/core/messaging/delivery";
import { DeliveryTicks } from "@/components/messaging/delivery-ticks";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  CheckboxRow,
  EmptyState,
  Input,
  Modal,
  MoneyInput,
  Select,
  StatusBadge,
  Textarea,
  type StatusTone,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { Kpi } from "@/components/cash/cash-ui";
import { PAYMENT_METHODS, t, tc } from "@/components/billing/i18n";

type Action = { kind: "void" | "fail" | "refund"; id: string; max: number };
type StatusFilter = "" | "CONFIRMED" | "PENDING" | "FAILED" | "REFUNDED" | "VOIDED";
type PaymentRow = {
  id: string;
  number: string;
  method: string;
  status: string;
  amount: number;
  unallocated: number;
  reference: string | null;
  receivedAt: Date | string;
  voidedAt: Date | string | null;
  receiptUrl: string;
  receiptSent?: { channel: string; state: DeliveryState } | null;
  customer: { id: string; displayName: string } | null;
  allocations: { amount: number; invoice: { id: string; number: string | null } }[];
};

function countLabel(count: number) {
  return tc(count > 1 ? "paymentsList.countMany" : "paymentsList.countOne", { count });
}

function paymentStatus(payment: Pick<PaymentRow, "status" | "voidedAt">): {
  tone: StatusTone;
  label: string;
} {
  if (payment.voidedAt) return { tone: "off", label: t("payments.voided") };
  if (payment.status === "PENDING") return { tone: "warn", label: t("payments.pending") };
  if (payment.status === "FAILED") return { tone: "bad", label: tc("paymentsList.failCheque") };
  if (payment.status === "REFUNDED") return { tone: "warn", label: tc("paymentsList.refunded") };
  return { tone: "ok", label: tc("paymentsList.confirmed") };
}

export default function PaymentsPage() {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [search, setSearch] = useState("");
  const [unallocatedOnly, setUnallocatedOnly] = useState(false);
  const q = trpc.payment.list.useQuery({
    method: (method || undefined) as never,
    limit: 100,
  });
  const [action, setAction] = useState<Action | null>(null);
  const confirm = trpc.payment.confirmCheque.useMutation({ onSuccess: () => q.refetch() });
  const needle = search.trim().toLowerCase();
  const all = (q.data?.items ?? []) as PaymentRow[];
  const confirmed = all.filter((p) => p.status === "CONFIRMED" && !p.voidedAt);
  const voided = all.filter((p) => p.voidedAt);
  const unallocatedRows = all.filter((p) => !p.voidedAt && p.unallocated > 0);
  const unallocated = unallocatedRows.reduce((sum, p) => sum + p.unallocated, 0);
  const items = all.filter((p) => {
    if (status === "VOIDED") {
      if (!p.voidedAt) return false;
    } else if (status === "CONFIRMED") {
      if (p.voidedAt || p.status !== "CONFIRMED") return false;
    } else if (status && (p.voidedAt || p.status !== status)) return false;
    if (unallocatedOnly && !(p.unallocated > 0 && !p.voidedAt)) return false;
    if (!needle) return true;
    const hay = [
      p.number,
      p.customer?.displayName,
      p.reference,
      ...p.allocations.map((a) => a.invoice.number),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
  function toggleStatus(next: StatusFilter) {
    setStatus((current) => (current === next ? "" : next));
    setUnallocatedOnly(false);
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-10">
      <header>
        <Link
          href="/caisse"
          className="inline-flex min-h-11 items-center text-sm font-medium text-accent"
        >
          ← {t("back")}
        </Link>
        <h1 className="text-2xl font-semibold">{tc("paymentsList.title")}</h1>
        <p className="mt-1 text-sm text-muted">{tc("paymentsList.subtitle")}</p>
      </header>
      {q.data && (
        <section
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          aria-label={tc("paymentsList.title")}
        >
          <Kpi
            icon={CircleCheck}
            label={tc("paymentsList.confirmedTotal")}
            value={formatFCFA(confirmed.reduce((sum, p) => sum + p.amount, 0))}
            tone="ok"
            hint={countLabel(confirmed.length)}
            help={tc("paymentsList.help.confirmed")}
            example={tc("paymentsList.example.confirmed")}
            pressed={status === "CONFIRMED"}
            onClick={() => toggleStatus("CONFIRMED")}
          />
          <Kpi
            icon={TriangleAlert}
            label={tc("paymentsList.unallocatedTotal")}
            value={formatFCFA(unallocated)}
            tone={unallocated > 0 ? "warn" : "neutral"}
            hint={countLabel(unallocatedRows.length)}
            help={tc("paymentsList.help.unallocated")}
            example={tc("paymentsList.example.unallocated")}
            pressed={unallocatedOnly}
            onClick={() => {
              setUnallocatedOnly((on) => !on);
              setStatus("");
            }}
          />
          <Kpi
            icon={Ban}
            label={tc("paymentsList.voidedTotal")}
            value={formatFCFA(voided.reduce((sum, p) => sum + p.amount, 0))}
            hint={countLabel(voided.length)}
            help={tc("paymentsList.help.voided")}
            example={tc("paymentsList.example.voided")}
            pressed={status === "VOIDED"}
            onClick={() => toggleStatus("VOIDED")}
          />
        </section>
      )}
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_10.5rem_10.5rem]">
          <Input
            aria-label={tc("paymentsList.search")}
            placeholder={tc("paymentsList.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            aria-label={t("encaisser.method")}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="">{tc("paymentsList.allMethods")}</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`method.${m}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={tc("paymentsList.status")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setUnallocatedOnly(false);
            }}
          >
            <option value="">{tc("paymentsList.allStatuses")}</option>
            <option value="CONFIRMED">{tc("paymentsList.statusConfirmed")}</option>
            <option value="PENDING">{tc("paymentsList.statusPending")}</option>
            <option value="VOIDED">{tc("paymentsList.statusVoided")}</option>
            <option value="FAILED">{tc("paymentsList.statusFailed")}</option>
            <option value="REFUNDED">{tc("paymentsList.statusRefunded")}</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CheckboxRow
            label={tc("paymentsList.unallocatedOnly")}
            checked={unallocatedOnly}
            onChange={(e) => {
              setUnallocatedOnly(e.target.checked);
              if (e.target.checked) setStatus("");
            }}
          />
          {q.data && <p className="text-sm text-muted">{countLabel(items.length)}</p>}
        </div>
      </div>
      {confirm.error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {confirm.error.message}
        </p>
      )}
      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError || !q.data ? (
        <ErrorBox onRetry={() => q.refetch()} message={t("loadError")} />
      ) : items.length === 0 ? (
        <EmptyState title={tc("paymentsList.empty")} />
      ) : (
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="hidden grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)_minmax(0,1.15fr)_auto_minmax(8.5rem,auto)] gap-3 border-b border-border bg-surface-2 px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase lg:grid">
            <span>{tc("paymentsList.colReceipt")}</span>
            <span>{tc("paymentsList.colCustomer")}</span>
            <span>{tc("paymentsList.colInvoice")}</span>
            <span>{tc("paymentsList.colStatus")}</span>
            <span className="text-right">{tc("paymentsList.colAmount")}</span>
          </div>
          <ul>
            {items.map((p) => {
              const state = paymentStatus(p);
              const actions = (
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <a
                    href={p.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary btn-sm min-h-11"
                  >
                    <Receipt size={14} aria-hidden /> {t("actions.receipt")}
                  </a>
                  {p.customer &&
                    p.status === "CONFIRMED" &&
                    !p.voidedAt &&
                    perms.has("payment:create") && (
                      <SendReceipt paymentId={p.id} sent={p.receiptSent ?? null} />
                    )}
                  {p.method === "CHEQUE" && p.status === "PENDING" && perms.has("payment:void") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => confirm.mutate({ id: p.id })}
                    >
                      {tc("paymentsList.confirmCheque")}
                    </Button>
                  )}
                  {p.method === "CHEQUE" &&
                    p.status !== "FAILED" &&
                    !p.voidedAt &&
                    perms.has("payment:void") && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setAction({ kind: "fail", id: p.id, max: 0 })}
                      >
                        {tc("paymentsList.failCheque")}
                      </Button>
                    )}
                  {p.unallocated > 0 &&
                    p.status === "CONFIRMED" &&
                    !p.voidedAt &&
                    perms.has("payment:refund") && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setAction({ kind: "refund", id: p.id, max: p.unallocated })}
                      >
                        {tc("paymentsList.refund")}
                      </Button>
                    )}
                  {!p.voidedAt && p.status !== "FAILED" && perms.has("payment:void") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11 text-status-bad"
                      onClick={() => setAction({ kind: "void", id: p.id, max: 0 })}
                    >
                      {tc("paymentsList.void")}
                    </Button>
                  )}
                </div>
              );
              return (
                <li
                  key={p.id}
                  className={`border-b border-border last:border-b-0 ${p.voidedAt ? "bg-surface-2" : ""}`}
                >
                  <div className="flex min-w-0 flex-col gap-3 p-3 text-sm lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)_minmax(0,1.15fr)_auto_minmax(8.5rem,auto)] lg:items-center lg:gap-3 lg:px-4">
                    <span className="flex items-start justify-between gap-3 lg:block">
                      <span className="min-w-0">
                        <span className="block font-mono font-semibold">{p.number}</span>
                        <span className="block text-xs text-muted">
                          {t(`method.${p.method}`)}
                          {p.reference ? ` · ${p.reference}` : ""}
                        </span>
                        <span className="block text-xs text-muted">
                          {formatDateTime(p.receivedAt, q.data.timeZone)}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 font-semibold tabular-nums lg:hidden ${p.voidedAt ? "text-muted line-through" : ""}`}
                      >
                        {formatFCFA(p.amount)}
                      </span>
                    </span>
                    <span className="min-w-0">{p.customer?.displayName ?? "—"}</span>
                    <span className="flex min-w-0 flex-col gap-1">
                      {p.allocations.length === 0 ? (
                        <span className="text-muted">{tc("paymentsList.noInvoice")}</span>
                      ) : (
                        p.allocations.map((a) => (
                          <Link
                            key={a.invoice.id}
                            href={`/factures/${a.invoice.id}`}
                            className="font-medium text-accent"
                          >
                            {a.invoice.number ?? t("draft")}
                            {(p.allocations.length > 1 || a.amount !== p.amount) &&
                              ` · ${formatFCFA(a.amount)}`}
                          </Link>
                        ))
                      )}
                      {p.unallocated > 0 && !p.voidedAt && (
                        <span className="text-xs font-semibold text-status-warn">
                          {t("payments.unallocated", { amount: formatFCFA(p.unallocated) })}
                        </span>
                      )}
                    </span>
                    <span>
                      <StatusBadge tone={state.tone} label={state.label} />
                    </span>
                    <span className="hidden flex-col items-end gap-2 lg:flex">
                      <span
                        className={`font-semibold tabular-nums ${p.voidedAt ? "text-muted line-through" : ""}`}
                      >
                        {formatFCFA(p.amount)}
                      </span>
                      {actions}
                    </span>
                    <div className="lg:hidden">{actions}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {action && (
        <ActionModal
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            void q.refetch();
          }}
        />
      )}
    </div>
  );
}

function ActionModal({
  action,
  onClose,
  onDone,
}: {
  action: Action;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState<number | null>(action.max || null);
  const [method, setMethod] = useState("CASH");
  const voidM = trpc.payment.void.useMutation({ onSuccess: onDone });
  const failM = trpc.payment.failCheque.useMutation({ onSuccess: onDone });
  const refundM = trpc.refund.create.useMutation({ onSuccess: onDone });
  const m = action.kind === "void" ? voidM : action.kind === "fail" ? failM : refundM;
  const title =
    action.kind === "void"
      ? tc("paymentsList.void")
      : action.kind === "fail"
        ? tc("paymentsList.failCheque")
        : tc("paymentsList.refund");
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <Button
          variant="danger"
          loading={m.isPending}
          disabled={reason.trim().length < 3 || (action.kind === "refund" && !amount)}
          onClick={() => {
            if (action.kind === "void") voidM.mutate({ id: action.id, reason });
            else if (action.kind === "fail") failM.mutate({ id: action.id, reason });
            else if (amount)
              refundM.mutate({ paymentId: action.id, amount, method: method as never, reason });
          }}
        >
          {title}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {action.kind === "refund" && (
          <>
            <MoneyInput
              label={tc("paymentsList.refundAmount")}
              value={amount}
              onChange={setAmount}
            />
            <Select
              aria-label={t("encaisser.method")}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm} value={pm}>
                  {t(`method.${pm}`)}
                </option>
              ))}
            </Select>
          </>
        )}
        <label className="flex flex-col gap-1">
          {action.kind === "refund"
            ? tc("paymentsList.refundReason")
            : tc("paymentsList.voidReason")}
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </label>
        {m.error && (
          <p role="alert" className="text-status-bad">
            ⚠ {m.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Envoi du reçu au client (canal au choix) et accusé de réception du dernier envoi. */
function SendReceipt({
  paymentId,
  sent,
}: {
  paymentId: string;
  sent: { channel: string; state: DeliveryState } | null;
}) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const send = trpc.payment.sendReceipt.useMutation({
    onSuccess: () => {
      setOpen(false);
      void utils.payment.list.invalidate();
    },
  });
  return (
    <span className="flex flex-col items-start gap-1 lg:items-end">
      {open ? (
        <span className="flex flex-wrap items-center gap-1">
          {(["WHATSAPP", "SMS", "EMAIL"] as const).map((channel) => (
            <Button
              key={channel}
              size="sm"
              variant="secondary"
              disabled={send.isPending}
              onClick={() => send.mutate({ paymentId, channel })}
            >
              {tc(`receiptSend.channels.${channel}`)}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {tc("receiptSend.cancel")}
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Send size={14} aria-hidden /> {sent ? tc("receiptSend.resend") : tc("receiptSend.send")}
        </Button>
      )}
      {sent && (
        <span className="flex items-center gap-1 text-xs text-muted">
          {tc(`receiptSend.channels.${sent.channel}`)} <DeliveryTicks state={sent.state} />
        </span>
      )}
      {send.error && <span className="text-xs text-status-bad">{send.error.message}</span>}
    </span>
  );
}
