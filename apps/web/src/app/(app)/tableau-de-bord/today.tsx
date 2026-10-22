"use client";

// Onglet « Aujourd'hui » : vue du jour de l'atelier (véhicules, caisse, VT à préparer,
// relances, dossiers assurance, impayés, encaissements 7 j). Chaque bloc n'apparaît que si
// `dashboard.today` le renvoie (permission de lecture du module). Les actions à effet
// (clôture de caisse, relance des impayés) se font dans leur module, avec validation humaine.
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { DataTable, EmptyState, PlateBadge, StatusBadge, type StatusTone } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { fmt, formatAmount, formatDay, L, methodLabel, reminderTypeLabel } from "./labels";
import { CardsSkeleton, ErrorState, formatTime, KpiCard, Section } from "./parts";
import type { TabInput } from "./tabs";

type Today = inferRouterOutputs<AppRouter>["dashboard"]["today"];
type WorkshopStage = keyof typeof T.workshop.stages;
type InspectionBand = keyof typeof T.inspections.bands;
type FollowUp = keyof typeof T.inspections.followUps;
type ClaimStage = keyof typeof T.claims.stages;

const T = L.today;

const STAGE_TONE: Record<WorkshopStage, StatusTone> = {
  checkedIn: "off",
  diagnosis: "warn",
  repair: "warn",
  ready: "ok",
};
const BAND_TONE: Record<InspectionBand, StatusTone> = { j60: "off", j30: "warn", j15: "bad" };
const FOLLOW_UP_TONE: Record<FollowUp, StatusTone> = {
  booked: "ok",
  toCall: "bad",
  read: "ok",
  sent: "off",
  toApprove: "warn",
  planned: "off",
  none: "off",
};
const CLAIM_TONE: Record<ClaimStage, StatusTone> = {
  awaitingApproval: "off",
  approved: "warn",
  invoiced: "ok",
  late: "bad",
};
/** Modes de paiement toujours affichés dans la caisse du jour, même à zéro. */
const MAIN_METHODS = ["CASH", "ORANGE_MONEY", "WAVE", "MTN_MOMO", "BANK_TRANSFER"];

const linkClass = "text-sm font-medium text-accent underline-offset-2 hover:underline";

export function TodayTab({ input, timeZone }: { input: TabInput; timeZone: string }) {
  const q = trpc.dashboard.today.useQuery({ period: input.period, siteId: input.siteId });
  if (q.isLoading) return <CardsSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const data = q.data;
  const { workshop, cash, unpaid, inspections, reminders, claims } = data;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {workshop && (
          <KpiCard
            label={T.cards.vehicles}
            value={String(workshop.total)}
            sub={fmt(T.cards.vehiclesSub, {
              repair: workshop.stages.repair,
              ready: workshop.stages.ready,
            })}
            href="/ordres"
          />
        )}
        {cash && (
          <KpiCard
            label={T.cards.collected}
            value={formatAmount(cash.total)}
            sub={fmt(T.cards.collectedSub, {
              count: cash.paymentsCount,
              state: cash.sessionOpenedAt ? T.cards.cashOpen : T.cards.cashClosed,
            })}
            href="/caisse"
          />
        )}
        {unpaid && (
          <KpiCard
            label={T.cards.unpaid}
            value={formatAmount(unpaid.total)}
            sub={fmt(T.cards.unpaidSub, { count: unpaid.count, long: unpaid.longOverdueCount })}
            href="/creances?filtre=en-retard"
          />
        )}
        {inspections && (
          <KpiCard
            label={T.cards.inspections}
            value={String(inspections.total)}
            sub={fmt(T.cards.inspectionsSub, inspections.bands)}
            href="/relances/echeances"
          />
        )}
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        {workshop && (
          <div className="min-w-0 lg:col-span-2">
            <WorkshopBlock workshop={workshop} timeZone={timeZone} />
          </div>
        )}
        {cash && <CashBlock cash={cash} timeZone={timeZone} />}
      </div>

      {data.inspections ? (
        <InspectionsBlock inspections={data.inspections} />
      ) : (
        input.siteId &&
        data.reminders && (
          <Section title={T.inspections.title}>
            <p className="text-sm text-muted">{T.inspections.siteFiltered}</p>
          </Section>
        )
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {reminders && <RemindersBlock reminders={reminders} />}
        {claims && <ClaimsBlock claims={claims} />}
        {unpaid && <UnpaidBlock unpaid={unpaid} />}
        {cash && <CollectedChart daily={cash.daily} today={data.today} />}
      </div>
    </div>
  );
}

// ─── Véhicules en atelier ─────────────────────────────────────────────────────

function WorkshopBlock({
  workshop,
  timeZone,
}: {
  workshop: NonNullable<Today["workshop"]>;
  timeZone: string;
}) {
  const rest = workshop.total - workshop.items.length;
  return (
    <Section
      title={T.workshop.title}
      action={
        <Link href="/ordres" className={linkClass}>
          {T.workshop.all} →
        </Link>
      }
    >
      <ul className="mb-3 flex flex-wrap gap-2" aria-label={T.workshop.title}>
        {(Object.keys(T.workshop.stages) as WorkshopStage[]).map((stage) => (
          <li key={stage}>
            <StatusBadge tone={STAGE_TONE[stage]}>
              {T.workshop.stages[stage]} · {workshop.stages[stage]}
            </StatusBadge>
          </li>
        ))}
      </ul>
      <DataTable
        rows={workshop.items}
        rowKey={(r) => r.id}
        empty={<EmptyState title={T.workshop.empty} />}
        columns={[
          {
            key: "plate",
            header: T.workshop.plate,
            primary: true,
            render: (r) => (
              <Link href={`/ordres/${r.id}`} className="inline-flex min-h-11 items-center">
                <PlateBadge plate={r.plate} />
              </Link>
            ),
          },
          {
            key: "customer",
            header: T.workshop.customer,
            render: (r) => (
              <span className="flex flex-col">
                <span className="font-medium">{r.customerName}</span>
                <span className="text-xs text-muted">{r.vehicle}</span>
              </span>
            ),
          },
          {
            key: "status",
            header: T.workshop.status,
            render: (r) =>
              r.stage ? (
                <StatusBadge tone={STAGE_TONE[r.stage]}>{T.workshop.stages[r.stage]}</StatusBadge>
              ) : null,
          },
          {
            key: "payer",
            header: T.workshop.payer,
            render: (r) => r.insurerName ?? T.workshop.customerPays,
          },
          {
            key: "promised",
            header: T.workshop.promised,
            render: (r) =>
              r.promisedAt ? formatShortDate(r.promisedAt, timeZone) : T.workshop.noDate,
          },
        ]}
      />
      {rest > 0 && (
        <p className="mt-2 text-xs text-muted">{fmt(T.workshop.more, { count: rest })}</p>
      )}
    </Section>
  );
}

// ─── Caisse du jour ───────────────────────────────────────────────────────────

function CashBlock({ cash, timeZone }: { cash: NonNullable<Today["cash"]>; timeZone: string }) {
  const methods = [
    ...MAIN_METHODS,
    ...Object.keys(cash.byMethod).filter((m) => !MAIN_METHODS.includes(m) && cash.byMethod[m]),
  ];
  const max = Math.max(...methods.map((m) => Math.abs(cash.byMethod[m] ?? 0)), 1);
  return (
    <Section
      title={T.cash.title}
      action={
        cash.sessionOpenedAt ? (
          <StatusBadge tone="ok">
            {fmt(T.cash.openedAt, { time: formatTime(cash.sessionOpenedAt, timeZone) })}
          </StatusBadge>
        ) : (
          <StatusBadge tone="off">{T.cash.closed}</StatusBadge>
        )
      }
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{T.cash.total}</p>
      <p className="text-2xl font-bold">{formatAmount(cash.total)}</p>
      <p className="mb-3 text-xs text-muted">
        {fmt(T.cash.payments, { count: cash.paymentsCount })}
      </p>
      <ul className="flex flex-col gap-3">
        {methods.map((m) => {
          const amount = cash.byMethod[m] ?? 0;
          return (
            <li key={m} className="flex flex-col gap-1 text-sm">
              <span className="flex justify-between gap-2">
                <span>{methodLabel(m)}</span>
                <span className="font-medium">{formatAmount(amount)}</span>
              </span>
              <span className="h-1.5 rounded-full bg-surface-2" aria-hidden="true">
                <span
                  className="block h-full rounded-full bg-foreground/70"
                  style={{ width: `${(Math.abs(amount) / max) * 100}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
      <Link
        href="/caisse"
        className="btn btn-secondary mt-4 flex min-h-11 w-full items-center justify-center"
      >
        {cash.sessionOpenedAt ? T.cash.close : T.cash.open}
      </Link>
      <p className="mt-2 text-xs text-muted">{T.cash.closeHint}</p>
    </Section>
  );
}

// ─── Visites techniques à préparer ────────────────────────────────────────────

function InspectionsBlock({ inspections }: { inspections: NonNullable<Today["inspections"]> }) {
  return (
    <Section
      title={T.inspections.title}
      action={
        <Link href="/relances/echeances" className={linkClass}>
          {T.inspections.schedule} →
        </Link>
      }
    >
      <p className="mb-3 text-sm text-muted">{T.inspections.subtitle}</p>
      <ul className="mb-3 flex flex-wrap gap-2" aria-label={T.inspections.title}>
        {(["j60", "j30", "j15"] as const).map((band) => (
          <li key={band}>
            <StatusBadge tone={BAND_TONE[band]}>
              {T.inspections.bands[band]} · {inspections.bands[band]}
            </StatusBadge>
          </li>
        ))}
      </ul>
      <DataTable
        rows={inspections.items}
        rowKey={(r) => r.vehicleId}
        empty={<EmptyState title={T.inspections.empty} />}
        columns={[
          {
            key: "plate",
            header: T.workshop.plate,
            primary: true,
            render: (r) => (
              <Link
                href={`/vehicules/${r.vehicleId}`}
                className="inline-flex min-h-11 items-center"
              >
                <PlateBadge plate={r.plate} />
              </Link>
            ),
          },
          {
            key: "customer",
            header: T.workshop.customer,
            render: (r) => (
              <span className="flex flex-col">
                <span className="font-medium">{r.customerName}</span>
                <span className="text-xs text-muted">{r.vehicle}</span>
              </span>
            ),
          },
          {
            key: "due",
            header: T.inspections.due,
            render: (r) => formatDay(new Date(r.dueDate).toISOString().slice(0, 10)),
          },
          {
            key: "left",
            header: T.inspections.left,
            render: (r) =>
              r.band ? (
                <StatusBadge tone={BAND_TONE[r.band]}>
                  {r.daysLeft === 0
                    ? T.inspections.dueToday
                    : fmt(T.inspections.daysLeft, { days: r.daysLeft })}
                </StatusBadge>
              ) : null,
          },
          {
            key: "followUp",
            header: T.inspections.followUp,
            render: (r) => (
              <StatusBadge tone={FOLLOW_UP_TONE[r.followUp]}>
                {T.inspections.followUps[r.followUp]}
              </StatusBadge>
            ),
          },
        ]}
      />
    </Section>
  );
}

// ─── Relances automatiques ────────────────────────────────────────────────────

function RemindersBlock({ reminders }: { reminders: NonNullable<Today["reminders"]> }) {
  return (
    <Section
      title={T.reminders.title}
      action={
        <Link href="/relances" className={linkClass}>
          {T.reminders.manage} →
        </Link>
      }
    >
      <dl className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-md bg-surface-2 p-3">
          <dt className="text-xs text-muted">{T.reminders.sentThisWeek}</dt>
          <dd className="text-xl font-semibold">{reminders.sentThisWeek}</dd>
        </div>
        <div className="rounded-md bg-surface-2 p-3">
          <dt className="text-xs text-muted">{T.reminders.toApprove}</dt>
          <dd className="text-xl font-semibold">{reminders.toApprove}</dd>
        </div>
      </dl>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {T.reminders.upcoming}
      </h3>
      {reminders.upcoming.length === 0 ? (
        <p className="text-sm text-muted">{T.reminders.noUpcoming}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {reminders.upcoming.map((d) => (
            <li key={d.day} className="grid grid-cols-[6rem_1fr] gap-2 py-2 text-sm">
              <span className="font-medium">{formatDay(d.day)}</span>
              <span className="text-muted">
                {d.byType.map((t) => `${t.count} ${reminderTypeLabel(t.type)}`).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ─── Dossiers assurance ───────────────────────────────────────────────────────

function ClaimsBlock({ claims }: { claims: NonNullable<Today["claims"]> }) {
  const stages = Object.keys(T.claims.stages) as ClaimStage[];
  const empty = stages.every((s) => claims.stages[s].count === 0);
  return (
    <Section
      title={T.claims.title}
      action={
        <Link href="/assurances/sinistres" className={linkClass}>
          {T.claims.all} →
        </Link>
      }
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {T.claims.receivable}
      </p>
      <p className="mb-3 text-2xl font-bold">{formatAmount(claims.total)}</p>
      {empty ? (
        <p className="text-sm text-muted">{T.claims.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {stages.map((s) => (
            <li key={s} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="flex flex-col gap-1">
                <StatusBadge tone={CLAIM_TONE[s]}>{T.claims.stages[s]}</StatusBadge>
                <span className="text-xs text-muted">
                  {fmt(T.claims.count, { count: claims.stages[s].count })}
                </span>
              </span>
              <span className="font-medium">{formatAmount(claims.stages[s].amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ─── Factures impayées ────────────────────────────────────────────────────────

function UnpaidBlock({ unpaid }: { unpaid: NonNullable<Today["unpaid"]> }) {
  return (
    <Section title={T.unpaid.title}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{T.unpaid.total}</p>
      <p className="mb-3 text-2xl font-bold">
        {formatAmount(unpaid.total)}{" "}
        <span className="text-sm font-normal text-muted">
          · {fmt(T.unpaid.invoices, { count: unpaid.count })}
        </span>
      </p>
      {unpaid.overdue.length === 0 ? (
        <p className="text-sm text-muted">{T.unpaid.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {unpaid.overdue.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-medium">
                  {i.number ?? T.unpaid.noNumber} · {i.customerName}
                </span>
                <StatusBadge tone={i.daysOverdue > 15 ? "bad" : "warn"}>
                  {fmt(T.unpaid.overdueFor, { days: i.daysOverdue })}
                </StatusBadge>
              </span>
              <span className="shrink-0 font-medium">{formatAmount(i.balance)}</span>
            </li>
          ))}
        </ul>
      )}
      {unpaid.more.count > 0 && (
        <p className="mt-2 text-xs text-muted">
          {fmt(T.unpaid.more, {
            count: unpaid.more.count,
            amount: formatAmount(unpaid.more.amount),
          })}
        </p>
      )}
      {unpaid.overdueCount > 0 && (
        <Link
          href="/creances?filtre=en-retard"
          className="btn btn-secondary mt-4 flex min-h-11 w-full items-center justify-center"
        >
          {T.unpaid.remind}
        </Link>
      )}
    </Section>
  );
}

// ─── Encaissements 7 jours ────────────────────────────────────────────────────

function CollectedChart({
  daily,
  today,
}: {
  daily: NonNullable<Today["cash"]>["daily"];
  today: string;
}) {
  const total = daily.reduce((s, d) => s + d.total, 0);
  const max = Math.max(...daily.map((d) => d.total), 1);
  return (
    <Section title={T.collected.title}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {T.collected.total}
      </p>
      <p className="mb-3 text-2xl font-bold">{formatAmount(total)}</p>
      <figure className="min-w-0">
        <div className="flex h-36 items-end gap-2" aria-hidden="true">
          {daily.map((d) => (
            <div
              key={d.day}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
            >
              <span className="mb-1 text-[10px] text-muted">{formatThousands(d.total)}</span>
              <div
                className={`w-full rounded-t ${d.day === today ? "bg-accent" : "bg-foreground/40"}`}
                style={{ height: `${(Math.max(0, d.total) / max) * 80}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-2 text-[11px] text-muted" aria-hidden="true">
          {daily.map((d) => (
            <span key={d.day} className="flex-1 text-center">
              {d.day === today ? T.collected.todayShort : weekdayShort(d.day)}
            </span>
          ))}
        </div>
        <figcaption className="mt-2 text-xs text-muted">{T.collected.unit}</figcaption>
        <ul className="sr-only">
          {daily.map((d) => (
            <li key={d.day}>
              {fmt(T.collected.aria, { day: formatDay(d.day), amount: formatAmount(d.total) })}
            </li>
          ))}
        </ul>
      </figure>
    </Section>
  );
}

// ─── Formats ──────────────────────────────────────────────────────────────────

/** Instant → `dd/MM/yyyy` dans le fuseau de l'organisation. */
function formatShortDate(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

/** `yyyy-MM-dd` → « lun. ». Le jour est une date métier : lu en UTC. */
function weekdayShort(day: string): string {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00.000Z`),
  );
}

/** 485 000 → « 485 k » pour les étiquettes du graphique (le montant exact est lu en sr-only). */
function formatThousands(amount: number): string {
  if (Math.abs(amount) < 1000) return String(amount);
  return `${Math.round(amount / 1000)} k`;
}
