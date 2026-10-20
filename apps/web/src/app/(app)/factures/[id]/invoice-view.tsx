"use client";

// M08 §7 — /factures/[id] : en-tête (statut + FNE), client / véhicule, lignes, totaux, paiements,
// avoirs, bloc FNE ; actions Émettre, Encaisser, Avoir, PDF, Supprimer le brouillon, FNE.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { amountInWords, formatFCFA } from "@atelieros/core/money";
import { Button, CheckboxRow, Modal, PlateBadge, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay } from "@/components/repair-orders/i18n";
import { FneBadge, InvoiceStatusBadge } from "@/components/billing/badges";
import { EncaisserModal } from "@/components/billing/encaisser-modal";
import { FnePanel } from "@/components/billing/fne-panel";
import { t } from "@/components/billing/i18n";

const OPEN = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];

export function InvoiceView({ id }: { id: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const q = trpc.invoice.get.useQuery({ id });
  const [modal, setModal] = useState<"issue" | "pay" | "credit" | null>(null);
  const refresh = () => utils.invoice.get.invalidate({ id });
  const remove = trpc.invoice.deleteDraft.useMutation({
    onSuccess: () => router.push("/factures"),
  });

  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.isError || !q.data)
    return <ErrorBox onRetry={() => q.refetch()} message={q.error?.message ?? t("loadError")} />;
  const d = q.data;
  const inv = d.invoice;
  const isDraft = inv.status === "DRAFT";
  const isCredit = inv.type === "CREDIT_NOTE";

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-4">
      <Link href="/factures" className="text-sm text-accent">
        ← {t("back")}
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl font-semibold" data-testid="invoice-number">
            {inv.number ?? t("draft")}
          </h1>
          <span className="text-sm font-semibold">{t(`type.${inv.type}`)}</span>
          {inv.billTo === "INSURANCE" && <span className="text-sm">{t("billTo.INSURANCE")}</span>}
          <InvoiceStatusBadge status={inv.status} />
          {!isDraft && <FneBadge status={inv.fneStatus} />}
        </div>
        <p className="text-sm text-muted">
          {d.site?.name}
          {inv.issuedAt ? ` · ${t("fields.date")} ${formatDay(inv.issuedAt, d.timeZone)}` : ""}
          {inv.dueDate && !isCredit
            ? ` · ${t("fields.dueDate")} ${formatDay(inv.dueDate, "UTC")}`
            : ""}
        </p>
      </header>

      <FnePanel
        invoice={inv}
        mode={d.fneMode}
        canManage={perms.has("fne:manage")}
        timeZone={d.timeZone}
        onChanged={refresh}
      />

      <div className="flex flex-wrap gap-2">
        {isDraft && perms.has("invoice:issue") && (
          <Button onClick={() => setModal("issue")}>{t("actions.issue")}</Button>
        )}
        {OPEN.includes(inv.status) &&
          !isCredit &&
          (inv.billTo === "CUSTOMER" || Boolean(inv.insuranceClaimId)) &&
          perms.has("payment:create") && (
            <Button onClick={() => setModal("pay")}>{t("actions.encaisser")}</Button>
          )}
        <a
          href={`/api/factures/${inv.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-secondary min-h-11"
        >
          📄 {t("actions.pdf")}
        </a>
        {!isDraft && !isCredit && inv.status !== "VOID" && perms.has("invoice:credit_note") && (
          <Button variant="secondary" onClick={() => setModal("credit")}>
            {t("actions.creditNote")}
          </Button>
        )}
        {isDraft && perms.has("invoice:create") && (
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate({ id })}>
            {t("actions.deleteDraft")}
          </Button>
        )}
      </div>
      {remove.error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {remove.error.message}
        </p>
      )}

      <section className="grid gap-3 rounded-lg border border-border bg-surface p-3 text-sm sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted">{t("fields.customer")}</span>
          <Link href={`/clients/${d.customer.id}`} className="font-semibold text-accent">
            {d.customer.displayName}
          </Link>
          {d.customer.phone && <span>{d.customer.phone}</span>}
          {d.customer.ncc && <span>NCC {d.customer.ncc}</span>}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          {d.vehicle && (
            <>
              <span className="text-xs text-muted">{t("fields.vehicle")}</span>
              <span className="flex flex-wrap items-center gap-2">
                <PlateBadge plate={d.vehicle.plate} />
                {d.vehicle.make} {d.vehicle.model}
              </span>
            </>
          )}
          {inv.mileage != null && (
            <span>
              {t("fields.mileage")} : {inv.mileage.toLocaleString("fr-FR")} km
            </span>
          )}
          {d.repairOrder && (
            <Link href={`/ordres/${d.repairOrder.id}`} className="text-accent">
              {t("fields.repairOrder")} {d.repairOrder.number}
            </Link>
          )}
          {d.creditedInvoice && (
            <Link href={`/factures/${d.creditedInvoice.id}`} className="text-accent">
              {t("type.INVOICE")} {d.creditedInvoice.number}
            </Link>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-label={t("lines.title")}>
        <h2 className="font-semibold">{t("lines.title")}</h2>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {d.lines.map((l) => (
            <li
              key={l.id}
              className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0 break-words">{l.description}</span>
              <span className="flex shrink-0 flex-wrap gap-3 text-xs text-muted sm:text-sm">
                <span>
                  {l.quantity.toLocaleString("fr-FR")} × {formatFCFA(l.unitPrice)}
                </span>
                {l.discountRate > 0 && <span>−{l.discountRate} %</span>}
                {d.vatEnabled && <span>TVA {l.vatRate} %</span>}
                <span className="font-semibold text-fg">{formatFCFA(l.lineSubtotal)} HT</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col items-end gap-1 rounded-lg border border-border bg-surface p-3 text-sm">
        {inv.discountTotal !== 0 && (
          <span>
            {t("totals.discount")} : −{formatFCFA(inv.discountTotal)}
          </span>
        )}
        <span>
          {t("totals.subtotal")} : {formatFCFA(inv.subtotal)}
        </span>
        <span>
          {t("totals.vat")} : {formatFCFA(inv.vatTotal)}
        </span>
        <span className="text-base font-semibold" data-testid="invoice-total">
          {t("totals.total")} : {formatFCFA(inv.total)}
        </span>
        <span className="text-xs text-muted">
          {t("totals.inWords", { words: amountInWords(Math.abs(inv.total)) })}
        </span>
        {!isDraft && !isCredit && (
          <>
            <span>
              {t("totals.paid")} : {formatFCFA(inv.amountPaid)}
            </span>
            {inv.creditedAmount > 0 && (
              <span>
                {t("totals.credited")} : −{formatFCFA(inv.creditedAmount)}
              </span>
            )}
            {d.pendingCheques > 0 && (
              <span className="text-status-warn">
                ⏳ {t("totals.pendingCheques", { amount: formatFCFA(d.pendingCheques) })}
              </span>
            )}
            <span className="text-base font-semibold" data-testid="invoice-balance">
              {t("totals.balance")} : {formatFCFA(inv.balance)}
            </span>
          </>
        )}
      </section>

      {!isDraft && !isCredit && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">{t("payments.title")}</h2>
          {d.allocations.length === 0 ? (
            <p className="text-sm text-muted">{t("payments.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {d.allocations.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-2 text-sm"
                >
                  <span>
                    {a.payment ? (
                      <>
                        <span className="font-mono">{a.payment.number}</span> ·{" "}
                        {t(`method.${a.payment.method}`)} ·{" "}
                        {formatDay(a.payment.receivedAt, d.timeZone)}
                        {a.payment.status === "PENDING" && ` · ${t("payments.pending")}`}
                        {a.voidedAt && ` · ${t("payments.voided")}`}
                      </>
                    ) : (
                      t("creditNotes.title")
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={a.voidedAt ? "line-through" : "font-semibold"}>
                      {formatFCFA(a.amount)}
                    </span>
                    {a.payment && (
                      <a
                        href={`/api/caisse/recus/${a.payment.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent"
                      >
                        🧾 {t("actions.receipt")}
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d.creditNotes.length > 0 && (
            <>
              <h2 className="font-semibold">{t("creditNotes.title")}</h2>
              <ul className="flex flex-col gap-1">
                {d.creditNotes.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/factures/${c.id}`}
                      className="flex justify-between rounded-md border border-border bg-surface p-2 text-sm"
                    >
                      <span className="font-mono">{c.number}</span>
                      <span>{formatFCFA(c.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {modal === "issue" && (
        <IssueModal
          id={inv.id}
          deposits={d.availableDeposits}
          missingIdentity={d.missingIdentity}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
      {modal === "pay" && (
        <EncaisserModal
          open
          customerId={d.customer.id}
          invoiceId={inv.id}
          balance={Math.max(0, inv.balance - d.pendingCheques)}
          onClose={() => setModal(null)}
          onDone={refresh}
        />
      )}
      {modal === "credit" && (
        <CreditNoteModal
          invoiceId={inv.id}
          lines={d.lines}
          onClose={() => setModal(null)}
          onDone={(creditNoteId) => router.push(`/factures/${creditNoteId}`)}
        />
      )}
    </div>
  );
}

function IssueModal({
  id,
  deposits,
  missingIdentity,
  onClose,
  onDone,
}: {
  id: string;
  deposits: { id: string; number: string | null; total: number }[];
  missingIdentity: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const issue = trpc.invoice.issue.useMutation({ onSuccess: onDone });
  return (
    <Modal
      open
      title={t("issue.title")}
      onClose={onClose}
      footer={
        <Button
          loading={issue.isPending}
          disabled={missingIdentity.length > 0}
          onClick={() => issue.mutate({ id, applyDepositIds: selected })}
        >
          {t("issue.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {missingIdentity.length > 0 ? (
          <p role="alert" className="text-status-bad">
            ⚠ {t("issue.missingIdentity", { fields: missingIdentity.join(", ") })}
          </p>
        ) : (
          <p>{t("issue.confirm")}</p>
        )}
        {deposits.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium">{t("issue.deposits")}</legend>
            {deposits.map((dep) => (
              <CheckboxRow
                key={dep.id}
                label={`${dep.number} — ${formatFCFA(dep.total)}`}
                checked={selected.includes(dep.id)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSelected((s) => (checked ? [...s, dep.id] : s.filter((x) => x !== dep.id)));
                }}
              />
            ))}
          </fieldset>
        )}
        {issue.error && (
          <p role="alert" className="text-status-bad">
            ⚠ {issue.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

function CreditNoteModal({
  invoiceId,
  lines,
  onClose,
  onDone,
}: {
  invoiceId: string;
  lines: { id: string; description: string; quantity: number }[];
  onClose: () => void;
  onDone: (creditNoteId: string) => void;
}) {
  const [mode, setMode] = useState<"FULL" | "PARTIAL">("FULL");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const create = trpc.invoice.createCreditNote.useMutation({
    onSuccess: (res) => onDone(res.creditNote.id),
  });
  const selection = Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([invoiceLineId, quantity]) => ({ invoiceLineId, quantity }));
  return (
    <Modal
      open
      title={t("credit.title")}
      onClose={onClose}
      footer={
        <Button
          variant="danger"
          loading={create.isPending}
          disabled={reason.trim().length < 3 || (mode === "PARTIAL" && selection.length === 0)}
          onClick={() =>
            create.mutate({ invoiceId, lines: mode === "FULL" ? "FULL" : selection, reason })
          }
        >
          {t("credit.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-2">
          {(["FULL", "PARTIAL"] as const).map((m) => (
            <label key={m} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="credit-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {m === "FULL" ? t("credit.full") : t("credit.partial")}
            </label>
          ))}
        </div>
        {mode === "PARTIAL" && (
          <ul className="flex flex-col gap-2">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  {l.description} (× {l.quantity})
                </span>
                <input
                  type="number"
                  min={0}
                  max={l.quantity}
                  step="any"
                  aria-label={`${t("credit.quantity")} — ${l.description}`}
                  className="input min-h-11 w-20"
                  value={quantities[l.id] ?? ""}
                  onChange={(e) =>
                    setQuantities((q) => ({ ...q, [l.id]: Number(e.target.value) || 0 }))
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <label className="flex flex-col gap-1">
          {t("credit.reason")}
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </label>
        {create.error && (
          <p role="alert" className="text-status-bad">
            ⚠ {create.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}
