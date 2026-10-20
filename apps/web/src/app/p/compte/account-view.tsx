"use client";

// M14 US-M14-08 / US-M14-09 — « Mon espace » : onglets Véhicules · Devis · Factures · Rendez-vous
// et, pour un responsable flotte, la vue flotte (filtre, export CSV, total dû). Chaque document
// s'ouvre par une référence opaque (jamais d'identifiant interne dans la page).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { fmtBusinessDay, fmtDateTime, fmtDay, fmtFCFA, fmtKm, tpl } from "../_components/format";
import type { PortalLabels } from "../_components/labels";
import { PortalFrame, PortalSkeleton } from "../_components/portal-frame";

type Tab = "vehicles" | "quotes" | "invoices" | "appointments" | "fleet";
type Kind = "vehicle" | "quote" | "invoice" | "repair_order" | "appointment";

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function AccountView({ labels }: { labels: PortalLabels }) {
  const L = labels.account;
  const T = labels.tracking;
  const router = useRouter();
  const query = trpc.portal.account.overview.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [tab, setTab] = useState<Tab>("vehicles");
  const [filter, setFilter] = useState("");
  const open = trpc.portal.account.open.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const logout = trpc.portal.auth.logout.useMutation({
    onSuccess: () => router.push("/p/connexion"),
  });
  const data = query.data;
  const fleetVehicles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.vehicles ?? []).filter(
      (v) =>
        !q ||
        [v.plate, v.fleetNumber, v.driverName, v.account]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q)),
    );
  }, [data, filter]);

  if (query.isLoading) return <PortalSkeleton label={labels.loading} />;
  if (query.isError || !data) {
    const expired = query.error?.data?.code === "UNAUTHORIZED";
    return (
      <PortalFrame labels={labels}>
        <section role="alert" className="flex flex-col gap-3 rounded-lg bg-surface p-6 text-center">
          <p>{expired ? L.sessionExpired : labels.networkError}</p>
          {!expired && (
            <button
              type="button"
              className="btn btn-secondary min-h-12"
              onClick={() => query.refetch()}
            >
              {labels.retry}
            </button>
          )}
        </section>
      </PortalFrame>
    );
  }

  const hasFleet = data.accounts.some((a) => a.fleet);
  const tabs: Tab[] = [
    "vehicles",
    "quotes",
    "invoices",
    "appointments",
    ...(hasFleet ? (["fleet"] as Tab[]) : []),
  ];
  const totalDue = data.accounts.reduce((s, a) => s + a.balance, 0);
  const openDoc = (kind: Kind, ref: string) => open.mutate({ kind, ref });

  const exportCsv = () => {
    const c = L.columns;
    const header = [
      c.plate,
      c.fleetNumber,
      c.driver,
      c.mileage,
      c.inspection,
      c.service,
      c.order,
      c.account,
    ];
    const rows = fleetVehicles.map((v) => [
      v.plate,
      v.fleetNumber,
      v.driverName,
      v.mileage,
      v.inspection.date ? fmtBusinessDay(v.inspection.date) : "",
      v.service.date ? fmtBusinessDay(v.service.date) : "",
      v.openOrder?.number ?? "",
      v.account,
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "flotte.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PortalFrame garage={data.garage} labels={labels}>
      <section className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{L.title}</h1>
        <p className="text-sm text-muted">{tpl(L.connectedAs, { phone: data.phone ?? "" })}</p>
        {totalDue > 0 && (
          <p className="font-medium">{tpl(L.balance, { amount: fmtFCFA(totalDue) })}</p>
        )}
      </section>

      <div role="tablist" aria-label={L.title} className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`btn min-h-12 ${tab === t ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab(t)}
          >
            {L.tabs[t]}
          </button>
        ))}
      </div>

      <section role="tabpanel" className="flex flex-col gap-2">
        {tab === "vehicles" &&
          (data.vehicles.length === 0 ? (
            <p className="rounded-lg bg-surface p-3 text-muted">{L.noVehicles}</p>
          ) : (
            data.vehicles.map((v) => (
              <article
                key={v.ref}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <p className="font-medium">
                  {v.plate} · {v.label}
                </p>
                <p className="text-sm text-muted">
                  {labels.vehicle.inspection} :{" "}
                  {v.inspection.date ? fmtBusinessDay(v.inspection.date) : labels.vehicle.unknown} (
                  {labels.vehicle.badges[v.inspection.state]})
                </p>
                <button
                  type="button"
                  className="btn btn-secondary min-h-12"
                  onClick={() => openDoc("vehicle", v.ref)}
                >
                  {L.open}
                </button>
                {v.openOrder && (
                  <button
                    type="button"
                    className="btn btn-primary min-h-12"
                    onClick={() => openDoc("repair_order", v.openOrder!.ref)}
                  >
                    {tpl(L.followRepair, { number: v.openOrder.number })}
                  </button>
                )}
              </article>
            ))
          ))}

        {tab === "quotes" &&
          (data.quotes.length === 0 ? (
            <p className="rounded-lg bg-surface p-3 text-muted">{L.noQuotes}</p>
          ) : (
            data.quotes.map((q) => (
              <article
                key={q.ref}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{tpl(T.quote, { number: q.number })}</span>
                  <span>{fmtFCFA(q.total)}</span>
                </div>
                <p className="text-sm text-muted">
                  {fmtDay(q.date)} ·{" "}
                  {(T.quoteStatus as Record<string, string>)[q.status] ?? q.status}
                </p>
                <button
                  type="button"
                  className={`btn min-h-12 ${q.awaitingDecision ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => openDoc("quote", q.ref)}
                >
                  {q.awaitingDecision ? T.decideQuote : T.seeQuote}
                </button>
              </article>
            ))
          ))}

        {tab === "invoices" &&
          (data.invoices.length === 0 ? (
            <p className="rounded-lg bg-surface p-3 text-muted">{L.noInvoices}</p>
          ) : (
            data.invoices.map((i) => (
              <article
                key={i.ref}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{tpl(T.invoice, { number: i.number })}</span>
                  <span>{fmtFCFA(i.total)}</span>
                </div>
                <p className="text-sm text-muted">
                  {fmtDay(i.date)} ·{" "}
                  {(T.invoiceStatus as Record<string, string>)[i.status] ?? i.status}
                </p>
                <button
                  type="button"
                  className={`btn min-h-12 ${i.balance > 0 ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => openDoc("invoice", i.ref)}
                >
                  {i.balance > 0 ? tpl(T.payInvoice, { amount: fmtFCFA(i.balance) }) : T.seeInvoice}
                </button>
              </article>
            ))
          ))}

        {tab === "appointments" &&
          (data.appointments.length === 0 ? (
            <p className="rounded-lg bg-surface p-3 text-muted">{L.noAppointments}</p>
          ) : (
            data.appointments.map((a) => (
              <article
                key={a.ref}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <p className="font-medium">{fmtDateTime(a.startsAt)}</p>
                <button
                  type="button"
                  className="btn btn-secondary min-h-12"
                  onClick={() => openDoc("appointment", a.ref)}
                >
                  {L.open}
                </button>
              </article>
            ))
          ))}

        {tab === "fleet" && (
          <>
            <h2 className="font-semibold">{L.fleetTitle}</h2>
            <label className="flex flex-col gap-1">
              <span className="text-sm">{L.fleetFilter}</span>
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="min-h-12 rounded-md border border-border bg-surface px-3 text-base"
              />
            </label>
            <button type="button" className="btn btn-secondary min-h-12" onClick={exportCsv}>
              {L.exportCsv}
            </button>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-2">{L.columns.plate}</th>
                    <th className="p-2">{L.columns.fleetNumber}</th>
                    <th className="p-2">{L.columns.driver}</th>
                    <th className="p-2">{L.columns.mileage}</th>
                    <th className="p-2">{L.columns.inspection}</th>
                    <th className="p-2">{L.columns.service}</th>
                    <th className="p-2">{L.columns.order}</th>
                  </tr>
                </thead>
                <tbody>
                  {fleetVehicles.map((v) => (
                    <tr key={v.ref} className="border-b border-border">
                      <td className="p-2 font-medium">{v.plate}</td>
                      <td className="p-2">{v.fleetNumber ?? "—"}</td>
                      <td className="p-2">{v.driverName ?? "—"}</td>
                      <td className="p-2">{v.mileage !== null ? fmtKm(v.mileage) : "—"}</td>
                      <td className="p-2">
                        {v.inspection.date ? fmtBusinessDay(v.inspection.date) : "—"} (
                        {labels.vehicle.badges[v.inspection.state]})
                      </td>
                      <td className="p-2">
                        {v.service.date ? fmtBusinessDay(v.service.date) : "—"}
                      </td>
                      <td className="p-2">{v.openOrder?.number ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <button
        type="button"
        className="btn btn-secondary min-h-12"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        {L.logout}
      </button>
    </PortalFrame>
  );
}
