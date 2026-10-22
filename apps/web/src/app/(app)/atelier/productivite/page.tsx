"use client";

// M06 US-M06-12 / RG-M06-09/10 — /atelier/productivite : par mécanicien, présence, pointé,
// facturé, reprise, efficacité, productivité, rendement, coût MO ; export CSV.
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  Gauge,
  TrendingUp,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, Input, PageHead, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { fromLocalInput } from "@/components/repair-orders/i18n";
import { downloadCsv, tw } from "@/components/workshop/i18n";

const TZ = "Africa/Abidjan";

/** Lundi de la semaine en cours (`yyyy-MM-dd`, fuseau de l'organisation). */
function mondayKey() {
  const key = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function shiftWeek(current: string, deltaDays: number): string {
  const d = new Date(`${current}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

const pct = (v: number | null) => (v === null ? "—" : `${v} %`);

export default function ProductivityPage() {
  const [week, setWeek] = useState(mondayKey);
  const range = useMemo(() => {
    const from = fromLocalInput(`${week}T00:00`, TZ) ?? new Date();
    return { from, to: new Date(from.getTime() + 7 * 86_400_000) };
  }, [week]);
  const rows = trpc.workshop.productivity.useQuery(range);

  const rawData = useMemo(() => rows.data ?? [], [rows.data]);

  // Statistiques d'ensemble atelier pour la semaine
  const stats = useMemo(() => {
    if (rawData.length === 0) {
      return { totalPresence: 0, totalWorked: 0, totalBilled: 0, avgEff: 0, avgProd: 0, avgOverall: 0, totalLaborCost: 0 };
    }
    const totalPresence = Math.round(rawData.reduce((s, r) => s + (r.presenceH ?? 0), 0) * 10) / 10;
    const totalWorked = Math.round(rawData.reduce((s, r) => s + (r.workedH ?? 0), 0) * 10) / 10;
    const totalBilled = Math.round(rawData.reduce((s, r) => s + (r.billedH ?? 0), 0) * 10) / 10;
    const totalLaborCost = rawData.reduce((s, r) => s + (r.laborCost ?? 0), 0);

    const effRows = rawData.filter((r) => r.efficiency !== null);
    const avgEff = effRows.length
      ? Math.round(effRows.reduce((s, r) => s + (r.efficiency ?? 0), 0) / effRows.length)
      : 0;

    const prodRows = rawData.filter((r) => r.productivity !== null);
    const avgProd = prodRows.length
      ? Math.round(prodRows.reduce((s, r) => s + (r.productivity ?? 0), 0) / prodRows.length)
      : 0;

    const overallRows = rawData.filter((r) => r.overall !== null);
    const avgOverall = overallRows.length
      ? Math.round(overallRows.reduce((s, r) => s + (r.overall ?? 0), 0) / overallRows.length)
      : 0;

    return { totalPresence, totalWorked, totalBilled, avgEff, avgProd, avgOverall, totalLaborCost };
  }, [rawData]);

  const headers = [
    tw("productivity.mechanic"),
    tw("productivity.presence"),
    tw("productivity.worked"),
    tw("productivity.billed"),
    tw("productivity.rework"),
    tw("productivity.efficiency"),
    tw("productivity.productivity"),
    tw("productivity.overall"),
    tw("productivity.laborCost"),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHead
        title={tw("tabs.productivity")}
        description={tw("productivity.description")}
        actions={
          <Button
            variant="secondary"
            disabled={!rows.data}
            onClick={() =>
              rows.data &&
              downloadCsv(`productivite-${week}.csv`, [
                headers,
                ...rows.data.map((r) => [
                  r.name,
                  r.presenceH,
                  r.workedH,
                  r.billedH,
                  r.reworkH,
                  r.efficiency,
                  r.productivity,
                  r.overall,
                  r.laborCost,
                ]),
              ])
            }
          >
            <Download className="size-4" aria-hidden />
            {tw("exportCsv")}
          </Button>
        }
      />

      {/* KPI Cards / Synthèse Productivité Atelier */}
      {rawData.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-status-ok">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.efficiencyAvg")}</span>
              <Gauge className="size-4 text-status-ok" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-ok">{stats.avgEff} %</span>
            <span className="text-xs text-muted">Facturé / Pointé</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-accent">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.productivityAvg")}</span>
              <TrendingUp className="size-4 text-accent" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-accent">{stats.avgProd} %</span>
            <span className="text-xs text-muted">Pointé / Présence</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.overallAvg")}</span>
              <CheckCircle2 className="size-4 text-muted" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{stats.avgOverall} %</span>
            <span className="text-xs text-muted">Rendement total</span>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.billedHours")}</span>
              <Clock className="size-4 text-muted" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{stats.totalBilled} h</span>
            <span className="text-xs text-muted">{formatFCFA(stats.totalLaborCost)} MO</span>
          </div>
        </div>
      ) : null}

      {/* Navigation temporelle de la semaine */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setWeek(shiftWeek(week, -7))}
            aria-label="Semaine précédente"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Semaine du</span>
            <Input
              type="date"
              value={week}
              onChange={(e) => e.target.value && setWeek(e.target.value)}
              className="max-w-[170px]"
            />
          </div>
          <Button
            variant="ghost"
            onClick={() => setWeek(shiftWeek(week, 7))}
            aria-label="Semaine suivante"
          >
            <ArrowRight className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" onClick={() => setWeek(mondayKey())} className="text-xs">
            Cette semaine
          </Button>
        </div>

        <p className="text-xs text-muted">{tw("productivity.legend")}</p>
      </div>

      {rows.isLoading ? (
        <ListSkeleton rows={3} />
      ) : rows.isError || !rows.data ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void rows.refetch()} />
      ) : rows.data.length === 0 ? (
        <EmptyState title={tw("productivity.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => {
                const effNum = r.efficiency;
                return (
                  <tr key={r.membershipId} className="border-t border-border hover:bg-surface-2/40 transition">
                    <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                    <td className="num px-3 py-2.5 text-muted">{r.presenceH} h</td>
                    <td className="num px-3 py-2.5">{r.workedH} h</td>
                    <td className="num px-3 py-2.5 font-semibold text-foreground">{r.billedH} h</td>
                    <td className="num px-3 py-2.5 text-muted">{r.reworkH} h</td>
                    <td className="num px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-semibold ${
                            effNum !== null && effNum >= 100
                              ? "text-status-ok"
                              : effNum !== null && effNum < 80
                              ? "text-status-bad"
                              : "text-foreground"
                          }`}
                        >
                          {pct(r.efficiency)}
                        </span>
                        {r.toCheck ? (
                          <StatusBadge tone="warn">
                            <AlertTriangle className="size-3" aria-hidden />
                            {tw("productivity.toCheck")}
                          </StatusBadge>
                        ) : null}
                      </div>
                    </td>
                    <td className="num px-3 py-2.5">{pct(r.productivity)}</td>
                    <td className="num px-3 py-2.5 font-medium">{pct(r.overall)}</td>
                    <td className="num px-3 py-2.5 font-mono font-medium">{formatFCFA(r.laborCost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
