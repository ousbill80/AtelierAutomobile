"use client";

// M12 §7 — `/rapports/[slug]` : filtres (période ou date de situation, site, regroupement),
// aperçu paginé (50 lignes) avec totaux, exports Excel / PDF / CSV identiques à l'écran.
// Mobile (390 px) : une carte par ligne ; tableau à partir de 640 px.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatCell, isReportSlug, REPORTS, type ColumnKind } from "@atelieros/core/reports";
import { Button, EmptyState } from "@atelieros/ui";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { CardsSkeleton, ErrorState } from "../../tableau-de-bord/parts";
import { columnLabel, fmt, R, reportText } from "../labels";

const NUMERIC: ReadonlySet<ColumnKind> = new Set(["money", "number", "hours", "percent"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const GROUPS = ["none", "day", "month", "customer"] as const;
type Group = (typeof GROUPS)[number];

export default function RapportPage() {
  return (
    <Suspense fallback={<CardsSkeleton />}>
      <Report />
    </Suspense>
  );
}

function Report() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const me = trpc.me.get.useQuery();

  const valid = isReportSlug(slug);
  const def = valid ? REPORTS[slug] : null;
  const date = (key: string) => {
    const v = params.get(key) ?? "";
    return ISO_DAY.test(v) ? v : undefined;
  };
  const filters = {
    from: date("du"),
    to: date("au"),
    asOf: date("situation"),
    siteId: params.get("site") ?? undefined,
    groupBy: (GROUPS as readonly string[]).includes(params.get("regroupement") ?? "")
      ? (params.get("regroupement") as Group)
      : "none",
  };
  const cursor = Math.max(0, Number(params.get("depuis") ?? 0) || 0);
  const q = trpc.reports.preview.useQuery(
    { slug: valid ? slug : "ventes", filters, cursor },
    { enabled: valid },
  );
  const [draft, setDraft] = useState<{ from?: string; to?: string; asOf?: string }>({});

  function update(next: Record<string, string | undefined>) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    router.replace(`${pathname}?${search.toString()}`);
  }

  if (!valid || !def) return <EmptyState title={R.preview.empty} />;
  const text = reportText(slug);
  const sites = me.data?.allowedSites ?? [];
  const restricted = (me.data?.membership?.siteIds.length ?? 0) > 0;
  const period = q.data?.period;
  const from = draft.from ?? period?.from ?? "";
  const to = draft.to ?? period?.to ?? "";
  const asOf = draft.asOf ?? period?.asOf ?? "";

  const exportQuery = new URLSearchParams();
  if (def.filter === "period") {
    if (period?.from) exportQuery.set("from", period.from);
    if (period?.to) exportQuery.set("to", period.to);
  } else if (period?.asOf) exportQuery.set("asOf", period.asOf);
  if (filters.siteId) exportQuery.set("siteId", filters.siteId);
  if (slug === "ventes" && filters.groupBy !== "none") exportQuery.set("groupBy", filters.groupBy);
  const exportHref = (format: string) =>
    `/api/rapports/${slug}?${new URLSearchParams([...exportQuery, ["format", format]]).toString()}`;

  const inputClass =
    "min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground";

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-20">
      <div>
        <Link href="/rapports" className="text-sm underline">
          ← {R.back}
        </Link>
        <h1 className="text-2xl font-semibold">{text.title}</h1>
        <p className="text-sm text-muted">{text.description}</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (def.filter === "period") {
            if (ISO_DAY.test(from) && ISO_DAY.test(to) && from <= to) {
              update({ du: from, au: to, depuis: undefined });
            }
          } else if (ISO_DAY.test(asOf)) {
            update({ situation: asOf, depuis: undefined });
          }
        }}
      >
        {def.filter === "period" ? (
          <>
            <label className="flex min-w-0 flex-1 flex-col text-xs text-muted">
              {R.filters.from}
              <input
                type="date"
                value={from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col text-xs text-muted">
              {R.filters.to}
              <input
                type="date"
                value={to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                className={inputClass}
              />
            </label>
          </>
        ) : (
          <label className="flex min-w-0 flex-1 flex-col text-xs text-muted">
            {R.filters.asOf}
            <input
              type="date"
              value={asOf}
              onChange={(e) => setDraft({ ...draft, asOf: e.target.value })}
              className={inputClass}
            />
          </label>
        )}
        {(sites.length > 1 || !restricted) && (
          <label className="flex min-w-0 flex-1 flex-col text-xs text-muted">
            {R.filters.site}
            <select
              aria-label={R.filters.site}
              value={filters.siteId ?? ""}
              onChange={(e) => update({ site: e.target.value || undefined, depuis: undefined })}
              className={inputClass}
            >
              {!restricted && <option value="">{R.filters.allSites}</option>}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {slug === "ventes" && (
          <label className="flex min-w-0 flex-1 flex-col text-xs text-muted">
            {R.filters.groupBy}
            <select
              aria-label={R.filters.groupBy}
              value={filters.groupBy}
              onChange={(e) =>
                update({
                  regroupement: e.target.value === "none" ? undefined : e.target.value,
                  depuis: undefined,
                })
              }
              className={inputClass}
            >
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {R.groupBy[g]}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="submit" variant="secondary">
          {R.filters.apply}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2" aria-label={R.export.title}>
        <span className="text-sm text-muted">{R.export.title} :</span>
        {(["xlsx", "pdf", "csv"] as const).map((format) => (
          <a
            key={format}
            href={exportHref(format)}
            download
            className="flex min-h-11 min-w-16 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
          >
            {R.export[format]}
          </a>
        ))}
      </div>

      {q.isLoading ? (
        <CardsSkeleton />
      ) : q.isError || !q.data ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : q.data.count === 0 ? (
        <EmptyState title={R.preview.empty} />
      ) : (
        <ReportView
          data={q.data}
          cursor={cursor}
          onPage={(c) => update({ depuis: c ? String(c) : undefined })}
        />
      )}
    </div>
  );
}

type Preview = inferRouterOutputs<AppRouter>["reports"]["preview"];

function ReportView({
  data,
  cursor,
  onPage,
}: {
  data: Preview;
  cursor: number;
  onPage: (cursor: number) => void;
}) {
  const columns = data.columns;
  const cell = (kind: ColumnKind, value: unknown) =>
    formatCell(kind, (value ?? null) as string | number | null);
  const hasTotals = Object.keys(data.totals).length > 0;
  const [first, ...rest] = columns;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted" data-testid="report-count">
        {fmt(R.preview.page, {
          from: cursor + 1,
          to: Math.min(cursor + data.rows.length, data.count),
          count: data.count,
        })}
      </p>

      {hasTotals && (
        <dl
          className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-3 text-sm sm:grid-cols-4"
          data-testid="report-totals"
        >
          {columns
            .filter((c) => c.key in data.totals)
            .map((c) => (
              <div key={c.key} className="min-w-0">
                <dt className="truncate text-xs text-muted">
                  {R.preview.total} — {columnLabel(c.key)}
                </dt>
                <dd className="font-semibold">{cell(c.kind, data.totals[c.key])}</dd>
              </div>
            ))}
        </dl>
      )}

      {/* Mobile : une carte par ligne. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {data.rows.map((row, i) => (
          <li key={i} className="rounded-lg border border-border bg-surface p-3 text-sm">
            {first && <p className="font-semibold">{cell(first.kind, row[first.key]) || "—"}</p>}
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
              {rest.map((c) =>
                row[c.key] === null || row[c.key] === undefined || row[c.key] === "" ? null : (
                  <div key={c.key} className="min-w-0">
                    <dt className="truncate text-xs text-muted">{columnLabel(c.key)}</dt>
                    <dd className="break-words">{cell(c.kind, row[c.key])}</dd>
                  </div>
                ),
              )}
            </dl>
          </li>
        ))}
      </ul>

      {/* À partir de 640 px : tableau (défilement horizontal limité au tableau). */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`whitespace-nowrap px-3 py-2 ${NUMERIC.has(c.kind) ? "text-right" : ""}`}
                >
                  {columnLabel(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${NUMERIC.has(c.kind) ? "whitespace-nowrap text-right" : ""}`}
                  >
                    {cell(c.kind, row[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasTotals && (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${NUMERIC.has(c.kind) ? "whitespace-nowrap text-right" : ""}`}
                  >
                    {i === 0
                      ? R.preview.total
                      : c.key in data.totals
                        ? cell(c.kind, data.totals[c.key])
                        : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {data.notes.map((n) => (
        <p key={n} className="text-xs text-muted">
          {n}
        </p>
      ))}

      {(cursor > 0 || data.nextCursor !== null) && (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={cursor === 0}
            onClick={() => onPage(Math.max(0, cursor - 50))}
          >
            {R.preview.previous}
          </Button>
          <Button
            variant="secondary"
            disabled={data.nextCursor === null}
            onClick={() => data.nextCursor !== null && onPage(data.nextCursor)}
          >
            {R.preview.next}
          </Button>
        </div>
      )}
    </div>
  );
}
