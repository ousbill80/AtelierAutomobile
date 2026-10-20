"use client";

// M12 §7 — onglets du tableau de bord en gestion complète (étape 6.1) : Synthèse, Atelier,
// Accueil, Clients et carte « Ma caisse du jour ». Les chiffres viennent du serveur
// (`dashboard.*`, formules de `core/reports`) : aucun calcul d'indicateur ici.
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { EmptyState, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import {
  appointmentStatusLabel,
  fmt,
  formatAmount,
  L,
  methodLabel,
  reminderTypeLabel,
  roStatusLabel,
} from "./labels";
import {
  BarList,
  CardsSkeleton,
  DailyChart,
  ErrorState,
  formatDateTime,
  formatPct,
  formatTime,
  KpiCard,
  Section,
} from "./parts";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export const PERIODS = ["today", "7d", "month", "prev_month", "30d", "quarter", "year"] as const;
export type Period = (typeof PERIODS)[number];
export type TabInput = { period: Period; custom?: { from: string; to: string }; siteId?: string };

type Overview = RouterOutputs["dashboard"]["overview"];
type Receivables = Overview["receivables"];

export function ReceivablesCard({ receivables }: { receivables: Receivables }) {
  return (
    <KpiCard
      label={L.cards.receivables}
      value={formatAmount(receivables.total)}
      sub={fmt(L.cards.receivablesOver30, { amount: formatAmount(receivables.over30) })}
      help={L.help.receivables}
      href="/creances?filtre=en-retard"
    />
  );
}

// ─── Synthèse (gestion complète, US-M12-01) ──────────────────────────────────

export function SummaryFull({ data }: { data: Overview }) {
  const s = data.sales;
  if (!s) return null;
  const natures = Object.keys(L.summary.natures) as (keyof typeof s.byNature)[];
  const empty = s.revenueHt.value === 0 && s.collected.value === 0 && data.receivables.total === 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={L.cards.revenueHt}
          value={formatAmount(s.revenueHt.value)}
          variation={s.revenueHt.variation}
          help={L.help.revenueHt}
          href="/rapports/ventes"
        />
        <KpiCard
          label={L.cards.collected}
          value={formatAmount(s.collected.value)}
          variation={s.collected.variation}
          help={L.help.collected}
          href="/rapports/encaissements"
        />
        <ReceivablesCard receivables={data.receivables} />
        <KpiCard
          label={L.cards.recovered}
          value={formatAmount(data.recovered.value)}
          variation={data.recovered.variation}
          help={L.help.recovered}
        />
      </div>
      {empty ? (
        <EmptyState title={L.states.empty} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {s.margins && (
              <KpiCard
                label={L.cards.grossMargin}
                value={formatPct(s.margins.grossRate)}
                sub={formatAmount(s.margins.grossMargin)}
                help={L.help.grossMargin}
                badge={s.margins.estimated ? L.cards.estimatedCost : undefined}
              />
            )}
            <KpiCard
              label={L.cards.avgTicket}
              value={s.avgTicket === null ? L.dash : formatAmount(s.avgTicket)}
              help={L.help.avgTicket}
            />
            <KpiCard
              label={L.cards.acceptance}
              value={formatPct(s.acceptance.countRate)}
              sub={fmt(L.cards.acceptanceValue, { pct: formatPct(s.acceptance.valueRate) })}
              help={L.help.acceptance}
              href="/devis"
            />
          </div>
          <Section title={L.summary.dailyRevenue} help={L.help.revenueHt}>
            <DailyChart points={s.daily} />
          </Section>
          <Section title={L.summary.byNature}>
            <BarList
              items={natures.map((n) => ({
                key: n,
                label: L.summary.natures[n],
                value: s.byNature[n],
              }))}
            />
          </Section>
        </>
      )}
    </div>
  );
}

// ─── Atelier (US-M12-03) ─────────────────────────────────────────────────────

export function WorkshopTab({ input, timeZone }: { input: TabInput; timeZone: string }) {
  const q = trpc.dashboard.workshop.useQuery(input);
  if (q.isLoading) return <CardsSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  const W = L.workshop;
  const statuses = Object.entries(d.statusCounts);
  const orderList = (
    orders: typeof d.late.orders,
    detail: (o: (typeof d.late.orders)[number]) => string,
  ) =>
    orders.length === 0 ? (
      <p className="text-sm text-muted">{W.none}</p>
    ) : (
      <ul className="divide-y divide-border">
        {orders.map((o) => (
          <li key={o.id}>
            <Link
              href={`/ordres/${o.id}`}
              className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm hover:underline"
            >
              <span className="min-w-0">
                <span className="font-medium">{o.number}</span> · {o.plate}
                <span className="block text-xs text-muted">{o.customerName}</span>
              </span>
              <span className="text-xs text-muted">{detail(o)}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="flex flex-col gap-4">
      <Section title={W.statusCounts}>
        {statuses.length === 0 ? (
          <p className="text-sm text-muted">{W.none}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {statuses.map(([status, count]) => (
              <li key={status}>
                <Link
                  href="/ordres"
                  className="flex min-h-11 items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm hover:underline"
                >
                  <span className="truncate">{roStatusLabel(status)}</span>
                  <span className="font-semibold">{count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={W.late}
          value={String(d.late.count)}
          badge={d.late.count > 0 ? `⚠ ${d.late.count}` : undefined}
        />
        <KpiCard label={W.waitingParts} value={String(d.waitingParts.count)} />
        <KpiCard
          label={`${W.occupancy} — ${W.real}`}
          value={formatPct(d.occupancy.capped.real)}
          help={L.help.occupancy}
        />
        <KpiCard
          label={`${W.occupancy} — ${W.planned}`}
          value={formatPct(d.occupancy.capped.planned)}
          help={L.help.occupancy}
        />
      </div>
      {d.sitesWithoutHours.length > 0 && (
        <p className="text-sm text-muted">
          {fmt(W.noHours, { sites: d.sitesWithoutHours.join(", ") })} —{" "}
          <Link href="/parametres/sites" className="underline">
            {W.setHours}
          </Link>
        </p>
      )}
      <Section title={W.late}>
        {orderList(d.late.orders, (o) =>
          fmt(W.promisedAt, { date: formatDateTime(o.promisedAt, timeZone) }),
        )}
      </Section>
      <Section title={W.waitingParts}>
        {orderList(d.waitingParts.orders, (o) =>
          fmt(W.since, { date: formatDateTime(o.waitingPartsSince, timeZone) }),
        )}
      </Section>
      {d.mechanics && (
        <Section title={W.mechanics} help={L.help.efficiency}>
          {d.mechanics.length === 0 ? (
            <p className="text-sm text-muted">{W.none}</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.mechanics.map((m) => (
                <li key={m.membershipId} className="flex flex-col gap-1 py-2 text-sm">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{m.name}</span>
                    {m.toCheck && <StatusBadge tone="warn">{W.toCheck}</StatusBadge>}
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    <span>
                      {W.presence} : {m.presenceH > 0 ? `${m.presenceH} h` : W.noPresence}
                    </span>
                    <span>
                      {W.worked} : {m.workedH} h
                    </span>
                    <span>
                      {W.billed} : {m.billedH} h
                    </span>
                    <span>
                      {W.efficiency} : {m.efficiency === null ? L.dash : `${m.efficiency} %`}
                    </span>
                    <span>
                      {W.productivity} : {m.productivity === null ? L.dash : `${m.productivity} %`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}

// ─── Accueil (US-M12-04) ─────────────────────────────────────────────────────

export function FrontDeskTab({ input }: { input: TabInput }) {
  const q = trpc.dashboard.frontDesk.useQuery(input);
  if (q.isLoading) return <CardsSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  const F = L.frontDesk;
  const tz = d.timeZone;
  const row = (key: string, href: string, title: string, sub: string, right?: string) => (
    <li key={key}>
      <Link
        href={href}
        className="flex min-h-11 items-center justify-between gap-2 py-2 text-sm hover:underline"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-xs text-muted">{sub}</span>
        </span>
        {right && <span className="shrink-0 text-xs">{right}</span>}
      </Link>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      {d.unreadConversations !== null && (
        <div className="grid grid-cols-2 gap-3">
          <KpiCard label={F.unread} value={String(d.unreadConversations)} href="/messages" />
        </div>
      )}
      {d.appointments && (
        <Section title={F.appointments}>
          {d.appointments.length === 0 ? (
            <p className="text-sm text-muted">{F.noAppointments}</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.appointments.map((a) =>
                row(
                  a.id,
                  "/rendez-vous/aujourdhui",
                  `${formatTime(a.startsAt, tz)} · ${a.customerName}`,
                  a.plate ?? "",
                  appointmentStatusLabel(a.status),
                ),
              )}
            </ul>
          )}
        </Section>
      )}
      {d.reminders && (
        <Section
          title={F.reminders}
          action={
            <Link href="/relances" className="text-sm underline">
              {fmt(F.seeAll, { count: d.reminders.count })}
            </Link>
          }
        >
          {d.reminders.items.length === 0 ? (
            <p className="text-sm text-muted">{F.none}</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.reminders.items.map((r) =>
                row(r.id, "/relances", r.customerName, reminderTypeLabel(r.type)),
              )}
            </ul>
          )}
        </Section>
      )}
      {d.quotes && (
        <Section title={F.quotes}>
          {d.quotes.items.length === 0 ? (
            <p className="text-sm text-muted">{F.none}</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.quotes.items.map((x) =>
                row(
                  x.id,
                  `/devis/${x.id}`,
                  `${x.number} · ${x.customerName}`,
                  formatDateTime(x.sentAt, tz),
                  formatAmount(x.total),
                ),
              )}
            </ul>
          )}
        </Section>
      )}
      {d.ready && (
        <Section title={F.ready}>
          {d.ready.length === 0 ? (
            <p className="text-sm text-muted">{F.none}</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.ready.map((r) =>
                row(
                  r.id,
                  `/ordres/${r.id}`,
                  `${r.number} · ${r.plate}`,
                  r.customerName,
                  formatDateTime(r.readyAt, tz),
                ),
              )}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}

// ─── Clients ─────────────────────────────────────────────────────────────────

export function CustomersTab({ input }: { input: TabInput }) {
  const q = trpc.dashboard.customers.useQuery(input);
  if (q.isLoading) return <CardsSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  const C = L.customersTab;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={C.active} value={String(d.counts.active)} href="/rapports/clients" />
        <KpiCard label={C.new} value={String(d.counts.new)} />
        <KpiCard label={C.lost} value={String(d.counts.lost)} href="/rapports/clients" />
      </div>
      <Section
        title={C.topParts}
        action={
          <Link href="/rapports/top-pieces" className="text-sm underline">
            {L.reportsLink}
          </Link>
        }
      >
        {d.topParts.length === 0 ? (
          <p className="text-sm text-muted">{L.states.empty}</p>
        ) : (
          <ol className="divide-y divide-border">
            {d.topParts.map((p, i) => (
              <li key={p.key} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {i + 1}. {p.label}
                  </span>
                  <span className="block text-xs text-muted">
                    {C.quantity} {p.quantity} · {fmt(C.orders, { count: p.repairOrders })}
                    {"margin" in p && typeof p.margin === "number"
                      ? ` · ${fmt(C.margin, { amount: formatAmount(p.margin) })}`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 font-semibold">{formatAmount(p.ht)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

// ─── CASHIER : « Ma caisse du jour » ─────────────────────────────────────────

export function CashierCard({ timeZone }: { timeZone: string }) {
  const q = trpc.dashboard.cashier.useQuery();
  if (q.isLoading) return <CardsSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <Section title={L.cashier.title}>
      {!d.session ? (
        <p className="text-sm text-muted">{L.cashier.noSession}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            {fmt(L.cashier.openedAt, {
              date: formatDateTime(d.session.openedAt, timeZone),
              site: d.session.siteName,
            })}
          </p>
          <p className="text-2xl font-semibold">
            {L.cashier.total} : {formatAmount(d.total)}
          </p>
          <BarList
            items={Object.entries(d.byMethod).map(([method, amount]) => ({
              key: method,
              label: methodLabel(method),
              value: amount,
            }))}
          />
        </div>
      )}
    </Section>
  );
}
