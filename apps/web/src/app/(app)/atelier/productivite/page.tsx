"use client";

// M06 US-M06-12 / RG-M06-09/10 — /atelier/productivite : par mécanicien, présence, pointé,
// facturé, reprise, efficacité, productivité, rendement, coût MO ; export CSV.
import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
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

const pct = (v: number | null) => (v === null ? "—" : `${v} %`);

export default function ProductivityPage() {
  const [week, setWeek] = useState(mondayKey);
  const range = useMemo(() => {
    const from = fromLocalInput(`${week}T00:00`, TZ) ?? new Date();
    return { from, to: new Date(from.getTime() + 7 * 86_400_000) };
  }, [week]);
  const rows = trpc.workshop.productivity.useQuery(range);

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
    <div className="flex min-w-0 flex-col gap-4">
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
            {tw("exportCsv")}
          </Button>
        }
      />
      <label className="flex max-w-xs flex-col gap-1 text-sm">
        {tw("productivity.week")}
        <Input
          type="date"
          value={week}
          onChange={(e) => e.target.value && setWeek(e.target.value)}
        />
      </label>
      <p className="text-xs text-muted">{tw("productivity.legend")}</p>
      {rows.isLoading ? (
        <ListSkeleton rows={3} />
      ) : rows.isError || !rows.data ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void rows.refetch()} />
      ) : rows.data.length === 0 ? (
        <EmptyState title={tw("productivity.empty")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                {headers.map((h) => (
                  <th key={h} className="px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => (
                <tr key={r.membershipId} className="border-t border-border">
                  <td className="px-2 py-2 font-medium">{r.name}</td>
                  <td className="num px-2 py-2">{r.presenceH}</td>
                  <td className="num px-2 py-2">{r.workedH}</td>
                  <td className="num px-2 py-2">{r.billedH}</td>
                  <td className="num px-2 py-2">{r.reworkH}</td>
                  <td className="num px-2 py-2">
                    {pct(r.efficiency)}
                    {r.toCheck ? (
                      <StatusBadge tone="warn">
                        <AlertTriangle className="size-3" aria-hidden />
                        {tw("productivity.toCheck")}
                      </StatusBadge>
                    ) : null}
                  </td>
                  <td className="num px-2 py-2">{pct(r.productivity)}</td>
                  <td className="num px-2 py-2">{pct(r.overall)}</td>
                  <td className="num px-2 py-2">{formatFCFA(r.laborCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
