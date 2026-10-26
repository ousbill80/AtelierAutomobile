"use client";

// M12 §7 — onglets du tableau de bord en gestion complète (étape 6.1) : Synthèse, Atelier,
// Accueil, Clients et carte « Ma caisse du jour ». Les chiffres viennent du serveur
// (`dashboard.*`, formules de `core/reports`) : aucun calcul d'indicateur ici.
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { EmptyState, StatusBadge, type StatusTone } from "@atelieros/ui";
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
  EmptyLine,
  ErrorState,
  formatDateTime,
  formatPct,
  formatTime,
  KpiCard,
  ListRow,
  Section,
} from "./parts";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export const PERIODS = ["today", "7d", "month", "prev_month", "30d", "quarter", "year"] as const;
export type Period = (typeof PERIODS)[number];
export type TabInput = { period: Period; custom?: { from: string; to: string }; siteId?: string };

type Overview = RouterOutputs["dashboard"]["overview"];
type Receivables = Overview["receivables"];

/** Teinte des statuts d'OR (toujours accompagnée du libellé). */
const RO_STATUS_TONE: Record<string, StatusTone> = {
  CHECKED_IN: "off",
  DIAGNOSING: "warn",
  AWAITING_APPROVAL: "warn",
  APPROVED: "warn",
  IN_PROGRESS: "warn",
  WAITING_PARTS: "bad",
  QUALITY_CHECK: "warn",
  READY: "ok",
};
const APPOINTMENT_TONE: Record<string, StatusTone> = {
  BOOKED: "off",
  CONFIRMED: "ok",
  ARRIVED: "ok",
  COMPLETED: "ok",
  NO_SHOW: "bad",
  CANCELLED: "bad",
};

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
          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <Section title={L.summary.dailyRevenue} help={L.help.revenueHt}>
                <DailyChart points={s.daily} />
              </Section>
            </div>
            <Section title={L.summary.byNature}>
              <BarList
                items={natures.map((n) => ({
                  key: n,
                  label: L.summary.natures[n],
                  value: s.byNature[n],
                }))}
              />
            </Section>
          </div>
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
      <EmptyLine>{W.none}</EmptyLine>
    ) : (
      <ul className="divide-y divide-border">
        {orders.map((o) => (
          <ListRow
            key={o.id}
            href={`/ordres/${o.id}`}
            title={`${o.number} · ${o.plate}`}
            sub={o.customerName}
            right={<span className="text-xs text-muted">{detail(o)}</span>}
          />
        ))}
      </ul>
    );
  return (
    <div className="flex flex-col gap-4">
      <Section title={W.statusCounts}>
        {statuses.length === 0 ? (
          <EmptyLine>{W.none}</EmptyLine>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statuses.map(([status, count]) => (
              <li key={status}>
                <Link
                  href="/ordres"
                  className="flex min-h-20 flex-col justify-between gap-2 rounded-lg border border-border bg-surface-2/50 p-3 transition-colors hover:bg-surface-2"
                >
                  <StatusBadge tone={RO_STATUS_TONE[status] ?? "off"}>
                    {roStatusLabel(status)}
                  </StatusBadge>
                  <span className="text-2xl font-bold">{count}</span>
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
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
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
      </div>
      {d.mechanics && (
        <Section title={W.mechanics} help={L.help.efficiency}>
          {d.mechanics.length === 0 ? (
            <EmptyLine>{W.none}</EmptyLine>
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
  const appointments = d.appointments;
  return (
    <div className="flex flex-col gap-4">
      {/* Toutes les cartes sur une ligne en grand écran, quel que soit leur nombre. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
        {appointments && (
          <KpiCard
            label={F.kpiAppointments}
            value={String(appointments.length)}
            href="/rendez-vous/aujourdhui"
          />
        )}
        {d.reminders && (
          <KpiCard label={F.kpiReminders} value={String(d.reminders.count)} href="/relances" />
        )}
        {d.quotes && <KpiCard label={F.kpiQuotes} value={String(d.quotes.count)} href="/devis" />}
        {d.ready && <KpiCard label={F.kpiReady} value={String(d.ready.length)} href="/ordres" />}
        {d.unreadConversations !== null && (
          <KpiCard label={F.unread} value={String(d.unreadConversations)} href="/messages" />
        )}
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {appointments && (
          <Section title={F.appointments}>
            {appointments.length === 0 ? (
              <EmptyLine>{F.noAppointments}</EmptyLine>
            ) : (
              <ul className="divide-y divide-border">
                {appointments.map((a) => (
                  <ListRow
                    key={a.id}
                    href="/rendez-vous/aujourdhui"
                    title={`${formatTime(a.startsAt, tz)} · ${a.customerName}`}
                    sub={a.plate ?? undefined}
                    right={
                      <StatusBadge tone={APPOINTMENT_TONE[a.status] ?? "off"}>
                        {appointmentStatusLabel(a.status)}
                      </StatusBadge>
                    }
                  />
                ))}
              </ul>
            )}
          </Section>
        )}
        {d.reminders && (
          <Section
            title={F.reminders}
            action={
              <Link href="/relances" className="text-sm font-medium text-accent hover:underline">
                {fmt(F.seeAll, { count: d.reminders.count })} →
              </Link>
            }
          >
            {d.reminders.items.length === 0 ? (
              <EmptyLine>{F.none}</EmptyLine>
            ) : (
              <ul className="divide-y divide-border">
                {d.reminders.items.map((r) => (
                  <ListRow
                    key={r.id}
                    href="/relances"
                    title={r.customerName}
                    sub={reminderTypeLabel(r.type)}
                    right={<StatusBadge tone="warn">{F.kpiReminders}</StatusBadge>}
                  />
                ))}
              </ul>
            )}
          </Section>
        )}
        {d.quotes && (
          <Section title={F.quotes}>
            {d.quotes.items.length === 0 ? (
              <EmptyLine>{F.none}</EmptyLine>
            ) : (
              <ul className="divide-y divide-border">
                {d.quotes.items.map((x) => (
                  <ListRow
                    key={x.id}
                    href={`/devis/${x.id}`}
                    title={`${x.number} · ${x.customerName}`}
                    sub={formatDateTime(x.sentAt, tz)}
                    right={<span className="font-medium">{formatAmount(x.total)}</span>}
                  />
                ))}
              </ul>
            )}
          </Section>
        )}
        {d.ready && (
          <Section title={F.ready}>
            {d.ready.length === 0 ? (
              <EmptyLine>{F.none}</EmptyLine>
            ) : (
              <ul className="divide-y divide-border">
                {d.ready.map((r) => (
                  <ListRow
                    key={r.id}
                    href={`/ordres/${r.id}`}
                    title={`${r.number} · ${r.plate}`}
                    sub={r.customerName}
                    right={
                      <span className="text-xs text-muted">{formatDateTime(r.readyAt, tz)}</span>
                    }
                  />
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>
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
          <Link
            href="/rapports/top-pieces"
            className="text-sm font-medium text-accent hover:underline"
          >
            {L.reportsLink} →
          </Link>
        }
      >
        {d.topParts.length === 0 ? (
          <EmptyLine>{L.states.empty}</EmptyLine>
        ) : (
          <ol className="divide-y divide-border">
            {d.topParts.map((p, i) => (
              <ListRow
                key={p.key}
                title={
                  <span className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">
                      {i + 1}
                    </span>
                    <span className="truncate">{p.label}</span>
                  </span>
                }
                sub={`${C.quantity} ${p.quantity} · ${fmt(C.orders, { count: p.repairOrders })}${
                  "margin" in p && typeof p.margin === "number"
                    ? ` · ${fmt(C.margin, { amount: formatAmount(p.margin) })}`
                    : ""
                }`}
                right={<span className="font-semibold">{formatAmount(p.ht)}</span>}
              />
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
    <Section
      title={L.cashier.title}
      action={
        <Link href="/caisse" className="text-sm font-medium text-accent hover:underline">
          {L.cashier.goToCash} →
        </Link>
      }
    >
      {!d.session ? (
        <EmptyLine>{L.cashier.noSession}</EmptyLine>
      ) : (
        <div className="flex flex-col gap-4">
          <StatusBadge tone="ok">
            {fmt(L.cashier.openedAt, {
              date: formatDateTime(d.session.openedAt, timeZone),
              site: d.session.siteName,
            })}
          </StatusBadge>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {L.cashier.total}
            </p>
            <p className="text-3xl font-bold tracking-tight">{formatAmount(d.total)}</p>
          </div>
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
