"use client";

// Avant un encaissement hors espèces : le compte de trésorerie du mode doit déjà exister.
import Link from "next/link";
import { paymentAccountBlock } from "@atelieros/core/treasury";
import { trpc } from "@/trpc/react";
import { t } from "./i18n";

export function usePaymentAccountBlock(method: string, paidOn: string) {
  const needsAccount = method !== "CASH";
  const q = trpc.payment.collectionAccounts.useQuery(undefined, { enabled: needsAccount });
  if (!needsAccount) return { message: null as string | null, pending: false };
  if (!q.data) return { message: null, pending: q.isLoading };
  return {
    message: paymentAccountBlock({
      method,
      siteId: "",
      paidOn: paidOn || q.data.today,
      accounts: q.data.accounts,
    }),
    pending: false,
  };
}

export function PaymentAccountNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex flex-col gap-2 text-sm text-status-bad">
      <p>⚠ {message}</p>
      <Link href="/tresorerie" className="btn btn-secondary min-h-11">
        {t("encaisser.createAccount")}
      </Link>
    </div>
  );
}
