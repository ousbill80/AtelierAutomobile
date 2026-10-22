"use client";

// M18 `/tresorerie` — vue d'ensemble : trésorerie totale, flux du mois, comptes (solde, flux,
// dernier rapprochement), alertes (modes non rattachés, découverts, dépenses en attente),
// derniers mouvements ; Virement, Dépense hors caisse, Autre mouvement, Nouveau compte.
import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  CircleCheck,
  Hourglass,
  List,
  Plus,
  Scale,
  SlidersHorizontal,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox } from "@/components/repair-orders/error-box";
import { formatDateTime, formatDay } from "@/components/repair-orders/i18n";
import { t } from "@/components/billing/i18n";
import { Kpi, Section, signedFCFA } from "@/components/cash/cash-ui";
import { tt } from "@/components/treasury/i18n";
import {
  AccountIcon,
  AccountModal,
  MovementModal,
  SignedAmount,
  TransferModal,
  TreasuryExpenseModal,
  type TreasuryAccount,
  type TreasuryOverview,
} from "@/components/treasury/treasury-ui";

type ModalKind = "transfer" | "expense" | "movement" | "account" | null;

export default function TreasuryPage() {
  const me = trpc.me.get.useQuery();
  const canManage = (me.data?.permissions ?? []).includes("treasury:manage");
  const utils = trpc.useUtils();
  const q = trpc.treasury.overview.useQuery();
  const [modal, setModal] = useState<ModalKind>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const done = (text: string, tone: "ok" | "warn" = "ok") => {
    setModal(null);
    setNotice({ tone, text });
    void utils.treasury.invalidate();
  };

  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data)
    return <ErrorBox onRetry={() => q.refetch()} message={tt("loadError")} />;
  const d = q.data;
  const active = d.accounts.filter((a) => !a.archived) as TreasuryAccount[];
  const taken = Object.fromEntries(
    active.flatMap((a) => a.paymentMethods.map((m) => [m, a.name] as const)),
  );
  const net = d.monthIn - d.monthOut;

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{tt("title")}</h1>
          <p className="mt-1 text-sm text-muted">{tt("subtitle")}</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label={tt("title")}>
          <Link href="/tresorerie/journal" className="btn btn-secondary min-h-11">
            <List size={16} aria-hidden /> {tt("journalLink")}
          </Link>
          <Link href="/tresorerie/rapports" className="btn btn-secondary min-h-11">
            <BarChart3 size={16} aria-hidden /> {tt("reportsLink")}
          </Link>
        </nav>
      </header>

      {notice && (
        <p
          role="status"
          className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
            notice.tone === "ok"
              ? "border-status-ok bg-status-ok-bg text-status-ok"
              : "border-status-warn bg-status-warn-bg text-status-warn"
          }`}
        >
          {notice.tone === "ok" ? (
            <CircleCheck size={16} aria-hidden />
          ) : (
            <Hourglass size={16} aria-hidden />
          )}
          {notice.text}
        </p>
      )}

      <Alerts data={d} canManage={canManage} onCreateAccount={() => setModal("account")} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Wallet}
          label={tt("total")}
          value={formatFCFA(d.total)}
          tone="ok"
          testId="treasury-total"
        />
        <Kpi icon={ArrowDownLeft} label={tt("monthIn")} value={formatFCFA(d.monthIn)} />
        <Kpi icon={ArrowUpRight} label={tt("monthOut")} value={formatFCFA(d.monthOut)} />
        <Kpi
          icon={Scale}
          label={tt("monthNet")}
          value={signedFCFA(net)}
          tone={net < 0 ? "bad" : net > 0 ? "ok" : "neutral"}
        />
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            onClick={() => setModal("transfer")}
            disabled={active.length < 2}
          >
            <ArrowLeftRight size={16} aria-hidden /> {tt("actions.transfer")}
          </Button>
          <Button variant="secondary" className="min-h-11" onClick={() => setModal("expense")}>
            <ArrowUpRight size={16} aria-hidden /> {tt("actions.expense")}
          </Button>
          <Button variant="secondary" className="min-h-11" onClick={() => setModal("movement")}>
            <SlidersHorizontal size={16} aria-hidden /> {tt("actions.movement")}
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={() => setModal("account")}>
            <Plus size={16} aria-hidden /> {tt("actions.newAccount")}
          </Button>
        </div>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <ul
          className="grid min-w-0 content-start gap-3 md:grid-cols-2"
          data-testid="treasury-accounts"
        >
          {d.accounts.map((a) => (
            <li key={a.id}>
              <Link
                href={`/tresorerie/comptes/${a.id}`}
                className={`group flex h-full flex-col gap-3 rounded-lg border bg-surface p-4 transition-colors hover:border-accent ${
                  a.balance < 0 ? "border-status-bad" : "border-border"
                } ${a.archived ? "opacity-60" : ""}`}
              >
                <span className="flex items-start gap-3">
                  <AccountIcon type={a.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {tt(`types.${a.type}`)}
                      {a.accountRef ? ` · ${a.accountRef}` : ""}
                      {a.archived ? ` · ${tt("account.archived")}` : ""}
                    </span>
                  </span>
                  <ChevronRight
                    size={18}
                    aria-hidden
                    className="shrink-0 text-muted group-hover:text-accent"
                  />
                </span>
                <span
                  className={`text-2xl font-semibold tabular-nums ${a.balance < 0 ? "text-status-bad" : ""}`}
                  data-testid={`balance-${a.name}`}
                >
                  {formatFCFA(a.balance)}
                </span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-status-ok">+{formatFCFA(a.monthIn)}</span>
                  <span className="text-muted">−{formatFCFA(a.monthOut)}</span>
                  <span className="text-muted">
                    {a.lastReconciliation
                      ? `${tt("account.lastReconciliation", { date: formatDay(a.lastReconciliation.date) })}${
                          a.lastReconciliation.difference
                            ? ` (${tt("account.reconciliationGap", { amount: signedFCFA(a.lastReconciliation.difference) })})`
                            : ""
                        }`
                      : a.type === "BANK" || a.type === "MOBILE_MONEY"
                        ? tt("account.neverReconciled")
                        : ""}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {a.type === "CASH_REGISTER" ? (
                    <span className="pill pill-type">{tt("account.cashMethod")}</span>
                  ) : (
                    a.paymentMethods.map((m) => (
                      <span key={m} className="pill pill-type">
                        {t(`method.${m}`)}
                      </span>
                    ))
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <Section
          title={tt("recent.title")}
          action={
            <Link
              href="/tresorerie/journal"
              className="text-sm font-medium text-accent hover:underline"
            >
              {tt("recent.all")}
            </Link>
          }
        >
          {d.recent.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">{tt("recent.empty")}</p>
          ) : (
            <ul className="-my-1 divide-y divide-border">
              {d.recent.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm break-words">{m.label}</span>
                    <span className="block text-xs text-muted">
                      {formatDateTime(m.occurredAt, d.timeZone)} · {m.account} ·{" "}
                      {tt(`kinds.${m.kind}`)}
                    </span>
                  </span>
                  <SignedAmount direction={m.direction} amount={m.amount} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {modal === "transfer" && (
        <TransferModal
          accounts={active}
          todayKey={d.today}
          onClose={() => setModal(null)}
          onDone={(m) => done(m)}
        />
      )}
      {modal === "expense" && (
        <TreasuryExpenseModal
          accounts={active}
          categories={d.categories.expense}
          approval={d.expenseApproval}
          todayKey={d.today}
          onClose={() => setModal(null)}
          onDone={(m, pending) => done(m, pending ? "warn" : "ok")}
        />
      )}
      {modal === "movement" && (
        <MovementModal
          accounts={active}
          categories={d.categories}
          todayKey={d.today}
          onClose={() => setModal(null)}
          onDone={(m) => done(m)}
        />
      )}
      {modal === "account" && (
        <AccountModal
          sites={d.sites}
          takenMethods={taken}
          todayKey={d.today}
          onClose={() => setModal(null)}
          onDone={(m) => done(m)}
        />
      )}
    </div>
  );
}

function Alerts({
  data,
  canManage,
  onCreateAccount,
}: {
  data: TreasuryOverview;
  canManage: boolean;
  onCreateAccount: () => void;
}) {
  const { unassigned, negative, pendingExpenses } = data.alerts;
  if (unassigned.length === 0 && negative.length === 0 && pendingExpenses === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="treasury-alerts">
      {unassigned.map((u) => (
        <p
          key={u.method}
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn"
        >
          <TriangleAlert size={16} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1">
            {u.method === "DROP"
              ? tt("alerts.unassignedDrop", { count: u.count, amount: formatFCFA(u.amount) })
              : u.method === "CASH"
                ? tt("alerts.unassignedCash", { count: u.count, amount: formatFCFA(u.amount) })
                : tt("alerts.unassigned", {
                    count: u.count,
                    method: t(`method.${u.method}`),
                    amount: formatFCFA(u.amount),
                  })}
          </span>
          {canManage && (
            <button
              type="button"
              onClick={onCreateAccount}
              className="min-h-11 font-semibold underline"
            >
              {tt("alerts.unassignedAction")}
            </button>
          )}
        </p>
      ))}
      {negative.map((n) => (
        <p
          key={n.id}
          role="status"
          className="flex items-center gap-3 rounded-lg border border-status-bad bg-status-bad-bg p-3 text-sm text-status-bad"
        >
          <TriangleAlert size={16} aria-hidden className="shrink-0" />
          {tt("alerts.negative", { name: n.name, amount: formatFCFA(n.balance) })}
        </p>
      ))}
      {pendingExpenses > 0 && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn"
        >
          <TriangleAlert size={16} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1">
            {tt("alerts.pendingExpenses", { count: pendingExpenses })}
          </span>
          <Link href="/caisse/depenses?status=PENDING" className="font-semibold underline">
            {tt("alerts.pendingAction")}
          </Link>
        </p>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="h-12 w-64 animate-pulse rounded-lg bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[74px] animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
