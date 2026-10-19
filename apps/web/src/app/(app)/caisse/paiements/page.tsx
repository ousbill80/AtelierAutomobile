"use client";

// M08 §7 `/caisse/paiements` — tous les paiements : mode, statut, non affectés ; annuler,
// confirmer / rejeter un chèque, rembourser un trop-perçu, imprimer le reçu.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  CheckboxRow,
  EmptyState,
  Modal,
  MoneyInput,
  Select,
  StatusBadge,
  Textarea,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { PAYMENT_METHODS, t, tc } from "@/components/billing/i18n";

type Action = { kind: "void" | "fail" | "refund"; id: string; max: number };

export default function PaymentsPage() {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const [method, setMethod] = useState("");
  const [unallocatedOnly, setUnallocatedOnly] = useState(false);
  const q = trpc.payment.list.useQuery({
    method: (method || undefined) as never,
    unallocatedOnly: unallocatedOnly || undefined,
  });
  const [action, setAction] = useState<Action | null>(null);
  const confirm = trpc.payment.confirmCheque.useMutation({ onSuccess: () => q.refetch() });
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4">
      <Link href="/caisse" className="text-sm text-accent">
        ← {t("back")}
      </Link>
      <h1 className="text-xl font-semibold">{tc("paymentsList.title")}</h1>
      <div className="flex flex-wrap items-center gap-3">
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
        <CheckboxRow
          label={tc("paymentsList.unallocatedOnly")}
          checked={unallocatedOnly}
          onChange={(e) => setUnallocatedOnly(e.target.checked)}
        />
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
      ) : q.data.items.length === 0 ? (
        <EmptyState title={tc("paymentsList.empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data.items.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{p.number}</span>
                  <span>{t(`method.${p.method}`)}</span>
                  {p.status === "PENDING" && (
                    <StatusBadge tone="warn" label={`⏳ ${t("payments.pending")}`} />
                  )}
                  {p.voidedAt && <StatusBadge tone="off" label={t("payments.voided")} />}
                  {p.status === "FAILED" && !p.voidedAt && (
                    <StatusBadge tone="bad" label={tc("paymentsList.failCheque")} />
                  )}
                </span>
                <span className="font-semibold">{formatFCFA(p.amount)}</span>
              </div>
              <span className="text-muted">
                {p.customer?.displayName ?? "—"} · {formatDateTime(p.receivedAt, q.data.timeZone)}
                {p.reference ? ` · réf. ${p.reference}` : ""}
              </span>
              {p.allocations.length > 0 && (
                <span>
                  {p.allocations.map((a) => (
                    <Link
                      key={a.invoice.id}
                      href={`/factures/${a.invoice.id}`}
                      className="mr-2 text-accent"
                    >
                      {a.invoice.number} ({formatFCFA(a.amount)})
                    </Link>
                  ))}
                </span>
              )}
              {p.unallocated > 0 && (
                <span className="font-semibold text-status-warn">
                  {t("payments.unallocated", { amount: formatFCFA(p.unallocated) })}
                </span>
              )}
              <div className="flex flex-wrap gap-2">
                <a
                  href={p.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary btn-sm min-h-11"
                >
                  🧾 {t("actions.receipt")}
                </a>
                {p.method === "CHEQUE" && p.status === "PENDING" && perms.has("payment:void") && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => confirm.mutate({ id: p.id })}
                  >
                    {tc("paymentsList.confirmCheque")}
                  </Button>
                )}
                {p.method === "CHEQUE" && p.status !== "FAILED" && perms.has("payment:void") && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setAction({ kind: "fail", id: p.id, max: 0 })}
                  >
                    {tc("paymentsList.failCheque")}
                  </Button>
                )}
                {p.unallocated > 0 && p.status === "CONFIRMED" && perms.has("payment:refund") && (
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
                    variant="danger"
                    onClick={() => setAction({ kind: "void", id: p.id, max: 0 })}
                  >
                    {tc("paymentsList.void")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
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
