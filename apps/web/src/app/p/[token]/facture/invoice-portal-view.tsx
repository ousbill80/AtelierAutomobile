"use client";

// M14 US-M14-03 / RG-M14-13..15 — page facture publique (mobile d'abord) : en-tête du garage,
// lignes, totaux, déjà payé, solde, QR et n° FNE si certifiée, PDF, boutons « Payer avec Wave /
// Orange Money / MTN / Moov ». « Payé » n'apparaît qu'une fois le paiement confirmé par le
// fournisseur (webhook ou vérification) ; après 2 min : « ne repayez pas ».
import { useState } from "react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { formatDay } from "@/components/repair-orders/i18n";
import { t } from "@/i18n/t";

const POLL_MS = 5_000;

export function InvoicePortalView({ token }: { token: string }) {
  const query = trpc.portal.invoice.get.useQuery(
    { token },
    { retry: false, refetchOnWindowFocus: false },
  );
  const [started, setStarted] = useState(false);
  const view = query.data;
  const waiting = started || !!view?.pending;
  const status = trpc.portal.invoice.paymentStatus.useQuery(
    { token },
    {
      enabled: !!view && waiting && view.invoice.balance > 0,
      refetchInterval: (q) => (q.state.data?.paid ? false : POLL_MS),
      retry: false,
    },
  );
  const pay = trpc.portal.invoice.pay.useMutation({
    onSuccess: ({ url }) => {
      setStarted(true);
      window.location.assign(url);
    },
  });

  if (query.isLoading) {
    return (
      <main className="mx-auto w-full max-w-lg p-4" aria-busy="true">
        <p className="sr-only">{t("invoicePortal.loading")}</p>
        <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
      </main>
    );
  }
  if (query.isError || !view) {
    const expired = query.error?.message.includes("LINK_EXPIRED");
    return (
      <main className="mx-auto flex max-w-lg flex-col gap-3 p-6 text-center text-base">
        <p role="alert" className="text-status-bad">
          {expired ? t("invoicePortal.expired") : t("invoicePortal.invalid")}
        </p>
      </main>
    );
  }

  const inv = view.invoice;
  const live = status.data;
  const paid = live ? live.paid : inv.status === "PAID";
  const balance = live ? live.balance : inv.balance;
  const amountPaid = live ? live.amountPaid : inv.amountPaid;
  const overdue = live?.pending?.overdue ?? view.pending?.overdue ?? false;
  const stillPending = live ? !!live.pending : !!view.pending;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-lg flex-col gap-4 p-4 pb-16 text-base">
      <header className="flex flex-col gap-1">
        <p className="text-lg font-semibold">{view.garage.name}</p>
        <p className="text-sm text-muted">
          {[view.garage.address, view.garage.phone].filter(Boolean).join(" · ")}
        </p>
        <p className="text-xs text-muted">
          {[
            view.garage.rccm ? t("invoicePortal.rccm", { value: view.garage.rccm }) : null,
            view.garage.ncc ? t("invoicePortal.ncc", { value: view.garage.ncc }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold" data-testid="portal-invoice-number">
            {inv.type === "DEPOSIT" ? t("invoicePortal.deposit") : t("invoicePortal.invoice")}{" "}
            {inv.number}
          </h1>
          {view.voided ? (
            <StatusBadge tone="off" label={`✕ ${t("invoicePortal.voided")}`} />
          ) : paid ? (
            <StatusBadge tone="ok" label={`✓ ${t("invoicePortal.statusPaid")}`} />
          ) : (
            <StatusBadge tone="warn" label={`⏳ ${t("invoicePortal.statusDue")}`} />
          )}
        </div>
        <p className="text-sm text-muted">
          {inv.issuedAt && `${t("invoicePortal.date")} ${formatDay(inv.issuedAt, view.timeZone)}`}
          {inv.dueDate && !paid
            ? ` · ${t("invoicePortal.dueDate")} ${formatDay(inv.dueDate, "UTC")}`
            : ""}
        </p>
        {inv.vehicle && (
          <p className="text-sm">
            {t("invoicePortal.vehicle")} : {inv.vehicle.make} {inv.vehicle.model} ·{" "}
            {inv.vehicle.plate}
          </p>
        )}
      </section>

      {view.voided && (
        <p role="status" className="rounded-md bg-surface-2 p-3">
          {t("invoicePortal.voided")}
        </p>
      )}

      <section className="flex flex-col gap-2" aria-label={t("invoicePortal.lines")}>
        <h2 className="font-semibold">{t("invoicePortal.lines")}</h2>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {inv.lines.map((l) => (
            <li key={l.id} className="flex flex-col gap-1 p-3 text-sm">
              <span className="break-words">{l.description}</span>
              <span className="flex flex-wrap justify-between gap-2 text-muted">
                <span>
                  {t("invoicePortal.qty")} {l.quantity.toLocaleString("fr-FR")} ×{" "}
                  {formatFCFA(l.unitPrice)}
                  {l.discountRate > 0 ? ` · −${l.discountRate} %` : ""}
                </span>
                <span className="font-semibold text-fg">{formatFCFA(l.total)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col items-end gap-1 rounded-lg border border-border bg-surface p-3 text-sm">
        {inv.discountTotal !== 0 && (
          <span>
            {t("invoicePortal.discount")} : −{formatFCFA(inv.discountTotal)}
          </span>
        )}
        <span>
          {t("invoicePortal.subtotal")} : {formatFCFA(inv.subtotal)}
        </span>
        <span>
          {t("invoicePortal.vat")} : {formatFCFA(inv.vatTotal)}
        </span>
        <span className="text-base font-semibold">
          {t("invoicePortal.total")} : {formatFCFA(inv.total)}
        </span>
        <span>
          {t("invoicePortal.paid")} : {formatFCFA(amountPaid)}
        </span>
        <span className="text-lg font-semibold" data-testid="portal-invoice-balance">
          {t("invoicePortal.balance")} : {formatFCFA(balance)}
        </span>
      </section>

      <section className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-3 text-center text-sm">
        <h2 className="font-semibold">{t("invoicePortal.fneTitle")}</h2>
        {view.fne.certified ? (
          <>
            {view.fne.qrImage && (
              <img src={view.fne.qrImage} alt="QR code FNE" width={160} height={160} />
            )}
            {view.fne.number && <p>{t("invoicePortal.fneNumber", { number: view.fne.number })}</p>}
          </>
        ) : (
          <p className="text-muted">{t("invoicePortal.fnePending")}</p>
        )}
        <a
          href={`/api/portail/${token}/facture/pdf`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-secondary min-h-11"
        >
          📄 {t("invoicePortal.pdf")}
        </a>
      </section>

      {paid && (
        <p
          role="status"
          className="rounded-md bg-status-ok-bg p-3 font-semibold text-status-ok"
          data-testid="portal-paid"
        >
          {t("invoicePortal.paidBadge")}{" "}
          {view.lastPayment || live
            ? t("invoicePortal.thanks", { amount: formatFCFA(amountPaid) })
            : ""}
        </p>
      )}

      {!paid && !view.voided && balance > 0 && waiting && stillPending && (
        <p role="status" className="rounded-md bg-surface-2 p-3">
          {overdue ? `⚠ ${t("invoicePortal.notConfirmed")}` : `⏳ ${t("invoicePortal.waiting")}`}
        </p>
      )}

      {!paid && view.payable && balance > 0 && (
        <section className="flex flex-col gap-2" aria-label={t("invoicePortal.payTitle")}>
          <h2 className="font-semibold">{t("invoicePortal.payTitle")}</h2>
          {view.methods.map((m) => (
            <Button
              key={m}
              className="min-h-12 w-full"
              loading={pay.isPending && pay.variables?.method === m}
              disabled={pay.isPending}
              onClick={() => pay.mutate({ token, method: m })}
            >
              {t("invoicePortal.payWith", {
                amount: formatFCFA(balance),
                method: t(`invoicePortal.methods.${m}`),
              })}
            </Button>
          ))}
          {pay.error && (
            <p role="alert" className="text-status-bad">
              ⚠ {pay.error.message}
            </p>
          )}
        </section>
      )}

      {!paid && view.merchantNumbers && balance > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <h2 className="font-semibold">{t("invoicePortal.merchantTitle")}</h2>
          <ul className="flex flex-col gap-1">
            {(["wave", "orangeMoney", "mtn", "moov"] as const)
              .filter((k) => view.merchantNumbers?.[k])
              .map((k) => (
                <li key={k}>
                  {t(`invoicePortal.merchant.${k}`)} : <strong>{view.merchantNumbers?.[k]}</strong>
                </li>
              ))}
          </ul>
          <p>{t("invoicePortal.merchantHint", { number: inv.number ?? "" })}</p>
          {Object.values(view.merchantNumbers).every((v) => !v) && (
            <p className="text-muted">{t("invoicePortal.unavailable")}</p>
          )}
        </section>
      )}

      {view.garage.phone && (
        <a href={`tel:${view.garage.phone}`} className="btn btn-secondary min-h-11 text-center">
          📞 {t("invoicePortal.call")}
        </a>
      )}
    </main>
  );
}
