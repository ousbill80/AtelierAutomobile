"use client";

// Encaisser une facture depuis la caisse (/caisse) ou la liste des paiements
// (/caisse/paiements), sans passer par Facturation : recherche parmi les factures
// émises non soldées (numéro, client, plaque), puis la modale d'encaissement de la facture.
import { useState } from "react";
import { HandCoins, Search } from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, Input, Modal } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { EncaisserModal } from "./encaisser-modal";
import { t } from "./i18n";

type OpenInvoice = {
  id: string;
  number: string | null;
  balance: number;
  customer: { id: string; displayName: string };
  vehicle: { plate: string | null; make: string | null; model: string | null } | null;
};

export function CollectInvoiceButton({
  onDone,
  variant = "primary",
}: {
  onDone?: () => void;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<OpenInvoice | null>(null);
  const close = () => {
    setOpen(false);
    setSelected(null);
  };
  return (
    <>
      <Button variant={variant} className="min-h-11" onClick={() => setOpen(true)}>
        <HandCoins size={16} aria-hidden /> {t("collectInvoice.button")}
      </Button>
      {open && !selected && <InvoicePicker onClose={close} onPick={setSelected} />}
      {selected && (
        <EncaisserModal
          open
          customerId={selected.customer.id}
          invoiceId={selected.id}
          balance={selected.balance}
          onClose={close}
          onDone={() => onDone?.()}
        />
      )}
    </>
  );
}

function InvoicePicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (invoice: OpenInvoice) => void;
}) {
  const [search, setSearch] = useState("");
  const q = trpc.invoice.list.useQuery({
    view: "open",
    q: search.trim() || undefined,
    limit: 20,
  });
  const items = ((q.data?.items ?? []) as OpenInvoice[]).filter((i) => i.balance > 0);
  return (
    <Modal open title={t("collectInvoice.title")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Input
          label={t("collectInvoice.search")}
          placeholder={t("collectInvoice.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        {q.isLoading ? (
          <ListSkeleton />
        ) : q.isError ? (
          <ErrorBox onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={search.trim() ? t("collectInvoice.noMatch") : t("collectInvoice.empty")}
          />
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {items.map((invoice) => {
              const vehicle = invoice.vehicle
                ? [invoice.vehicle.plate, invoice.vehicle.make, invoice.vehicle.model]
                    .filter(Boolean)
                    .join(" · ")
                : "";
              return (
                <li key={invoice.id}>
                  <button
                    type="button"
                    onClick={() => onPick(invoice)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {invoice.customer.displayName}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {[invoice.number, vehicle].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xs text-muted">
                        {t("collectInvoice.balance")}
                      </span>
                      <span className="block font-semibold">{formatFCFA(invoice.balance)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="flex items-center gap-2 text-xs text-muted">
          <Search size={14} aria-hidden /> {t("collectInvoice.hint")}
        </p>
      </div>
    </Modal>
  );
}
