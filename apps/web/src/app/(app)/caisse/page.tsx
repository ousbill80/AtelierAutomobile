"use client";

// M08 §7 `/caisse` — Caisse & Règlements : KPIs interactifs, ventilation multi-moyens
// (espèces, Wave, Orange, MTN, Moov, chèques, virements), sessions ouvertes, recherche
// et data table des transactions avec badges, reçus et actions de caisse complètes.
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Banknote,
  CheckCircle2,
  Clock,
  ExternalLink,
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
  Input,
  Modal,
  MoneyInput,
  Select,
  StatusBadge,
  Textarea,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t, tc } from "@/components/billing/i18n";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";

const DENOMINATIONS = [10_000, 5_000, 2_000, 1_000, 500, 250, 200, 100, 50, 25, 10, 5];

type MethodFilter =
  | "ALL"
  | "CASH"
  | "MOBILE_MONEY"
  | "WAVE"
  | "ORANGE_MONEY"
  | "MTN_MOMO"
  | "MOOV_MONEY"
  | "CHEQUE"
  | "BANK_TRANSFER";

type StatusFilter = "ALL" | "CONFIRMED" | "PENDING" | "FAILED" | "REFUNDED";

const MOBILE_METHODS = ["WAVE", "ORANGE_MONEY", "MTN_MOMO", "MOOV_MONEY"];

export default function CashPage() {
  const me = trpc.me.get.useQuery();
  const perms = useMemo(() => new Set(me.data?.permissions ?? []), [me.data?.permissions]);
  const utils = trpc.useUtils();

  const q = trpc.cash.current.useQuery({});
  const sessionsQ = trpc.cash.sessions.useQuery({ limit: 20 });
  const paymentsQ = trpc.payment.list.useQuery({ limit: 100 });

  const refresh = () => {
    void utils.cash.current.invalidate();
    void utils.cash.sessions.invalidate();
    void utils.payment.list.invalidate();
  };

  const [modal, setModal] = useState<"expense" | "drop" | "close" | null>(null);
  const [float, setFloat] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<MethodFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [unallocatedOnly, setUnallocatedOnly] = useState(false);

  const open = trpc.cash.open.useMutation({ onSuccess: refresh });
  const confirmCheque = trpc.payment.confirmCheque.useMutation({ onSuccess: refresh });

  const session = q.data?.session;
  const site = q.data?.site;
  const timeZone = q.data?.timeZone ?? "Africa/Abidjan";

  const rawPayments = useMemo(() => paymentsQ.data?.items ?? [], [paymentsQ.data?.items]);

  // Nombre de sessions ouvertes
  const openSessionsCount = useMemo(() => {
    const list = sessionsQ.data?.items ?? [];
    return list.filter((s) => !s.closedAt).length;
  }, [sessionsQ.data?.items]);

  // Ventilation des encaissements (session ou transactions du jour)
  const breakdown = useMemo(() => {
    const byMethod = session?.byMethod ?? {};
    const cash = byMethod.CASH ?? 0;
    const wave = byMethod.WAVE ?? 0;
    const orange = byMethod.ORANGE_MONEY ?? 0;
    const mtn = byMethod.MTN_MOMO ?? 0;
    const moov = byMethod.MOOV_MONEY ?? 0;
    const mobileMoneyTotal = wave + orange + mtn + moov;
    const cheque = byMethod.CHEQUE ?? 0;
    const bankTransfer = byMethod.BANK_TRANSFER ?? 0;
    const chequesAndTransfers = cheque + bankTransfer;
    const totalCollected = session?.totalReceived ?? 0;

    return {
      cash,
      wave,
      orange,
      mtn,
      moov,
      mobileMoneyTotal,
      cheque,
      bankTransfer,
      chequesAndTransfers,
      totalCollected,
      expectedCash: session?.expectedCash ?? 0,
    };
  }, [session]);

  // Filtrage combiné des transactions
  const filteredPayments = useMemo(() => {
    let list = rawPayments;

    // Filtre mode de règlement
    if (methodFilter === "CASH") {
      list = list.filter((p) => p.method === "CASH");
    } else if (methodFilter === "MOBILE_MONEY") {
      list = list.filter((p) => MOBILE_METHODS.includes(p.method));
    } else if (methodFilter === "WAVE") {
      list = list.filter((p) => p.method === "WAVE");
    } else if (methodFilter === "ORANGE_MONEY") {
      list = list.filter((p) => p.method === "ORANGE_MONEY");
    } else if (methodFilter === "MTN_MOMO") {
      list = list.filter((p) => p.method === "MTN_MOMO");
    } else if (methodFilter === "MOOV_MONEY") {
      list = list.filter((p) => p.method === "MOOV_MONEY");
    } else if (methodFilter === "CHEQUE") {
      list = list.filter((p) => p.method === "CHEQUE");
    } else if (methodFilter === "BANK_TRANSFER") {
      list = list.filter((p) => p.method === "BANK_TRANSFER");
    }

    // Filtre statut
    if (statusFilter !== "ALL") {
      list = list.filter((p) => p.status === statusFilter);
    }

    // Filtre non affecté
    if (unallocatedOnly) {
      list = list.filter((p) => p.unallocated > 0);
    }

    // Recherche textuelle
    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter((p) => {
        const number = (p.number ?? "").toLowerCase();
        const customer = (p.customer?.displayName ?? "").toLowerCase();
        const reference = (p.reference ?? "").toLowerCase();
        const amountStr = p.amount.toString();
        return (
          number.includes(query) ||
          customer.includes(query) ||
          reference.includes(query) ||
          amountStr.includes(query)
        );
      });
    }

    return list;
  }, [rawPayments, methodFilter, statusFilter, unallocatedOnly, search]);

  const hasActiveFilters = Boolean(
    search.trim() || methodFilter !== "ALL" || statusFilter !== "ALL" || unallocatedOnly,
  );

  const resetFilters = () => {
    setSearch("");
    setMethodFilter("ALL");
    setStatusFilter("ALL");
    setUnallocatedOnly(false);
  };

  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.isError || !q.data) {
    return <ErrorBox onRetry={() => q.refetch()} message={t("loadError")} />;
  }

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* En-tête principal */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Wallet size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{tc("title")}</h1>
              {site && (
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">
                  {site.name}
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              Gestion de la caisse d&apos;atelier, ventilation multi-moyens (Wave, Orange, MTN, Moov), sessions et reçus
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/caisse/sessions"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
          >
            <Clock size={14} className="text-muted" />
            <span>{tc("history")}</span>
          </Link>
          <Link
            href="/caisse/paiements"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
          >
            <Receipt size={14} className="text-muted" />
            <span>{tc("payments")}</span>
          </Link>
        </div>
      </div>

      {/* Cartes KPI interactives et ventilation multi-moyens */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {/* KPI 1 : Total encaissé */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{tc("kpis.totalCollected")}</span>
            <Receipt size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {formatFCFA(breakdown.totalCollected)}
          </div>
          <div className="mt-1 text-[11px] text-muted">Session active du site</div>
        </div>

        {/* KPI 2 : Espèces en caisse (cliquable) */}
        <button
          type="button"
          onClick={() => setMethodFilter(methodFilter === "CASH" ? "ALL" : "CASH")}
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:bg-surface-2 ${
            methodFilter === "CASH"
              ? "border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500"
              : "border-border/80 bg-surface shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{tc("kpis.cashInRegister")}</span>
            <Banknote size={16} className="text-emerald-600" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-emerald-600">
            {formatFCFA(breakdown.expectedCash)}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {tc("kpis.expectedDetail", { amount: formatFCFA(breakdown.cash) })}
          </div>
        </button>

        {/* KPI 3 : Mobile Money (Wave, Orange, MTN, Moov) (cliquable) */}
        <button
          type="button"
          onClick={() => setMethodFilter(methodFilter === "MOBILE_MONEY" ? "ALL" : "MOBILE_MONEY")}
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:bg-surface-2 ${
            methodFilter === "MOBILE_MONEY"
              ? "border-sky-500 bg-sky-500/5 ring-1 ring-sky-500"
              : "border-border/80 bg-surface shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{tc("kpis.mobileMoney")}</span>
            <Smartphone size={16} className="text-sky-600" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-sky-600">
            {formatFCFA(breakdown.mobileMoneyTotal)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted">
            <span>W: {formatFCFA(breakdown.wave)}</span>
            <span>·</span>
            <span>OM: {formatFCFA(breakdown.orange)}</span>
          </div>
        </button>

        {/* KPI 4 : Chèques & Virements (cliquable) */}
        <button
          type="button"
          onClick={() => setMethodFilter(methodFilter === "CHEQUE" ? "ALL" : "CHEQUE")}
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:bg-surface-2 ${
            methodFilter === "CHEQUE"
              ? "border-purple-500 bg-purple-500/5 ring-1 ring-purple-500"
              : "border-border/80 bg-surface shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{tc("kpis.chequesAndTransfers")}</span>
            <CheckCircle2 size={16} className="text-purple-600" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {formatFCFA(breakdown.chequesAndTransfers)}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            Chèque: {formatFCFA(breakdown.cheque)} · Vir: {formatFCFA(breakdown.bankTransfer)}
          </div>
        </button>

        {/* KPI 5 : Sessions ouvertes */}
        <Link
          href="/caisse/sessions"
          className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm transition-all hover:bg-surface-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{tc("kpis.openSessions")}</span>
            <Clock size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {openSessionsCount}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {tc("kpis.openCount", { count: openSessionsCount })}
          </div>
        </Link>
      </div>

      {/* État de la session courante (si ouverte) ou bloc d'ouverture */}
      {!session ? (
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-warn/10 text-status-warn">
              <Clock size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{tc("openTitle")}</h2>
              <p className="text-xs text-muted">{tc("noSession")}</p>
            </div>
          </div>

          {perms.has("cash:operate") && (
            <div className="mt-2 flex flex-col gap-3 sm:max-w-md">
              <MoneyInput
                label={tc("float")}
                value={float ?? q.data.suggestedFloat}
                onChange={setFloat}
              />
              {open.error && (
                <p role="alert" className="text-xs text-status-bad">
                  ⚠ {open.error.message}
                </p>
              )}
              <Button
                loading={open.isPending}
                onClick={() => open.mutate({ openingFloat: float ?? q.data.suggestedFloat })}
                className="h-10 text-xs font-medium"
              >
                {tc("open")}
              </Button>
            </div>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-status-ok animate-pulse" />
              <span className="font-semibold text-foreground">Session ouverte</span>
              <span className="text-muted">·</span>
              <span className="text-muted">
                {tc("openedBy", {
                  name: session.openedByName,
                  date: formatDateTime(session.openedAt, timeZone),
                })}
              </span>
            </div>

            {/* Boutons d'actions de caisse */}
            <div className="flex flex-wrap items-center gap-2">
              {perms.has("cash:expense") && (
                <Button variant="secondary" size="sm" onClick={() => setModal("expense")}>
                  {tc("expense")}
                </Button>
              )}
              {perms.has("cash:operate") && (
                <Button variant="secondary" size="sm" onClick={() => setModal("drop")}>
                  {tc("drop")}
                </Button>
              )}
              {perms.has("cash:close") && (
                <Button size="sm" onClick={() => setModal("close")}>
                  {tc("close")}
                </Button>
              )}
            </div>
          </div>

          {/* Synthèse rapide des mouvements d'espèces */}
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-6">
            <div className="flex flex-col gap-0.5 rounded-lg bg-surface-2/50 p-2.5">
              <span className="text-muted">{tc("float")}</span>
              <span className="font-semibold text-foreground">
                {formatFCFA(session.openingFloat)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg bg-surface-2/50 p-2.5">
              <span className="text-muted">{tc("cashIn")}</span>
              <span className="font-semibold text-status-ok">
                +{formatFCFA(session.cashPayments)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg bg-surface-2/50 p-2.5">
              <span className="text-muted">{tc("expenses")}</span>
              <span className="font-semibold text-status-bad">
                -{formatFCFA(session.expensesTotal)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg bg-surface-2/50 p-2.5">
              <span className="text-muted">{tc("refunds")}</span>
              <span className="font-semibold text-status-bad">
                -{formatFCFA(session.cashRefunds)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg bg-surface-2/50 p-2.5">
              <span className="text-muted">{tc("drops")}</span>
              <span className="font-semibold text-muted">
                -{formatFCFA(session.dropsTotal)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5">
              <span className="font-semibold text-emerald-700">{tc("expected")}</span>
              <span className="font-bold text-emerald-800 text-sm" data-testid="expected-cash">
                {formatFCFA(session.expectedCash)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* SECTION TRANSACTIONS & RÈGLEMENTS */}
      <div className="flex flex-col gap-4">
        {/* Barre de filtres et recherche */}
        <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-tight text-foreground">
              {tc("allTransactions")}
            </h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
              {filteredPayments.length} règlement(s)
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
            <div className="relative sm:col-span-5">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tc("searchPlaceholder")}
                className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-8 text-xs placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                  aria-label="Effacer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="sm:col-span-3">
              <Select
                aria-label={t("encaisser.method")}
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value as MethodFilter)}
                className="h-9 text-xs"
              >
                <option value="ALL">{tc("paymentsList.allMethods")}</option>
                <option value="CASH">{tc("methodBadge.CASH")}</option>
                <option value="MOBILE_MONEY">{tc("kpis.mobileMoney")} (Tous)</option>
                <option value="WAVE">{tc("methodBadge.WAVE")}</option>
                <option value="ORANGE_MONEY">{tc("methodBadge.ORANGE_MONEY")}</option>
                <option value="MTN_MOMO">{tc("methodBadge.MTN_MOMO")}</option>
                <option value="MOOV_MONEY">{tc("methodBadge.MOOV_MONEY")}</option>
                <option value="CHEQUE">{tc("methodBadge.CHEQUE")}</option>
                <option value="BANK_TRANSFER">{tc("methodBadge.BANK_TRANSFER")}</option>
              </Select>
            </div>

            <div className="sm:col-span-2">
              <Select
                aria-label="Statut"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="h-9 text-xs"
              >
                <option value="ALL">Tous les statuts</option>
                <option value="CONFIRMED">Confirmé</option>
                <option value="PENDING">En attente</option>
                <option value="FAILED">Rejeté / Échoué</option>
                <option value="REFUNDED">Remboursé</option>
              </Select>
            </div>

            <div className="sm:col-span-2 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={unallocatedOnly}
                  onChange={(e) => setUnallocatedOnly(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="truncate">{tc("paymentsList.unallocatedOnly")}</span>
              </label>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="h-8 text-xs text-muted hover:text-foreground"
                >
                  {tc("filterReset")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Data table des transactions */}
        {filteredPayments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-12 text-center bg-surface">
            <Receipt size={40} className="text-muted" />
            <div>
              <h3 className="text-base font-semibold text-foreground">{tc("emptyTransactions")}</h3>
              <p className="mt-1 text-xs text-muted max-w-sm">{tc("emptyTransactionsDesc")}</p>
            </div>
            {hasActiveFilters && (
              <Button variant="secondary" size="sm" onClick={resetFilters} className="mt-2">
                {tc("filterReset")}
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-2/60 font-semibold text-muted">
                    <th className="py-3 pl-4 pr-3">{tc("table.paymentNumber")}</th>
                    <th className="px-3 py-3">{tc("table.customer")}</th>
                    <th className="px-3 py-3">{tc("table.method")}</th>
                    <th className="px-3 py-3">{tc("table.allocations")}</th>
                    <th className="px-3 py-3">{tc("table.amount")}</th>
                    <th className="px-3 py-3">{tc("table.status")}</th>
                    <th className="py-3 pl-3 pr-4 text-right">{tc("table.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredPayments.map((p) => {
                    const isPendingCheque = p.status === "PENDING" && p.method === "CHEQUE";

                    return (
                      <tr key={p.id} className="transition-colors hover:bg-surface-2/50">
                        {/* Numéro & Réf */}
                        <td className="py-3 pl-4 pr-3 align-middle">
                          <div className="flex flex-col">
                            <span className="font-mono font-semibold text-foreground">
                              {p.number}
                            </span>
                            <span className="text-[11px] text-muted">
                              {formatDateTime(p.receivedAt, timeZone)}
                            </span>
                            {p.reference && (
                              <span className="mt-0.5 text-[10px] text-muted">
                                Réf: {p.reference}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Client */}
                        <td className="px-3 py-3 align-middle">
                          {p.customer ? (
                            <Link
                              href={`/clients/${p.customer.id}`}
                              className="font-medium text-foreground hover:underline"
                            >
                              {p.customer.displayName}
                            </Link>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>

                        {/* Mode de règlement avec Badge spécifique */}
                        <td className="px-3 py-3 align-middle">
                          <PaymentMethodBadge method={p.method} />
                        </td>

                        {/* Factures liées / Non affecté */}
                        <td className="px-3 py-3 align-middle">
                          <div className="flex flex-col gap-1 max-w-[200px]">
                            {p.allocations.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {p.allocations.map((a) => (
                                  <Link
                                    key={a.invoice.id}
                                    href={`/factures/${a.invoice.id}`}
                                    className="inline-flex items-center gap-0.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-accent hover:underline"
                                  >
                                    <span>{a.invoice.number}</span>
                                    <span className="text-muted">({formatFCFA(a.amount)})</span>
                                  </Link>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted italic">Sans facture liée</span>
                            )}
                            {p.unallocated > 0 && (
                              <span className="inline-flex items-center text-[10px] font-medium text-status-warn">
                                ⚠ {tc("table.unallocatedBadge", { amount: formatFCFA(p.unallocated) })}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Montant */}
                        <td className="px-3 py-3 align-middle">
                          <span className="font-semibold text-foreground text-sm">
                            {formatFCFA(p.amount)}
                          </span>
                        </td>

                        {/* Statut & Reçu */}
                        <td className="px-3 py-3 align-middle">
                          <div className="flex flex-col gap-1">
                            {p.voidedAt ? (
                              <StatusBadge tone="off">{t("payments.voided")}</StatusBadge>
                            ) : p.status === "PENDING" ? (
                              <StatusBadge tone="warn">⏳ {t("payments.pending")}</StatusBadge>
                            ) : p.status === "FAILED" ? (
                              <StatusBadge tone="bad">Échoué</StatusBadge>
                            ) : p.status === "REFUNDED" ? (
                              <StatusBadge tone="off">Remboursé</StatusBadge>
                            ) : (
                              <StatusBadge tone="ok">Confirmé</StatusBadge>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-3 pl-3 pr-4 align-middle text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Reçu certifié */}
                            {p.receiptUrl && (
                              <a
                                href={p.receiptUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] font-medium text-foreground transition-all hover:bg-surface-2"
                                title="Imprimer ou télécharger le reçu certifié"
                              >
                                <Printer size={12} className="text-muted" />
                                <span>{tc("table.receipt")}</span>
                              </a>
                            )}

                            {/* Validation rapide de chèque */}
                            {isPendingCheque && perms.has("cash:operate") && (
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={confirmCheque.isPending}
                                onClick={() => confirmCheque.mutate({ id: p.id })}
                                className="h-8 text-[11px] text-status-ok border-status-ok/30 bg-status-ok/5 hover:bg-status-ok/15"
                              >
                                {tc("paymentsList.confirmCheque")}
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
      </div>

      {/* MODALES D'OPÉRATIONS DE CAISSE */}
      {session && modal === "expense" && (
        <ExpenseModal
          sessionId={session.id}
          categories={q.data.expenseCategories}
          approval={q.data.expenseApproval}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
      {session && modal === "drop" && (
        <DropModal
          sessionId={session.id}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
      {session && modal === "close" && (
        <CloseModal
          sessionId={session.id}
          expected={session.expectedCash}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Badge visuel élégant par méthode de paiement */
function PaymentMethodBadge({ method }: { method: string }) {
  switch (method) {
    case "CASH":
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          <Banknote size={11} />
          <span>{tc("methodBadge.CASH")}</span>
        </span>
      );
    case "WAVE":
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
          <Smartphone size={11} />
          <span>{tc("methodBadge.WAVE")}</span>
        </span>
      );
    case "ORANGE_MONEY":
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
          <Smartphone size={11} />
          <span>{tc("methodBadge.ORANGE_MONEY")}</span>
        </span>
      );
    case "MTN_MOMO":
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
          <Smartphone size={11} />
          <span>{tc("methodBadge.MTN_MOMO")}</span>
        </span>
      );
    case "MOOV_MONEY":
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
          <Smartphone size={11} />
          <span>{tc("methodBadge.MOOV_MONEY")}</span>
        </span>
      );
    case "CHEQUE":
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
          <CheckCircle2 size={11} />
          <span>{tc("methodBadge.CHEQUE")}</span>
        </span>
      );
    case "BANK_TRANSFER":
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
          <ExternalLink size={11} />
          <span>{tc("methodBadge.BANK_TRANSFER")}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
          {method}
        </span>
      );
  }
}

function ExpenseModal({
  sessionId,
  categories,
  approval,
  onClose,
  onDone,
}: {
  sessionId: string;
  categories: string[];
  approval: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [category, setCategory] = useState(categories[0] ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const m = trpc.cash.expense.useMutation({ onSuccess: onDone });
  return (
    <Modal
      open
      title={tc("expenseForm.title")}
      onClose={onClose}
      footer={
        <Button
          loading={m.isPending}
          disabled={!amount || !description.trim()}
          onClick={() => amount && m.mutate({ sessionId, category, amount, description })}
        >
          {tc("expenseForm.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          {tc("expenseForm.category")}
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </label>
        <MoneyInput label={tc("expenseForm.amount")} value={amount} onChange={setAmount} />
        <p className="text-xs text-muted">
          {tc("expenseForm.approvalHint", { amount: formatFCFA(approval) })}
        </p>
        <Input
          label={tc("expenseForm.description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {m.error && (
          <p role="alert" className="text-status-bad">
            ⚠ {m.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

function DropModal({
  sessionId,
  onClose,
  onDone,
}: {
  sessionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [destination, setDestination] = useState<"safe" | "bank">("safe");
  const [reference, setReference] = useState("");
  const m = trpc.cash.drop.useMutation({ onSuccess: onDone });
  return (
    <Modal
      open
      title={tc("dropForm.title")}
      onClose={onClose}
      footer={
        <Button
          loading={m.isPending}
          disabled={!amount}
          onClick={() =>
            amount &&
            m.mutate({ sessionId, amount, destination, reference: reference || undefined })
          }
        >
          {tc("dropForm.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <MoneyInput label={tc("expenseForm.amount")} value={amount} onChange={setAmount} />
        <label className="flex flex-col gap-1">
          {tc("dropForm.destination")}
          <Select
            value={destination}
            onChange={(e) => setDestination(e.target.value as "safe" | "bank")}
          >
            <option value="safe">{tc("dropForm.safe")}</option>
            <option value="bank">{tc("dropForm.bank")}</option>
          </Select>
        </label>
        <Input
          label={tc("dropForm.reference")}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        {m.error && (
          <p role="alert" className="text-status-bad">
            ⚠ {m.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

function CloseModal({
  sessionId,
  expected,
  onClose,
  onDone,
}: {
  sessionId: string;
  expected: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [counted, setCounted] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const m = trpc.cash.close.useMutation({ onSuccess: onDone });
  const fromCounts = Object.entries(counts).reduce((s, [k, n]) => s + Number(k) * n, 0);
  const useCounts = Object.values(counts).some((n) => n > 0);
  const total = useCounts ? fromCounts : counted;
  const difference = total === null ? null : total - expected;
  return (
    <Modal
      open
      title={tc("closeForm.title")}
      onClose={onClose}
      footer={
        <Button
          loading={m.isPending}
          disabled={total === null}
          onClick={() =>
            m.mutate({
              id: sessionId,
              ...(useCounts
                ? {
                    denominations: Object.fromEntries(
                      Object.entries(counts).filter(([, n]) => n > 0),
                    ),
                  }
                : { countedCash: counted ?? 0 }),
              notes: notes.trim() || undefined,
            })
          }
        >
          {tc("closeForm.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          {tc("expected")} : <strong>{formatFCFA(expected)}</strong>
        </p>
        {!useCounts && (
          <MoneyInput label={tc("closeForm.counted")} value={counted} onChange={setCounted} />
        )}
        <details>
          <summary className="min-h-11 cursor-pointer py-2">
            {tc("closeForm.denominations")}
          </summary>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DENOMINATIONS.map((d) => (
              <Input
                key={d}
                label={formatFCFA(d)}
                type="number"
                inputMode="numeric"
                min={0}
                value={counts[d] ?? ""}
                onChange={(e) =>
                  setCounts((c) => ({
                    ...c,
                    [d]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
              />
            ))}
          </div>
        </details>
        {difference !== null && (
          <p className={difference === 0 ? "text-status-ok" : "font-semibold text-status-warn"}>
            {difference === 0 ? "✓ " : "⚠ "}
            {tc("closeForm.difference", { amount: formatFCFA(difference) })}
          </p>
        )}
        <label className="flex flex-col gap-1">
          {tc("closeForm.notes")}
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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
