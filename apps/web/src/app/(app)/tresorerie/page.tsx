"use client";

// M18 `/tresorerie` — registre des comptes : trésorerie totale, répartition par type,
// filtres, liste (solde d'ouverture, solde actuel, statut). Alertes, virement, dépense
// hors caisse, autre mouvement et derniers mouvements restent sur cette page.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  CircleCheck,
  Hourglass,
  List,
  Plus,
  Printer,
  Scale,
  SlidersHorizontal,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, Input, Select, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox } from "@/components/repair-orders/error-box";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t } from "@/components/billing/i18n";
import { GuideLink } from "@/components/guide-link";
import { Kpi, Section, signedFCFA } from "@/components/cash/cash-ui";
import { EduTip } from "@/components/edu-tip";
import { tt } from "@/components/treasury/i18n";
import {
  AccountIcon,
  AccountModal,
  MovementModal,
  SignedAmount,
  TransferModal,
  TreasuryExpenseModal,
  type AccountType,
  type TreasuryOverview,
} from "@/components/treasury/treasury-ui";

type ModalKind = "transfer" | "expense" | "movement" | "account" | null;
type StatusFilter = "ALL" | "ACTIVE" | "ARCHIVED" | "OVERDRAFT";
type AccountRow = TreasuryOverview["accounts"][number];

const SUMMARY_TYPES = ["CASH_REGISTER", "SAFE", "BANK", "MOBILE_MONEY"] as const;

function countLabel(count: number, oneKey: string, manyKey: string) {
  return tt(count > 1 ? manyKey : oneKey, { count });
}

export default function TreasuryPage() {
  const me = trpc.me.get.useQuery();
  const canManage = (me.data?.permissions ?? []).includes("treasury:manage");
  const utils = trpc.useUtils();
  const q = trpc.treasury.overview.useQuery();
  const [modal, setModal] = useState<ModalKind>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [typeFilter, setTypeFilter] = useState<AccountType | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const done = (text: string, tone: "ok" | "warn" = "ok") => {
    setModal(null);
    setNotice({ tone, text });
    void utils.treasury.invalidate();
  };

  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data)
    return <ErrorBox onRetry={() => q.refetch()} message={tt("loadError")} />;
  const d = q.data;
  const active = d.accounts.filter((a) => !a.archived);
  const taken = Object.fromEntries(
    active.flatMap((a) => a.paymentMethods.map((m) => [m, a.name] as const)),
  );
  const needle = query.trim().toLowerCase();
  const rows = d.accounts.filter((a) => {
    if (typeFilter !== "ALL" && a.type !== typeFilter) return false;
    if (statusFilter === "ACTIVE" && a.archived) return false;
    if (statusFilter === "ARCHIVED" && !a.archived) return false;
    if (statusFilter === "OVERDRAFT" && (a.archived || a.balance >= 0)) return false;
    if (!needle) return true;
    const hay = [a.name, a.bankName, a.accountRef, a.ledgerAccount, a.site]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
  const filtered = typeFilter !== "ALL" || statusFilter !== "ALL" || needle.length > 0;
  const clearFilters = () => {
    setTypeFilter("ALL");
    setStatusFilter("ALL");
    setQuery("");
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{tt("title")}</h1>
          <p className="mt-1 text-sm text-muted">{tt("subtitle")}</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label={tt("title")}>
          <GuideLink href="/tresorerie/guide" />
          <Link href="/tresorerie/journal" className="btn btn-secondary min-h-11">
            <List size={16} aria-hidden /> {tt("journalLink")}
          </Link>
          <Link href="/tresorerie/rapports" className="btn btn-secondary min-h-11">
            <BarChart3 size={16} aria-hidden /> {tt("reportsLink")}
          </Link>
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => printRegister(d.total, rows)}
          >
            <Printer size={16} aria-hidden /> {tt("print")}
          </Button>
          {canManage && (
            <Button className="min-h-11" onClick={() => setModal("account")}>
              <Plus size={16} aria-hidden /> {tt("actions.newAccount")}
            </Button>
          )}
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

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={tt("total")}>
        <Kpi
          icon={Wallet}
          label={tt("total")}
          value={formatFCFA(d.total)}
          tone="ok"
          testId="treasury-total"
          hint={tt("register.activeCount", { active: active.length, total: d.accounts.length })}
          help={tt("kpiHelp.total")}
          example={tt("kpiExample.total")}
        />
        <Kpi
          icon={ArrowDownLeft}
          label={tt("monthIn")}
          value={formatFCFA(d.monthIn)}
          tone="ok"
          help={tt("kpiHelp.monthIn")}
          example={tt("kpiExample.monthIn")}
        />
        <Kpi
          icon={ArrowUpRight}
          label={tt("monthOut")}
          value={formatFCFA(d.monthOut)}
          help={tt("kpiHelp.monthOut")}
          example={tt("kpiExample.monthOut")}
        />
        <Kpi
          icon={Scale}
          label={tt("monthNet")}
          value={signedFCFA(d.monthIn - d.monthOut)}
          tone={d.monthIn - d.monthOut < 0 ? "bad" : d.monthIn - d.monthOut > 0 ? "ok" : "neutral"}
          help={tt("kpiHelp.monthNet")}
          example={tt("kpiExample.monthNet")}
        />
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SUMMARY_TYPES.filter((type) => active.some((a) => a.type === type)).map((type) => {
          const accounts = active.filter((a) => a.type === type);
          const sum = accounts.reduce((s, a) => s + a.balance, 0);
          const selected = typeFilter === type;
          return (
            <div key={type} className="relative min-w-0">
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => setTypeFilter(selected ? "ALL" : type)}
                className={`flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg border bg-surface p-3 pr-12 text-left ${
                  selected ? "border-accent" : "border-border"
                }`}
              >
                <AccountIcon type={type} />
                <span className="min-w-0">
                  <span
                    className={`block text-lg leading-tight font-semibold break-words tabular-nums ${sum < 0 ? "text-status-bad" : ""}`}
                  >
                    {formatFCFA(sum)}
                  </span>
                  <span className="mt-0.5 block text-xs font-medium text-muted">
                    {tt(`register.families.${type}`)}
                    {" · "}
                    {countLabel(accounts.length, "register.accountOne", "register.accountMany")}
                  </span>
                </span>
              </button>
              <span className="absolute right-0.5 top-0.5 z-10">
                <EduTip text={tt(`familyHelp.${type}`)} example={tt(`familyExample.${type}`)} />
              </span>
            </div>
          );
        })}
      </section>

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
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-2">
        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
          <Input
            aria-label={tt("register.search")}
            placeholder={tt("register.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select
            aria-label={tt("register.type")}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as AccountType | "ALL")}
          >
            <option value="ALL">{tt("register.allTypes")}</option>
            {(["CASH_REGISTER", "SAFE", "BANK", "MOBILE_MONEY", "OTHER"] as const).map((type) => (
              <option key={type} value={type}>
                {tt(`types.${type}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={tt("register.status")}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="ALL">{tt("register.allStatuses")}</option>
            <option value="ACTIVE">{tt("register.statusActive")}</option>
            <option value="ARCHIVED">{tt("register.statusArchived")}</option>
            <option value="OVERDRAFT">{tt("register.statusOverdraft")}</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>{countLabel(rows.length, "register.shownOne", "register.shownMany")}</span>
          {filtered && (
            <button
              type="button"
              className="min-h-11 font-semibold text-accent"
              onClick={clearFilters}
            >
              {tt("register.clear")}
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          {tt("register.empty")}
        </p>
      ) : (
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_7rem_8rem_9rem_9rem_7rem] gap-3 border-b border-border bg-surface-2 px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase lg:grid">
            <span>{tt("register.colAccount")}</span>
            <span>{tt("register.colType")}</span>
            <span>{tt("register.colRef")}</span>
            <span>{tt("register.colOpening")}</span>
            <span>{tt("register.colBalance")}</span>
            <span>{tt("register.colStatus")}</span>
          </div>
          <ul className="divide-y divide-border" data-testid="treasury-accounts">
            {rows.map((a) => (
              <li key={a.id}>
                <AccountLine account={a} />
              </li>
            ))}
          </ul>
        </div>
      )}

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

function AccountLine({ account }: { account: AccountRow }) {
  const methods =
    account.type === "CASH_REGISTER"
      ? tt("account.cashMethod")
      : account.paymentMethods.map((m) => t(`method.${m}`)).join(" · ");
  const detail = [account.site, account.bankName, methods].filter(Boolean).join(" · ");
  const status = account.archived
    ? { tone: "off" as const, label: tt("register.archived") }
    : account.balance < 0
      ? { tone: "bad" as const, label: tt("register.overdraft") }
      : { tone: "ok" as const, label: tt("register.active") };

  return (
    <Link
      href={`/tresorerie/comptes/${account.id}`}
      className={`grid min-h-11 min-w-0 gap-2 p-4 hover:bg-surface-2 lg:grid-cols-[minmax(0,1.5fr)_7rem_8rem_9rem_9rem_7rem] lg:items-center lg:gap-3 ${
        account.archived ? "opacity-60" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <AccountIcon type={account.type} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{account.name}</span>
          {detail ? <span className="block truncate text-xs text-muted">{detail}</span> : null}
        </span>
      </span>
      <Field label={tt("register.colType")}>{tt(`types.${account.type}`)}</Field>
      <Field label={tt("register.colRef")}>{account.accountRef ?? tt("register.noRef")}</Field>
      <Field label={tt("register.colOpening")}>
        <span className="tabular-nums">{formatFCFA(account.openingBalance)}</span>
      </Field>
      <Field label={tt("register.colBalance")}>
        <span
          className={`font-semibold tabular-nums ${account.balance < 0 ? "text-status-bad" : ""}`}
          data-testid={`balance-${account.name}`}
        >
          {formatFCFA(account.balance)}
        </span>
      </Field>
      <span>
        <StatusBadge tone={status.tone} label={status.label} />
      </span>
    </Link>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-3 lg:block">
      <span className="text-xs text-muted lg:hidden">{label}</span>
      <span className="text-sm">{children}</span>
    </span>
  );
}

function printRegister(total: number, rows: AccountRow[]) {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) return;
  const head = [
    tt("register.colAccount"),
    tt("register.colType"),
    tt("register.colRef"),
    tt("register.colOpening"),
    tt("register.colBalance"),
    tt("register.colStatus"),
  ];
  const body = rows
    .map((a) => {
      const status = a.archived
        ? tt("register.archived")
        : a.balance < 0
          ? tt("register.overdraft")
          : tt("register.active");
      return `<tr>${[
        a.name,
        tt(`types.${a.type}`),
        a.accountRef ?? tt("register.noRef"),
        formatFCFA(a.openingBalance),
        formatFCFA(a.balance),
        status,
      ]
        .map((cell) => `<td>${escapeHtml(cell)}</td>`)
        .join("")}</tr>`;
    })
    .join("");
  popup.document
    .write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(
    tt("title"),
  )}</title><style>
    body{font-family:system-ui,sans-serif;padding:24px;color:#111}
    h1{font-size:20px;margin:0 0 4px} p{margin:0 0 16px;color:#444}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd}
    th{font-size:11px;text-transform:uppercase;letter-spacing:.03em}
  </style></head><body>
    <h1>${escapeHtml(tt("title"))}</h1>
    <p>${escapeHtml(tt("total"))} : ${escapeHtml(formatFCFA(total))}</p>
    <table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody></table>
    <script>addEventListener("load",()=>print())</script>
  </body></html>`);
  popup.document.close();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
      <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}
