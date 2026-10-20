"use client";

// M08 §7 `/factures/[id]/encaisser` — modale d'encaissement : gros boutons par mode, montant
// (défaut = solde), référence obligatoire pour mobile money / chèque / virement, reçu.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, Modal, MoneyInput } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { PAYMENT_METHODS, REFERENCE_REQUIRED, t, type PaymentMethod } from "./i18n";

export function EncaisserModal({
  open,
  onClose,
  onDone,
  customerId,
  invoiceId,
  balance,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  customerId: string;
  invoiceId?: string;
  balance: number;
}) {
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [amount, setAmount] = useState<number | null>(balance || null);
  const [reference, setReference] = useState("");
  const [done, setDone] = useState<{
    number: string;
    receiptUrl: string;
    unallocated: number;
  } | null>(null);
  const create = trpc.payment.create.useMutation({
    onSuccess: (res) => {
      setDone({
        number: res.payment.number,
        receiptUrl: res.receiptUrl,
        unallocated: res.unallocated,
      });
      onDone();
    },
  });
  const needsRef = REFERENCE_REQUIRED.has(method);
  const close = () => {
    setDone(null);
    create.reset();
    onClose();
  };
  return (
    <Modal open={open} title={t("encaisser.title")} onClose={close}>
      {done ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="font-semibold text-status-ok">
            ✓ {t("encaisser.success", { number: done.number })}
          </p>
          {done.unallocated > 0 && (
            <p className="text-sm">
              {t("encaisser.overpaid", { amount: formatFCFA(done.unallocated) })}
            </p>
          )}
          <a
            href={done.receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary min-h-11"
          >
            🧾 {t("encaisser.receipt")}
          </a>
          <Button variant="secondary" onClick={close}>
            {t("back")}
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!amount) return;
            create.mutate({
              customerId,
              currentInvoiceId: invoiceId,
              method,
              amount,
              reference: reference.trim() || undefined,
            });
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("encaisser.method")}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={method === m}
                  onClick={() => setMethod(m)}
                  className={`min-h-11 rounded-md border px-2 text-sm font-medium ${
                    method === m ? "border-accent bg-accent text-white" : "border-border bg-surface"
                  }`}
                >
                  {t(`method.${m}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1 text-sm">
            {t("encaisser.amount")}
            <MoneyInput value={amount} onChange={setAmount} aria-label={t("encaisser.amount")} />
          </label>
          {needsRef && (
            <Input
              label={t("encaisser.reference")}
              hint={t("encaisser.referenceHint")}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
            />
          )}
          {create.error && (
            <div role="alert" className="flex flex-col gap-2 text-sm text-status-bad">
              <p>⚠ {create.error.message}</p>
              {method === "CASH" && /caisse/.test(create.error.message) && (
                <Link href="/caisse" className="btn btn-secondary min-h-11">
                  {t("encaisser.openCash")}
                </Link>
              )}
            </div>
          )}
          <Button
            type="submit"
            loading={create.isPending}
            disabled={!amount || (needsRef && !reference.trim())}
          >
            {t("encaisser.submit")}
          </Button>
        </form>
      )}
    </Modal>
  );
}
