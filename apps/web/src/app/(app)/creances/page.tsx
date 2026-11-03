"use client";

// PRD M09 §7.1 — /creances : KPI, liste compacte par client ou par facture avec cases à cocher
// (relancer la sélection ou tous les clients à relancer, en choisissant les canaux), répartition
// des impayés par ancienneté (cliquable, filtre la liste).
// Écarts documentés : pas de DSO ni d'export Excel, pas de filtres site/assigné/score.
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Phone, Send, X } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState } from "@atelieros/ui";
import { EduTip } from "@/components/edu-tip";
import { GuideLink } from "@/components/guide-link";
import { trpc } from "@/trpc/react";
import { DeliveryTicks } from "@/components/messaging/delivery-ticks";
import { ErrorBox } from "./error-box";
import { RemindDialog } from "./remind-dialog";
import {
  BUCKETS,
  CASE_STATUS_TONE,
  INVOICE_STATUS_TONE,
  formatDay,
  riskLabelOf,
  t,
  type Bucket,
  type Tone,
} from "./i18n";

const TABS = ["ALL", "TO_HANDLE", "PROMISES", "DISPUTES", "WRITTEN_OFF"] as const;
type Tab = (typeof TABS)[number];
type CaseRow = inferRouterOutputs<AppRouter>["collections"]["listCases"]["items"][number];
type InvoiceRow = inferRouterOutputs<AppRouter>["collections"]["listInvoices"]["items"][number];

/** Ligne cochée : le dossier du client (la relance rappelle toutes ses factures impayées). */
interface Picked {
  caseId: string;
  name: string;
  amount: number;
}
type Selection = Map<string, Picked>;

const REMINDABLE = ["OPEN", "PROMISED", "ESCALATED"];

const DOT: Record<Tone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  bad: "bg-status-bad",
  off: "bg-status-off",
};
const DELAY_PILL: Record<"ok" | "warn" | "bad", string> = {
  ok: "bg-status-ok-bg text-status-ok",
  warn: "bg-status-warn-bg text-status-warn",
  bad: "bg-status-bad-bg text-status-bad",
};

/** Couleur du retard : vert ≤ 7 j, orange ≤ 30 j, rouge au-delà (toujours avec le nombre). */
function delayTone(days: number): "ok" | "warn" | "bad" {
  if (days <= 7) return "ok";
  if (days <= 30) return "warn";
  return "bad";
}

export default function CreancesPage() {
  const me = trpc.me.get.useQuery();
  const remindersOnly = me.data?.activeOrganization?.operatingMode === "REMINDERS_ONLY";
  const [view, setView] = useState<"customers" | "invoices">("customers");
  const [tab, setTab] = useState<Tab>("ALL");
  const [bucket, setBucket] = useState<Bucket | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Selection>(new Map());
  const [dialog, setDialog] = useState<null | { caseIds?: string[]; title: string }>(null);

  const summary = trpc.collections.agingSummary.useQuery({});
  // Même requête que la liste (partagée par React Query) : nombre de dossiers par onglet.
  const casesQuery = trpc.collections.listCases.useInfiniteQuery(
    { tab, bucket, search: search.trim() || undefined, limit: 50 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined, enabled: view === "customers" },
  );
  const tabCounts = casesQuery.data?.pages[0]?.counts;
  const preview = trpc.collections.remindPreview.useQuery({ minDaysOverdue: 0 });
  const eligibleCount = preview.data?.candidates.filter((c) => c.eligible).length ?? 0;
  const blockedCount = (preview.data?.candidates.length ?? 0) - eligibleCount;

  function resetSelection() {
    setSelection(new Map());
  }
  function toggle(key: string, picked: Picked) {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, picked);
      return next;
    });
  }
  function setMany(entries: [string, Picked][], checked: boolean) {
    setSelection((prev) => {
      const next = new Map(prev);
      for (const [key, picked] of entries) {
        if (checked) next.set(key, picked);
        else next.delete(key);
      }
      return next;
    });
  }

  const selectedCases = [...new Map([...selection.values()].map((p) => [p.caseId, p])).values()];
  const selectedAmount = selectedCases.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t(remindersOnly ? "titleReminders" : "title")}</h1>
        <GuideLink href="/creances/guide" />
      </div>

      {summary.data?.importedBalancesAt && (
        <p className="rounded-md border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn">
          {t("importedBalances", { date: formatDay(new Date(summary.data.importedBalancesAt)) })}
        </p>
      )}

      {summary.isLoading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      )}
      {summary.isError && <ErrorBox onRetry={() => summary.refetch()} />}

      {summary.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi
            label={t("kpi.totalDue")}
            value={formatFCFA(summary.data.total)}
            help={t("kpiHelp.totalDue")}
            example={t("kpiExample.totalDue")}
          />
          <Kpi
            label={t("kpi.overdue")}
            value={formatFCFA(summary.data.total - summary.data.notDue)}
            hint={t("kpi.over30", {
              amount: formatFCFA(
                summary.data.buckets.b31_60 +
                  summary.data.buckets.b61_90 +
                  summary.data.buckets.b90p,
              ),
            })}
            help={t("kpiHelp.overdue")}
            example={t("kpiExample.overdue")}
          />
          <Kpi
            label={t("kpi.recovered")}
            value={formatFCFA(summary.data.recoveredThisMonth.total)}
            hint={t("kpi.recoveredByReminders", {
              amount: formatFCFA(summary.data.recoveredThisMonth.reminders),
            })}
            help={t("kpiHelp.recovered")}
            example={t("kpiExample.recovered")}
          />
          <Kpi
            label={t("kpi.unallocated")}
            value={formatFCFA(summary.data.unallocatedCredits)}
            help={t("kpiHelp.unallocated")}
            example={t("kpiExample.unallocated")}
          />
        </div>
      )}

      {/* Liste : vue, onglets, recherche, puis « Relancer tous ». */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
            {(["customers", "invoices"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  resetSelection();
                }}
                className={`min-h-10 rounded px-3 ${view === v ? "bg-accent text-accent-foreground" : "text-muted"}`}
              >
                {t(v === "customers" ? "views.byCustomer" : "views.byInvoice")}
              </button>
            ))}
          </div>
          {view === "customers" &&
            TABS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => {
                  setTab(value);
                  resetSelection();
                }}
                className={`min-h-10 rounded-md border px-3 ${tab === value ? "border-foreground/30 bg-surface-2 font-semibold" : "border-border bg-surface"}`}
              >
                {t(`tabs.${value}`)}
                {tabCounts && (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 text-xs tabular-nums ${
                      value === "TO_HANDLE" && (tabCounts[value] ?? 0) > 0
                        ? "bg-status-bad text-white"
                        : "bg-surface-2 text-muted"
                    }`}
                  >
                    {tabCounts[value] ?? 0}
                  </span>
                )}
              </button>
            ))}
        </div>
        {view === "customers" && <p className="text-sm text-muted">{t(`tabsHelp.${tab}`)}</p>}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {view === "customers" && (
            <input
              className="min-h-11 flex-1 rounded-md border border-border bg-surface px-3 text-sm"
              placeholder={t("search")}
              aria-label={t("search")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetSelection();
              }}
            />
          )}
          <div className="flex items-center gap-2 sm:ml-auto">
            {preview.data && blockedCount > 0 && (
              <span
                className="hidden text-xs text-muted md:inline"
                title={t("bulk.bannerBlocked", { count: blockedCount })}
              >
                {t("selection.blockedShort", { count: blockedCount })}
              </span>
            )}
            <Button
              className="min-h-11 flex-1 sm:flex-none"
              disabled={eligibleCount === 0}
              onClick={() => setDialog({ title: t("bulk.title") })}
            >
              <Send size={16} aria-hidden />
              {eligibleCount > 0
                ? t("selection.remindAll", { count: eligibleCount })
                : t("selection.nobodyToRemind")}
            </Button>
          </div>
        </div>

        {view === "customers" ? (
          <CasesList
            tab={tab}
            bucket={bucket}
            search={search.trim() || undefined}
            selection={selection}
            onToggle={toggle}
            onSetMany={setMany}
            onRemindOne={(caseId, name) =>
              setDialog({ caseIds: [caseId], title: t("remind.title", { name }) })
            }
          />
        ) : (
          <InvoicesList
            bucket={bucket}
            selection={selection}
            onToggle={toggle}
            onSetMany={setMany}
            onRemindOne={(caseId, name) =>
              setDialog({ caseIds: [caseId], title: t("remind.title", { name }) })
            }
          />
        )}
      </section>

      {summary.data && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1 font-semibold">
              {t("aging.title")}
              <EduTip text={t("aging.help")} example={t("aging.example")} />
            </h2>
            {bucket && (
              <Button variant="ghost" onClick={() => setBucket(undefined)}>
                {t("aging.clearFilter")}
              </Button>
            )}
          </div>
          {BUCKETS.map((b) => {
            const amount = b === "notDue" ? summary.data.notDue : summary.data.buckets[b];
            const pct =
              summary.data.total > 0 ? Math.round((amount * 100) / summary.data.total) : 0;
            return (
              <button
                key={b}
                type="button"
                onClick={() => {
                  setBucket(bucket === b ? undefined : b);
                  resetSelection();
                }}
                aria-pressed={bucket === b}
                className={`flex min-h-11 flex-col gap-1 rounded-md px-2 py-1 text-left hover:bg-surface-2 ${bucket === b ? "ring-2 ring-accent" : ""}`}
              >
                <span className="flex w-full justify-between text-sm">
                  <span className="font-medium">{t(`aging.${b}`)}</span>
                  <span>
                    {formatFCFA(amount)} ·{" "}
                    <span className="text-muted">
                      {t("aging.customers", { count: summary.data.customersByBucket[b] })}
                    </span>
                  </span>
                </span>
                <span className="h-2 w-full rounded bg-surface-2">
                  <span
                    className={`block h-2 rounded ${b === "notDue" ? "bg-status-ok" : b === "b0_30" ? "bg-status-warn" : "bg-status-bad"}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </button>
            );
          })}
        </section>
      )}

      {/* Barre de sélection : apparaît dès qu'un client (ou une facture) est coché. */}
      {selectedCases.length > 0 && (
        <div className="fixed inset-x-0 bottom-[var(--bottom-nav-offset)] z-30 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] md:left-[var(--sidebar-w)]">
          <p className="text-sm">
            <strong>{t("selection.count", { count: selectedCases.length })}</strong>
            <span className="text-muted">
              {" "}
              · {t("selection.amount", { amount: formatFCFA(selectedAmount) })}
            </span>
          </p>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Button variant="ghost" className="flex-1 sm:flex-none" onClick={resetSelection}>
              <X size={16} aria-hidden />
              {t("selection.clear")}
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              onClick={() =>
                setDialog({
                  caseIds: selectedCases.map((p) => p.caseId),
                  title: t("selection.dialogTitle", { count: selectedCases.length }),
                })
              }
            >
              <Send size={16} aria-hidden />
              {t("selection.remind", { count: selectedCases.length })}
            </Button>
          </div>
        </div>
      )}

      {dialog && (
        <RemindDialog
          caseIds={dialog.caseIds}
          title={dialog.title}
          onClose={() => setDialog(null)}
          onDone={resetSelection}
        />
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  help,
  example,
}: {
  label: string;
  value: string;
  hint?: string;
  help: string;
  example: string;
}) {
  return (
    <div className="relative flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 pr-12">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
      <span className="absolute top-0.5 right-0.5">
        <EduTip text={help} example={example} />
      </span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-surface-2" />
      ))}
    </div>
  );
}

interface ListSelectionProps {
  selection: Selection;
  onToggle: (key: string, picked: Picked) => void;
  onSetMany: (entries: [string, Picked][], checked: boolean) => void;
  onRemindOne: (caseId: string, name: string) => void;
}

/** Case « tout cocher » de l'en-tête (les lignes chargées et relançables). */
function SelectAll({
  entries,
  selection,
  onSetMany,
}: {
  entries: [string, Picked][];
  selection: Selection;
  onSetMany: ListSelectionProps["onSetMany"];
}) {
  const all = entries.length > 0 && entries.every(([key]) => selection.has(key));
  const some = entries.some(([key]) => selection.has(key));
  return (
    <input
      type="checkbox"
      className="size-5"
      aria-label={t("selection.selectAll")}
      disabled={entries.length === 0}
      checked={all}
      ref={(el) => {
        if (el) el.indeterminate = some && !all;
      }}
      onChange={() => onSetMany(entries, !all)}
    />
  );
}

const CASE_GRID =
  "lg:grid-cols-[2.25rem_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_4.5rem_minmax(0,1.4fr)_8.5rem]";

function CasesList({
  tab,
  bucket,
  search,
  selection,
  onToggle,
  onSetMany,
  onRemindOne,
}: { tab: Tab; bucket?: Bucket; search?: string } & ListSelectionProps) {
  const query = trpc.collections.listCases.useInfiniteQuery(
    { tab, bucket, search, limit: 50 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  if (query.isLoading) return <ListSkeleton />;
  if (query.isError) return <ErrorBox onRetry={() => query.refetch()} />;
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (items.length === 0) {
    return tab === "ALL" && !search && !bucket ? (
      <EmptyState title={t("empty")} description={t("emptyDescription")} />
    ) : (
      <EmptyState title={t(`emptyTabs.${tab}`)} description={t("emptyTabsHint")} />
    );
  }
  const entries: [string, Picked][] = items
    .filter((c) => REMINDABLE.includes(c.status))
    .map((c) => [c.id, { caseId: c.id, name: c.customer.displayName, amount: c.overdueDue }]);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div
          className={`grid grid-cols-[2.25rem_1fr] items-center gap-3 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase ${CASE_GRID}`}
        >
          <SelectAll entries={entries} selection={selection} onSetMany={onSetMany} />
          <span>{t("list.customer")}</span>
          <span className="hidden text-right lg:block">{t("columns.totalDue")}</span>
          <span className="hidden text-right lg:block">{t("columns.overdue")}</span>
          <span className="hidden text-right lg:block">{t("list.delay")}</span>
          <span className="hidden lg:block">{t("list.lastReminder")}</span>
          <span className="hidden text-right lg:block">{t("list.actions")}</span>
        </div>
        <ul className="divide-y divide-border">
          {items.map((c) => (
            <CaseLine
              key={c.id}
              row={c}
              checked={selection.has(c.id)}
              onToggle={() =>
                onToggle(c.id, { caseId: c.id, name: c.customer.displayName, amount: c.overdueDue })
              }
              onRemind={() => onRemindOne(c.id, c.customer.displayName)}
            />
          ))}
        </ul>
      </div>
      {query.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}

function CaseLine({
  row: c,
  checked,
  onToggle,
  onRemind,
}: {
  row: CaseRow;
  checked: boolean;
  onToggle: () => void;
  onRemind: () => void;
}) {
  const risk = riskLabelOf(c.customer.riskScore);
  const tone = delayTone(c.maxDaysOverdue);
  const canRemind = REMINDABLE.includes(c.status);
  const pending = c.lastReminder?.pending ?? false;
  return (
    <li
      className={`grid grid-cols-[2.25rem_1fr] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 ${CASE_GRID} ${checked ? "bg-accent/5" : "hover:bg-surface-2/60"}`}
    >
      <input
        type="checkbox"
        className="size-5"
        aria-label={t("selection.selectOne", { name: c.customer.displayName })}
        disabled={!canRemind}
        checked={checked}
        onChange={onToggle}
      />

      <div className="flex min-w-0 items-center justify-between gap-2 lg:block">
        <div className="min-w-0">
          <Link href={`/creances/${c.id}`} className="block truncate font-semibold hover:underline">
            {c.customer.displayName}
          </Link>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className={`size-2 rounded-full ${DOT[CASE_STATUS_TONE[c.status] ?? "off"]}`}
              />
              {t(`caseStatus.${c.status}`)}
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className={`size-2 rounded-full ${DOT[risk.tone]}`} />
              {t(risk.key)}
              {c.customer.riskScore !== null ? ` ${c.customer.riskScore}` : ""}
            </span>
            {c.unreachable && <span className="text-status-bad">{t("unreachable")}</span>}
            {c.nextPromise && (
              <span>
                {t("promiseNext", {
                  amount: formatFCFA(c.nextPromise.amount),
                  date: formatDay(c.nextPromise.promisedDate),
                })}
              </span>
            )}
          </p>
        </div>
        {/* Mobile : montant en retard à droite du nom. */}
        <span className="shrink-0 text-right lg:hidden">
          <span className="block text-sm font-semibold whitespace-nowrap text-status-bad tabular-nums">
            {formatFCFA(c.overdueDue)}
          </span>
          <span
            className={`inline-flex rounded-full px-1.5 text-[11px] font-semibold ${DELAY_PILL[tone]}`}
          >
            {t("days", { count: c.maxDaysOverdue })}
          </span>
        </span>
      </div>

      <span className="hidden text-right text-sm whitespace-nowrap tabular-nums lg:block">
        {formatFCFA(c.totalDue)}
      </span>
      <span
        className={`hidden text-right text-sm whitespace-nowrap tabular-nums lg:block ${c.overdueDue > 0 ? "font-semibold text-status-bad" : "text-muted"}`}
      >
        {formatFCFA(c.overdueDue)}
      </span>
      <span className="hidden text-right lg:block">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${DELAY_PILL[tone]}`}
        >
          {t("days", { count: c.maxDaysOverdue })}
        </span>
      </span>

      {/* Mobile : 2e ligne (dernière relance + actions), alignée sous le nom. */}
      <div className="col-start-2 flex min-w-0 items-center justify-between gap-2 lg:contents">
        <LastReminder value={c.lastReminder} />
        <div className="flex items-center justify-end gap-0.5">
          {c.customer.phone && (
            <a
              href={`tel:${c.customer.phone}`}
              aria-label={t("list.call")}
              title={t("list.call")}
              className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground"
            >
              <Phone size={17} aria-hidden />
            </a>
          )}
          {canRemind && (
            <button
              type="button"
              onClick={onRemind}
              disabled={pending}
              aria-label={t("list.remind")}
              title={pending ? t("list.reminderPending") : t("list.remind")}
              className="inline-flex size-11 items-center justify-center rounded-md text-accent hover:bg-accent/10 disabled:text-muted disabled:opacity-50"
            >
              <Send size={17} aria-hidden />
            </button>
          )}
          <OpenCaseLink caseId={c.id} />
        </div>
      </div>
    </li>
  );
}

function LastReminder({ value }: { value: CaseRow["lastReminder"] }) {
  if (!value) {
    return <p className="truncate text-xs text-muted lg:text-sm">{t("list.neverReminded")}</p>;
  }
  const channel = value.channel ? t(`list.channels.${value.channel}`) : null;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs lg:text-sm">
      {value.state === "toApprove" ? (
        <>
          <AlertTriangle size={14} className="shrink-0 text-status-warn" aria-hidden />
          <Link href="/relances" className="truncate text-status-warn underline">
            {t("list.reminderToApprove")}
          </Link>
        </>
      ) : value.pending ? (
        <>
          <Clock size={14} className="shrink-0 text-status-warn" aria-hidden />
          <span className="truncate">{t("list.reminderPending")}</span>
        </>
      ) : (
        <>
          <CheckCircle2 size={14} className="shrink-0 text-status-ok" aria-hidden />
          <span className="truncate">
            {t("list.remindedOn", { date: formatDay(value.at) })}
            {channel ? <span className="text-muted"> · {channel}</span> : null}
          </span>
          <DeliveryTicks state={value.delivery} compact />
        </>
      )}
    </p>
  );
}

function OpenCaseLink({ caseId }: { caseId: string }) {
  return (
    <Link
      href={`/creances/${caseId}`}
      aria-label={t("list.open")}
      title={t("list.open")}
      className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground"
    >
      <ChevronRight size={18} aria-hidden />
    </Link>
  );
}

const INVOICE_GRID =
  "lg:grid-cols-[2.25rem_minmax(0,2.2fr)_6.5rem_minmax(0,1fr)_minmax(0,1fr)_4.5rem_8.5rem]";

function InvoicesList({
  bucket,
  selection,
  onToggle,
  onSetMany,
  onRemindOne,
}: { bucket?: Bucket } & ListSelectionProps) {
  const query = trpc.collections.listInvoices.useInfiniteQuery(
    { bucket, limit: 50 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  if (query.isLoading) return <ListSkeleton />;
  if (query.isError) return <ErrorBox onRetry={() => query.refetch()} />;
  const items: InvoiceRow[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (items.length === 0) {
    return <EmptyState title={t("empty")} description={t("emptyDescription")} />;
  }
  const pick = (i: InvoiceRow): Picked => ({
    caseId: i.caseId!,
    name: i.customer.displayName,
    amount: i.balance,
  });
  const entries: [string, Picked][] = items
    .filter((i) => i.caseId && i.daysOverdue > 0)
    .map((i) => [`inv:${i.id}`, pick(i)]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">{t("selection.invoiceNote")}</p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div
          className={`grid grid-cols-[2.25rem_1fr] items-center gap-3 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase ${INVOICE_GRID}`}
        >
          <SelectAll entries={entries} selection={selection} onSetMany={onSetMany} />
          <span>{t("list.invoice")}</span>
          <span className="hidden lg:block">{t("columns.dueDate")}</span>
          <span className="hidden text-right lg:block">{t("columns.total")}</span>
          <span className="hidden text-right lg:block">{t("columns.balance")}</span>
          <span className="hidden text-right lg:block">{t("list.delay")}</span>
          <span className="hidden text-right lg:block">{t("list.actions")}</span>
        </div>
        <ul className="divide-y divide-border">
          {items.map((i) => {
            const key = `inv:${i.id}`;
            const remindable = !!i.caseId && i.daysOverdue > 0;
            const tone = delayTone(Math.max(0, i.daysOverdue));
            const checked = selection.has(key);
            return (
              <li
                key={i.id}
                className={`grid grid-cols-[2.25rem_1fr] items-center gap-x-3 gap-y-1 px-3 py-2.5 ${INVOICE_GRID} ${checked ? "bg-accent/5" : "hover:bg-surface-2/60"}`}
              >
                <input
                  type="checkbox"
                  className="size-5"
                  aria-label={t("selection.selectInvoice", { number: i.number ?? "—" })}
                  disabled={!remindable}
                  checked={checked}
                  onChange={() => onToggle(key, pick(i))}
                />
                <div className="flex min-w-0 items-center justify-between gap-2 lg:block">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {i.number ?? "—"}{" "}
                      <span className="font-normal text-muted">· {i.customer.displayName}</span>
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted">
                      <span
                        aria-hidden
                        className={`size-2 rounded-full ${DOT[INVOICE_STATUS_TONE[i.status] ?? "off"]}`}
                      />
                      {t(`invoiceStatus.${i.status}`)}
                      <span className="lg:hidden">
                        {" "}
                        · {t("columns.dueDate")} {formatDay(i.dueDate)}
                      </span>
                    </p>
                  </div>
                  <span className="shrink-0 text-right lg:hidden">
                    <span className="block text-sm font-semibold whitespace-nowrap tabular-nums">
                      {formatFCFA(i.balance)}
                    </span>
                    {i.daysOverdue > 0 && (
                      <span
                        className={`inline-flex rounded-full px-1.5 text-[11px] font-semibold ${DELAY_PILL[tone]}`}
                      >
                        {t("days", { count: i.daysOverdue })}
                      </span>
                    )}
                  </span>
                </div>
                <span className="hidden text-sm lg:block">{formatDay(i.dueDate)}</span>
                <span className="hidden text-right text-sm whitespace-nowrap tabular-nums lg:block">
                  {formatFCFA(i.total)}
                </span>
                <span className="hidden text-right text-sm font-semibold whitespace-nowrap tabular-nums lg:block">
                  {formatFCFA(i.balance)}
                </span>
                <span className="hidden text-right lg:block">
                  {i.daysOverdue > 0 ? (
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${DELAY_PILL[tone]}`}
                    >
                      {t("days", { count: i.daysOverdue })}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">{t("list.notDue")}</span>
                  )}
                </span>
                <div className="col-start-2 flex items-center justify-end gap-0.5 lg:col-start-auto">
                  {remindable && (
                    <button
                      type="button"
                      onClick={() => onRemindOne(i.caseId!, i.customer.displayName)}
                      aria-label={t("list.remind")}
                      title={t("list.remind")}
                      className="inline-flex size-11 items-center justify-center rounded-md text-accent hover:bg-accent/10"
                    >
                      <Send size={17} aria-hidden />
                    </button>
                  )}
                  {i.caseId && <OpenCaseLink caseId={i.caseId} />}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {query.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}
