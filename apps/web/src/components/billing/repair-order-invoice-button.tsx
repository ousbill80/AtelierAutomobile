"use client";

// US-M08-01 — sur la fiche d'un OR prêt ou restitué : « Facturer » (brouillon créé en un clic)
// ou « Voir la facture » si elle existe déjà.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "./i18n";

export function RepairOrderInvoiceButton({
  repairOrderId,
  canCreate,
}: {
  repairOrderId: string;
  canCreate: boolean;
}) {
  const router = useRouter();
  const invoices = trpc.invoice.forRepairOrder.useQuery({ repairOrderId });
  const create = trpc.invoice.createFromRepairOrder.useMutation({
    onSuccess: (res) => {
      const target = res.customerInvoice ?? res.insuranceInvoice;
      if (target) router.push(`/factures/${target.id}`);
    },
  });
  const current = invoices.data?.find(
    (i) => i.type === "INVOICE" && i.billTo === "CUSTOMER" && i.status !== "VOID",
  );
  if (invoices.isLoading) return null;
  if (current) {
    return (
      <Link href={`/factures/${current.id}`} className="btn btn-secondary btn-sm min-h-11 shrink-0">
        {current.number ? t("ro.invoiced", { number: current.number }) : t("ro.draft")}
      </Link>
    );
  }
  if (!canCreate) return null;
  return (
    <>
      <Button
        size="sm"
        className="min-h-11 shrink-0"
        loading={create.isPending}
        onClick={() => create.mutate({ repairOrderId })}
      >
        {t("actions.invoiceRo")}
      </Button>
      {create.error && (
        <span role="alert" className="text-sm text-status-bad">
          ⚠ {create.error.message}
        </span>
      )}
    </>
  );
}
