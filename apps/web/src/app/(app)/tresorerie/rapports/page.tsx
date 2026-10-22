"use client";

// M18 `/tresorerie/rapports` — rapport d'une période : ouverture, entrées, sorties, clôture,
// graphique entrées / sorties, détail par période, ventilations (modes, catégories, comptes) ;
// exports CSV et PDF (RG-M18-08).
import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  FileDown,
  FileText,
  Flag,
  Wallet,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { t } from "@/components/billing/i18n";
import { Kpi, Section, signedFCFA } from "@/components/cash/cash-ui";
import { tt } from "@/components/treasury/i18n";
import { InOutChart, today } from "@/components/treasury/treasury-ui";

type GroupBy = "day" | "week" | "month";
type Preset = "month" | "lastMonth" | "quarter" | "year";

const addDays = (key: string, days: number) => {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function preset(kind: Preset, todayKey: string): { from: string; to: string; groupBy: GroupBy } {
  const [y, m] = todayKey.split("-").map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, "0");
  if (kind === "month") return { from: `${y}-${pad(m)}-01`, to: todayKey, groupBy: "day" };
  if (kind === "lastMonth") {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return {
      from: `${py}-${pad(pm)}-01`,
      to: addDays(`${y}-${pad(m)}-01`, -1),
      groupBy: "day",
    };
  }
  if (kind === "quarter") return { from: addDays(todayKey, -89), to: todayKey, groupBy: "week" };
  return { from: `${y}-01-01`, to: todayKey, groupBy: "month" };
}

const frDate = (key: string) => key.split("-").reverse().join("/");

function bucketLabel(key: string, groupBy: GroupBy) {
  if (groupBy === "month") return `${key.slice(5, 7)}/${key.slice(2, 4)}`;
  if (groupBy === "week")
    return tt("reports.weekOf", { date: `${key.slice(8, 10)}/${key.slice(5, 7)}` });
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

export default function TreasuryReportsPage() {
  const todayKey = today("Africa/Abidjan");
  const initial = preset("month", todayKey);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [groupBy, setGroupBy] = useState<GroupBy>(initial.groupBy);
  const [accountId, setAccountId] = useState("");
  const accounts = trpc.treasury.accounts.useQuery();
  const valid = from <= to;
  const q = trpc.treasury.report.useQuery(
    { from, to, groupBy, accountId: accountId || undefined },
    { enabled: valid, placeholderData: (prev) => prev },
  );
  const exportHref = (format: "csv" | "pdf") =>
    `/api/tresorerie/rapport?${new URLSearchParams({
      from,
      to,
      groupBy,
      format,
      ...(accountId ? { accountId } : {}),
    }).toString()}`;
  const applyPreset = (kind: Preset) => {
    const p = preset(kind, todayKey);
    setFrom(p.from);
    setTo(p.to);
    setGroupBy(p.groupBy);
  };
  const r = q.data;
  // Le tableau ne garde que les périodes avec des mouvements ; le graphique montre toute la période.
  const activeRows = (r?.series ?? []).filter((s) => s.inflow !== 0 || s.outflow !== 0);

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pb-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/tresorerie"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={16} aria-hidden /> {tt("detail.back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{tt("reports.title")}</h1>
            <p className="mt-1 text-sm text-muted">{tt("reports.subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={exportHref("csv")}
              className="btn btn-secondary min-h-11"
              data-testid="export-csv"
            >
              <FileDown size={16} aria-hidden /> {tt("actions.exportCsv")}
            </a>
            <a
              href={exportHref("pdf")}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary min-h-11"
            >
              <FileText size={16} aria-hidden /> {tt("actions.exportPdf")}
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap gap-2">
          {(["month", "lastMonth", "quarter", "year"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => applyPreset(k)}
              className="h-9 rounded-full border border-border px-3 text-sm text-muted hover:border-primary hover:text-foreground"
            >
              {tt(`reports.presets.${k}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{tt("reports.from")}</span>
            <input
              type="date"
              className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{tt("reports.to")}</span>
            <input
              type="date"
              className="h-11 rounded-md border border-border bg-surface px-3 text-sm"
              value={to}
              min={from}
              max={todayKey}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">
            <span className="font-medium">{tt("reports.account")}</span>
            <select
              className="h-11 max-w-full rounded-md border border-border bg-surface pr-9 pl-3 text-sm"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">{tt("reports.allAccounts")}</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{tt("reports.groupBy")}</span>
            <div
              className="flex gap-1 rounded-lg bg-surface-2 p-1"
              role="group"
              aria-label={tt("reports.groupBy")}
            >
              {(["day", "week", "month"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={groupBy === g}
                  onClick={() => setGroupBy(g)}
                  className={`h-9 rounded-md px-3 text-sm font-medium ${
                    groupBy === g ? "bg-surface text-foreground shadow-sm" : "text-muted"
                  }`}
                >
                  {tt(`reports.groups.${g}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError || !r ? (
        <ErrorBox onRetry={() => q.refetch()} message={q.error?.message ?? tt("loadError")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="report-kpis">
            <Kpi icon={Flag} label={tt("reports.opening")} value={formatFCFA(r.opening)} />
            <Kpi
              icon={ArrowDownLeft}
              label={tt("reports.inflow")}
              value={formatFCFA(r.inflow)}
              tone="ok"
            />
            <Kpi icon={ArrowUpRight} label={tt("reports.outflow")} value={formatFCFA(r.outflow)} />
            <Kpi
              icon={Wallet}
              label={tt("reports.closing")}
              value={formatFCFA(r.closing)}
              testId="report-closing"
            />
          </div>
          {!accountId && <p className="-mt-2 text-xs text-muted">{tt("reports.internalNote")}</p>}

          <Section title={tt("reports.chart")}>
            <InOutChart series={r.series} labelOf={(k) => bucketLabel(k, groupBy)} />
          </Section>

          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
            <Section title={tt("reports.table")}>
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full min-w-[420px] text-sm" data-testid="report-table">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-2 pr-3 font-medium">{tt("reports.period")}</th>
                      <th className="py-2 pr-3 text-right font-medium">{tt("reports.inflow")}</th>
                      <th className="py-2 pr-3 text-right font-medium">{tt("reports.outflow")}</th>
                      <th className="py-2 text-right font-medium">{tt("reports.net")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {activeRows.map((s) => (
                      <tr key={s.key}>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {groupBy === "day" ? frDate(s.key) : bucketLabel(s.key, groupBy)}
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                          {formatFCFA(s.inflow)}
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                          {formatFCFA(s.outflow)}
                        </td>
                        <td
                          className={`py-2 text-right whitespace-nowrap tabular-nums ${
                            s.net < 0 ? "text-status-bad" : ""
                          }`}
                        >
                          {signedFCFA(s.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {activeRows.length === 0 && (
                    <tbody>
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-muted">
                          {tt("reports.chartEmpty")}
                        </td>
                      </tr>
                    </tbody>
                  )}
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td className="py-2 pr-3">{tt("reports.total")}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                        {formatFCFA(r.inflow)}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                        {formatFCFA(r.outflow)}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap tabular-nums">
                        {signedFCFA(r.net)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Section>

            <div className="flex min-w-0 flex-col gap-5">
              <Breakdown
                title={tt("reports.byMethod")}
                rows={r.inflowByMethod.map((m) => ({
                  label: t(`method.${m.method}`),
                  amount: m.amount,
                }))}
              />
              <Breakdown
                title={tt("reports.byCategory")}
                rows={r.outflowByCategory.map((c) => ({ label: c.category, amount: c.amount }))}
              />
              {r.accounts.length > 1 && (
                <Section title={tt("reports.byAccount")}>
                  <ul className="flex flex-col divide-y divide-border">
                    {r.accounts.map((a) => (
                      <li key={a.id} className="flex flex-col gap-0.5 py-2 text-sm">
                        <span className="flex justify-between gap-3">
                          <span className="font-medium">{a.name}</span>
                          <span className="font-semibold tabular-nums">
                            {formatFCFA(a.closing)}
                          </span>
                        </span>
                        <span className="text-xs text-muted">
                          {formatFCFA(a.opening)} · +{formatFCFA(a.inflow)} · −
                          {formatFCFA(a.outflow)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; amount: number }[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{tt("reports.chartEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.label} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span>{r.label}</span>
                <span className="font-medium tabular-nums">{formatFCFA(r.amount)}</span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${total > 0 ? Math.round((r.amount / total) * 100) : 0}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
