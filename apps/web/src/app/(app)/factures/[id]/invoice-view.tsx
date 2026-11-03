"use client";

// M08 §7 — /factures/[id] : en-tête (statut + FNE), client / véhicule, lignes, totaux, paiements,
// avoirs, bloc FNE ; actions Émettre, Encaisser, Avoir, PDF, Supprimer le brouillon, FNE ;
// lien de paiement mobile money, envoi au client et lien portail (4.3).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { amountInWords, formatFCFA } from "@atelieros/core/money";
import { Button, CheckboxRow, Modal, PlateBadge, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { PortalLinksPanel } from "@/components/portal/portal-links-panel";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay } from "@/components/repair-orders/i18n";
import { FneBadge, InvoiceStatusBadge } from "@/components/billing/badges";
import { EncaisserModal } from "@/components/billing/encaisser-modal";
import { FnePanel } from "@/components/billing/fne-panel";
import { PaymentLinkActions, PaymentLinksList } from "@/components/billing/payment-links-panel";
import { t } from "@/components/billing/i18n";
import { InvoiceDraftForm } from "./draft-form";

const OPEN = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];

export function InvoiceView({ id }: { id: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const q = trpc.invoice.get.useQuery({ id });
  const [modal, setModal] = useState<"issue" | "pay" | "credit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const canEdit = isDraft && !isCredit && inv.type !== "DEPOSIT" && perms.has("invoice:create");
  const terms = isCredit
    ? t("terms.credit")
    : d.customer.paymentTermsDays > 0
      ? t("terms.days", { days: d.customer.paymentTermsDays })
      : t("terms.cash");

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 pb-8">
      <Link href="/factures" className="inline-flex min-h-11 items-center text-sm text-accent">
        ← {t("back")}
      </Link>
      <header className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">
              {t(`type.${inv.type}`)}
              {inv.billTo === "INSURANCE" ? ` · ${t("billTo.INSURANCE")}` : ""}
            </h1>
            <InvoiceStatusBadge status={inv.status} />
            {!isDraft && <FneBadge status={inv.fneStatus} />}
          </div>
          <p className="text-sm text-muted">
            <span className="font-mono" data-testid="invoice-number">
              {inv.number ?? t("draft")}
            </span>
            {d.site?.name ? ` · ${d.site.name}` : ""}
          </p>
        </div>

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
          <PaymentLinkActions
            invoice={inv}
            permissions={perms}
            timeZone={d.timeZone}
            onChanged={refresh}
          />
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
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t("actions.deleteDraft")}
            </Button>
          )}
        </div>
      </header>
      <FnePanel
        invoice={inv}
        mode={d.fneMode}
        canManage={perms.has("fne:manage")}
        timeZone={d.timeZone}
        onChanged={refresh}
      />
      {remove.error && (
        <p role="alert" className="text-sm text-status-bad">
          ⚠ {remove.error.message}
        </p>
      )}

      {canEdit ? (
        <InvoiceDraftForm
          key={inv.updatedAt.toISOString()}
          timeZone={d.timeZone}
          vatEnabled={d.vatEnabled}
          terms={terms}
          canSearchProducts={perms.has("stock:read")}
          invoice={{
            id: inv.id,
            dueDate: inv.dueDate,
            notes: inv.notes,
            mileage: inv.mileage,
          }}
          lines={d.lines}
          customer={d.customer}
          vehicle={d.vehicle}
          repairOrder={d.repairOrder}
          creditedInvoice={d.creditedInvoice}
          onSaved={refresh}
        />
      ) : (
        <>
          <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_16rem] lg:items-start">
              <div className="min-w-0">
                <p className="text-xs font-medium tracking-wide text-muted uppercase">
                  {t("fields.customer")}
                </p>
                <Link
                  href={`/clients/${d.customer.id}`}
                  className="mt-1 block text-lg font-semibold text-accent"
                >
                  {d.customer.displayName}
                </Link>
                <p className="mt-1 text-sm text-muted">
                  {[
                    d.customer.phone,
                    d.customer.address,
                    d.customer.ncc ? `NCC ${d.customer.ncc}` : null,
                    d.customer.rccm ? `RCCM ${d.customer.rccm}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  {d.vehicle ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <PlateBadge plate={d.vehicle.plate} />
                      <span>
                        {d.vehicle.make} {d.vehicle.model}
                        {inv.mileage != null ? ` · ${inv.mileage.toLocaleString("fr-FR")} km` : ""}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted">{t("sheet.emptyDate")}</span>
                  )}
                  {d.repairOrder && (
                    <Link href={`/ordres/${d.repairOrder.id}`} className="font-medium text-accent">
                      {d.repairOrder.number}
                    </Link>
                  )}
                  {d.creditedInvoice && (
                    <Link
                      href={`/factures/${d.creditedInvoice.id}`}
                      className="font-medium text-accent"
                    >
                      {t("sheet.origin")} {d.creditedInvoice.number}
                    </Link>
                  )}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-1">
                <div>
                  <dt className="text-muted">{t("fields.date")}</dt>
                  <dd className="font-medium">
                    {inv.issuedAt ? formatDay(inv.issuedAt, d.timeZone) : t("sheet.emptyDate")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{t("fields.dueDate")}</dt>
                  <dd className="font-medium">
                    {!isCredit && inv.dueDate
                      ? formatDay(inv.dueDate, "UTC")
                      : t("sheet.emptyDate")}
                  </dd>
                </div>
                {!isDraft && !isCredit && (
                  <div className="col-span-2 lg:col-span-1">
                    <dt className="text-muted">{t("totals.balance")}</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {formatFCFA(inv.balance)}
                    </dd>
                  </div>
                )}
                <div className="col-span-2 lg:col-span-1">
                  <dt className="text-muted">{t("sheet.conditions")}</dt>
                  <dd className="text-muted">{terms}</dd>
                  {inv.notes && <dd className="mt-1 whitespace-pre-wrap">{inv.notes}</dd>}
                </div>
              </dl>
            </div>
          </section>

          <section
            className="rounded-lg border border-border bg-surface p-4"
            aria-label={t("sheet.lines")}
          >
            <h2 className="text-base font-semibold">{t("sheet.lines")}</h2>
            <InvoiceLines lines={d.lines} vatEnabled={d.vatEnabled} />
            <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
              <p className="text-sm text-muted">
                {t("totals.inWords", { words: amountInWords(Math.abs(inv.total)) })}
              </p>
              <dl className="w-full text-sm sm:w-64">
                {inv.discountTotal !== 0 && (
                  <div className="flex justify-between gap-6 py-1">
                    <dt className="text-muted">{t("totals.discount")}</dt>
                    <dd>−{formatFCFA(inv.discountTotal)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-6 py-1">
                  <dt className="text-muted">{t("totals.subtotal")}</dt>
                  <dd>{formatFCFA(inv.subtotal)}</dd>
                </div>
                <div className="flex justify-between gap-6 py-1">
                  <dt className="text-muted">{t("totals.vat")}</dt>
                  <dd>{formatFCFA(inv.vatTotal)}</dd>
                </div>
                <div
                  className="mt-1 flex justify-between gap-6 border-t border-border py-2 text-base font-semibold"
                  data-testid="invoice-total"
                >
                  <dt>{t("totals.total")}</dt>
                  <dd>{formatFCFA(inv.total)}</dd>
                </div>
                {!isDraft && !isCredit && (
                  <>
                    <div className="flex justify-between gap-6 py-1">
                      <dt className="text-muted">{t("totals.paid")}</dt>
                      <dd>{formatFCFA(inv.amountPaid)}</dd>
                    </div>
                    {inv.creditedAmount > 0 && (
                      <div className="flex justify-between gap-6 py-1">
                        <dt className="text-muted">{t("totals.credited")}</dt>
                        <dd>−{formatFCFA(inv.creditedAmount)}</dd>
                      </div>
                    )}
                    {d.pendingCheques > 0 && (
                      <p className="py-1 text-status-warn">
                        ⏳ {t("totals.pendingCheques", { amount: formatFCFA(d.pendingCheques) })}
                      </p>
                    )}
                    <div
                      className="flex justify-between gap-6 border-t border-border py-2 text-base font-semibold"
                      data-testid="invoice-balance"
                    >
                      <dt>{t("totals.balance")}</dt>
                      <dd>{formatFCFA(inv.balance)}</dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
          </section>
        </>
      )}

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

      {!isDraft && !isCredit && (
        <PaymentLinksList
          invoiceId={inv.id}
          timeZone={d.timeZone}
          canManage={perms.has("message:send")}
          onChanged={refresh}
        />
      )}
      {!isDraft && !isCredit && (
        <PortalLinksPanel
          scope="INVOICE"
          targetId={inv.id}
          canWrite={perms.has("invoice:read") && perms.has("message:send")}
        />
      )}

      {confirmDelete && (
        <Modal
          open
          title={t("deleteDraftConfirm.title")}
          onClose={() => setConfirmDelete(false)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                {t("actions.cancel")}
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate({ id })}
              >
                {t("actions.deleteDraft")}
              </Button>
            </div>
          }
        >
          <p className="text-sm">{t("deleteDraftConfirm.body")}</p>
          {remove.error && (
            <p role="alert" className="mt-2 text-sm text-status-bad">
              ⚠ {remove.error.message}
            </p>
          )}
        </Modal>
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

function formatQty(quantity: number) {
  return quantity.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

type SheetLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  lineSubtotal: number;
  lineTotal: number;
};

function InvoiceLines({ lines, vatEnabled }: { lines: SheetLine[]; vatEnabled: boolean }) {
  return (
    <>
      <div className="mt-4 hidden min-w-0 overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="w-8 py-2 pr-2 font-medium">{t("lines.index")}</th>
              <th className="py-2 pr-2 font-medium">{t("lines.description")}</th>
              <th className="py-2 pr-2 text-right font-medium">{t("lines.quantity")}</th>
              <th className="py-2 pr-2 text-right font-medium">{t("lines.unitPriceShort")}</th>
              <th className="py-2 pr-2 text-right font-medium">{t("lines.discount")}</th>
              {vatEnabled && <th className="py-2 pr-2 text-right font-medium">{t("lines.vat")}</th>}
              <th className="py-2 pr-2 text-right font-medium">{t("lines.ht")}</th>
              <th className="py-2 text-right font-medium">{t("lines.ttc")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.id} className="border-b border-border">
                <td className="py-2 pr-2 text-muted">{index + 1}</td>
                <td className="py-2 pr-2">{line.description}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatQty(line.quantity)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatFCFA(line.unitPrice)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{line.discountRate}</td>
                {vatEnabled && (
                  <td className="py-2 pr-2 text-right tabular-nums">{line.vatRate}</td>
                )}
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatFCFA(line.lineSubtotal)}
                </td>
                <td className="py-2 text-right font-medium tabular-nums">
                  {formatFCFA(line.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-border md:hidden">
        {lines.map((line, index) => (
          <li key={line.id} className="flex flex-col gap-1 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words font-medium">
                {index + 1}. {line.description}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatFCFA(line.lineTotal)}
              </span>
            </div>
            <p className="text-xs text-muted">
              {formatQty(line.quantity)} × {formatFCFA(line.unitPrice)}
              {line.discountRate > 0 ? ` · −${line.discountRate} %` : ""}
              {vatEnabled ? ` · TVA ${line.vatRate} %` : ""}
              {" · "}
              {t("lines.ht")} {formatFCFA(line.lineSubtotal)}
            </p>
          </li>
        ))}
      </ul>
    </>
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
