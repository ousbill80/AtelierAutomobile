"use client";

// M08 §7 `/caisse/paiements` — registre complet des paiements & encaissements :
// KPIs de ventilation des flux (espèces, mobile money, chèques, virements), filtres avancés,
// recherche en direct, table des transactions avec reçus PDF, confirmation/rejet de chèques,
// remboursements de trop-perçus et annulations sécurisées.
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Building2,
  Clock,
  FileText,
  Printer,
  Receipt,
  Search,
  Smartphone,
  Wallet,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  EmptyState,
  Modal,
  MoneyInput,
  StatusBadge,
  Textarea,
  type StatusTone,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { PAYMENT_METHODS, t, tc } from "@/components/billing/i18n";

type Action = { kind: "void" | "fail" | "refund"; id: string; max: number };

function MethodIcon({ method }: { method: string }) {
  switch (method) {
    case "CASH":
      return <Banknote size={15} className="text-status-ok" />;
    case "WAVE":
    case "ORANGE_MONEY":
    case "MTN_MOMO":
    case "MOOV_MONEY":
    case "MOBILE_MONEY":
      return <Smartphone size={15} className="text-accent" />;
    case "CHEQUE":
      return <FileText size={15} className="text-status-warn" />;
    case "BANK_TRANSFER":
      return <Building2 size={15} className="text-muted" />;
    default:
      return <Wallet size={15} className="text-muted" />;
  }
}

export default function PaymentsPage() {
  const me = trpc.me.get.useQuery();
  const perms = useMemo(() => new Set(me.data?.permissions ?? []), [me.data?.permissions]);
  const [method, setMethod] = useState("");
  const [unallocatedOnly, setUnallocatedOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "CONFIRMED" | "PENDING" | "FAILED">("ALL");
  const [qSearch, setQSearch] = useState("");

  const query = trpc.payment.list.useQuery({
    method: (method || undefined) as never,
    unallocatedOnly: unallocatedOnly || undefined,
    limit: 100,
  });

  const [action, setAction] = useState<Action | null>(null);
  const confirm = trpc.payment.confirmCheque.useMutation({ onSuccess: () => query.refetch() });

  const rawItems = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const summary = query.data?.summary;
  const timeZone = query.data?.timeZone ?? "Africa/Abidjan";

  const filteredItems = useMemo(() => {
    return rawItems.filter((p) => {
      // Filtre statut
      if (statusFilter === "CONFIRMED" && (p.status !== "CONFIRMED" || p.voidedAt)) return false;
      if (statusFilter === "PENDING" && p.status !== "PENDING") return false;
      if (statusFilter === "FAILED" && (p.status !== "FAILED" && !p.voidedAt)) return false;

      // Recherche texte (référence, reçu, client, facture)
      if (qSearch.trim()) {
        const needle = qSearch.trim().toLowerCase();
        const inNumber = p.number?.toLowerCase().includes(needle) ?? false;
        const inRef = p.reference?.toLowerCase().includes(needle) ?? false;
        const inCustomer = p.customer?.displayName?.toLowerCase().includes(needle) ?? false;
        const inInvoices = p.allocations.some((a) =>
          a.invoice.number?.toLowerCase().includes(needle),
        );
        if (!inNumber && !inRef && !inCustomer && !inInvoices) return false;
      }

      return true;
    });
  }, [rawItems, statusFilter, qSearch]);

  const hasFilter = Boolean(method || unallocatedOnly || statusFilter !== "ALL" || qSearch.trim());

  const resetFilters = () => {
    setMethod("");
    setUnallocatedOnly(false);
    setStatusFilter("ALL");
    setQSearch("");
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/caisse"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-2 hover:text-foreground"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Receipt size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {tc("paymentsList.title")}
              </h1>
              {rawItems.length > 0 && (
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">
                  {rawItems.length} transaction{rawItems.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              Journal d&apos;encaissement multi-moyens, ventilation des acomptes et certification des chèques
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/caisse"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
          >
            <Wallet size={14} className="text-muted" />
            <span>Gestion de la Caisse</span>
          </Link>
          <Link
            href="/factures"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
          >
            <FileText size={14} className="text-muted" />
            <span>Factures clients</span>
          </Link>
        </div>
      </div>

      {/* Cartes KPI intelligentes */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Total des encaissements</span>
              <Receipt size={16} className="text-status-ok" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-status-ok">
              {formatFCFA(summary.totalCollected)}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              Transactions confirmées
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Espèces & Guichet</span>
              <Banknote size={16} className="text-muted" />
            </div>
            <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
              {formatFCFA(summary.cashCollected)}
            </div>
            <div className="mt-1 text-[11px] text-muted">Encaissé physiquement</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Mobile Money</span>
              <Smartphone size={16} className="text-accent" />
            </div>
            <div className="mt-2 text-xl font-bold tracking-tight text-accent">
              {formatFCFA(summary.mobileCollected)}
            </div>
            <div className="mt-1 text-[11px] text-muted">Wave, Orange, MTN, Moov</div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Acomptes non affectés</span>
              <Clock size={16} className="text-status-warn" />
            </div>
            <div className="mt-2 text-xl font-bold tracking-tight text-status-warn">
              {formatFCFA(summary.totalUnallocated)}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              Crédits clients en attente
            </div>
          </div>
        </div>
      )}

      {/* Barre d'outils et filtres */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-3 shadow-xs">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Rechercher par référence, reçu, client ou facture..."
              value={qSearch}
              onChange={(e) => setQSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-border/80 bg-surface pl-8 pr-8 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {qSearch && (
              <button
                type="button"
                onClick={() => setQSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Mode de règlement */}
            <select
              aria-label={t("encaisser.method")}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-9 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
            >
              <option value="">{tc("paymentsList.allMethods")}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`method.${m}`)}
                </option>
              ))}
            </select>

            {/* Filtre statut */}
            <select
              aria-label="Statut"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-9 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
            >
              <option value="ALL">Tous les statuts</option>
              <option value="CONFIRMED">Confirmés</option>
              <option value="PENDING">En attente (chèques)</option>
              <option value="FAILED">Annulés / Rejetés</option>
            </select>

            {/* Toggle non affectés */}
            <button
              type="button"
              onClick={() => setUnallocatedOnly(!unallocatedOnly)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all ${
                unallocatedOnly
                  ? "border-status-warn bg-status-warn-bg text-status-warn shadow-xs"
                  : "border-border/80 bg-surface text-muted hover:text-foreground"
              }`}
            >
              <Clock size={13} />
              <span>Acomptes seuls</span>
            </button>

            {hasFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-surface-2 px-2.5 text-xs font-medium text-muted hover:text-foreground"
              >
                <X size={13} />
                <span>Effacer</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {confirm.error && (
        <div className="flex items-center gap-2 rounded-xl border border-status-bad/40 bg-status-bad-bg/20 p-3 text-xs text-status-bad">
          <AlertCircle size={15} className="shrink-0" />
          <span>{confirm.error.message}</span>
        </div>
      )}

      {query.isLoading ? (
        <ListSkeleton rows={5} />
      ) : query.isError || !query.data ? (
        <ErrorBox onRetry={() => query.refetch()} message={t("loadError")} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title={tc("paymentsList.empty")}
          description={
            hasFilter
              ? "Aucun règlement ne correspond à vos filtres actuels."
              : "Les règlements apparaîtront ici dès qu'un encaissement est enregistré."
          }
          action={
            hasFilter ? (
              <Button variant="secondary" onClick={resetFilters}>
                Réinitialiser les filtres
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-3.5 pl-4 pr-3">N° Reçu / Réf</th>
                  <th className="px-3 py-3.5">Client & Date</th>
                  <th className="px-3 py-3.5">Mode de règlement</th>
                  <th className="px-3 py-3.5">Affectation</th>
                  <th className="px-3 py-3.5 text-right">Montant</th>
                  <th className="px-3 py-3.5 text-center">Statut</th>
                  <th className="py-3.5 pl-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredItems.map((p) => {
                  let tone: StatusTone = "ok";
                  let statusLabel = "Confirmé";

                  if (p.voidedAt) {
                    tone = "off";
                    statusLabel = t("payments.voided");
                  } else if (p.status === "PENDING") {
                    tone = "warn";
                    statusLabel = t("payments.pending");
                  } else if (p.status === "FAILED") {
                    tone = "bad";
                    statusLabel = "Rejeté";
                  }

                  return (
                    <tr
                      key={p.id}
                      className="group transition-colors hover:bg-surface-2/40"
                    >
                      {/* Numéro reçu & référence */}
                      <td className="py-3.5 pl-4 pr-3">
                        <div className="flex flex-col">
                          <span className="font-mono font-bold text-foreground">
                            {p.number ?? "—"}
                          </span>
                          {p.reference && (
                            <span className="font-mono text-xs text-muted">
                              Réf: {p.reference}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Client & Date */}
                      <td className="px-3 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground">
                            {p.customer?.displayName ?? "Client comptoir"}
                          </span>
                          <span className="text-xs text-muted">
                            {formatDateTime(p.receivedAt, timeZone)}
                          </span>
                        </div>
                      </td>

                      {/* Mode de règlement */}
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                            <MethodIcon method={p.method} />
                          </div>
                          <span className="text-xs font-semibold text-foreground">
                            {t(`method.${p.method}`)}
                          </span>
                        </div>
                      </td>

                      {/* Affectation / Factures / Acomptes */}
                      <td className="px-3 py-3.5">
                        <div className="flex flex-col gap-1 text-xs">
                          {p.allocations.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {p.allocations.map((a) => (
                                <Link
                                  key={a.invoice.id}
                                  href={`/factures/${a.invoice.id}`}
                                  className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent hover:underline"
                                >
                                  {a.invoice.number} ({formatFCFA(a.amount)})
                                </Link>
                              ))}
                            </div>
                          )}
                          {p.unallocated > 0 && (
                            <span className="font-semibold text-status-warn">
                              Acompte non affecté : {formatFCFA(p.unallocated)}
                            </span>
                          )}
                          {p.allocations.length === 0 && p.unallocated === 0 && (
                            <span className="text-muted">—</span>
                          )}
                        </div>
                      </td>

                      {/* Montant */}
                      <td className="px-3 py-3.5 text-right font-bold tabular-nums text-foreground">
                        {formatFCFA(p.amount)}
                      </td>

                      {/* Statut */}
                      <td className="px-3 py-3.5 text-center">
                        <div className="flex justify-center">
                          <StatusBadge tone={tone} label={statusLabel} />
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 pl-3 pr-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Reçu PDF */}
                          <a
                            href={p.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2 text-xs font-medium text-foreground transition-all hover:bg-surface-2 hover:border-accent"
                            title={t("actions.receipt")}
                          >
                            <Printer size={13} className="text-muted" />
                            <span>Reçu</span>
                          </a>

                          {/* Valider chèque */}
                          {p.method === "CHEQUE" &&
                            p.status === "PENDING" &&
                            perms.has("payment:void") && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-8 text-xs font-medium"
                                onClick={() => confirm.mutate({ id: p.id })}
                              >
                                {tc("paymentsList.confirmCheque")}
                              </Button>
                            )}

                          {/* Rejeter chèque */}
                          {p.method === "CHEQUE" &&
                            p.status !== "FAILED" &&
                            perms.has("payment:void") && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-8 text-xs font-medium text-status-bad"
                                onClick={() => setAction({ kind: "fail", id: p.id, max: 0 })}
                              >
                                Rejeter
                              </Button>
                            )}

                          {/* Rembourser acompte */}
                          {p.unallocated > 0 &&
                            p.status === "CONFIRMED" &&
                            perms.has("payment:refund") && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-8 text-xs font-medium text-status-warn"
                                onClick={() =>
                                  setAction({ kind: "refund", id: p.id, max: p.unallocated })
                                }
                              >
                                Rembourser
                              </Button>
                            )}

                          {/* Annuler paiement */}
                          {!p.voidedAt && p.status !== "FAILED" && perms.has("payment:void") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs text-status-bad hover:bg-status-bad-bg/20"
                              onClick={() => setAction({ kind: "void", id: p.id, max: 0 })}
                            >
                              Annuler
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modale d'action sécurisée avec motif obligatoire */}
      {action && (
        <ActionModal
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            void query.refetch();
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
      <div className="flex flex-col gap-4 text-sm">
        {action.kind === "refund" && (
          <>
            <MoneyInput
              label={tc("paymentsList.refundAmount")}
              value={amount}
              onChange={setAmount}
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-foreground">
                Mode de remboursement
              </label>
              <select
                aria-label={t("encaisser.method")}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-10 rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:border-accent focus:outline-none"
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm} value={pm}>
                    {t(`method.${pm}`)}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-foreground">
            {action.kind === "refund"
              ? tc("paymentsList.refundReason")
              : tc("paymentsList.voidReason")}{" "}
            (obligatoire)
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ex : Erreur de saisie de caisse, chèque sans provision retourné par la banque..."
          />
        </div>

        {m.error && (
          <div className="flex items-center gap-2 rounded-lg border border-status-bad/40 bg-status-bad-bg/20 p-2.5 text-xs text-status-bad">
            <AlertCircle size={14} className="shrink-0" />
            <span>{m.error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
