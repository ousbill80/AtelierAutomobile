"use client";

// M07 §7 — /stock/valorisation (US-M07-13) : valeur par site / catégorie, à date ; onglets
// « Dormantes » (RG-M07-11), « Négatifs » (RG-M07-06) et « Ventes sous coût » (RG-M07-13).
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Select,
  StatusBadge,
  Tabs,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  downloadText,
  ErrorBox,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  SiteSelect,
} from "../_lib/components";
import { formatDay, formatDateTime, qtyText, t } from "../_lib/i18n";

type Tab = "value" | "dormant" | "negatives" | "belowCost";
const DORMANT_OPTIONS = [90, 180, 365];

export default function ValuationPage() {
  const [tab, setTab] = useState<Tab>("value");
  return (
    <div className="flex flex-col gap-4">
      <ModuleNav section="stock" />
      <PageTitle title={t("valuation.title")} />
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as Tab)}
        items={(["value", "dormant", "negatives", "belowCost"] as const).map((k) => ({
          key: k,
          label: t(`valuation.tabs.${k}`),
        }))}
      />
      {tab === "value" ? <ValueTab /> : null}
      {tab === "dormant" ? <DormantTab /> : null}
      {tab === "negatives" ? <NegativesTab /> : null}
      {tab === "belowCost" ? <BelowCostTab /> : null}
    </div>
  );
}

function ValueTab() {
  const [groupBy, setGroupBy] = useState<"category" | "site">("category");
  const [siteId, setSiteId] = useState("");
  const [at, setAt] = useState("");
  const query = trpc.stock.valuation.useQuery({
    groupBy,
    siteId: siteId || undefined,
    at: at || undefined,
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label={t("valuation.groupBy")}>
          <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
            <option value="category">{t("valuation.byCategory")}</option>
            <option value="site">{t("valuation.bySite")}</option>
          </Select>
        </Field>
        <SiteSelect value={siteId} onChange={setSiteId} allowAll />
        <Input
          label={t("valuation.at")}
          type="date"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
      </div>
      {query.isLoading ? <ListSkeleton /> : null}
      {query.isError ? <ErrorBox onRetry={() => query.refetch()} /> : null}
      {query.data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
            <div>
              <div className="text-sm text-muted">
                {t("valuation.total")} · {at ? formatDay(at) : t("valuation.today")}
              </div>
              <div className="text-2xl font-semibold" data-testid="valuation-total">
                {formatFCFA(query.data.total)}
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                downloadText(
                  "valorisation-stock.csv",
                  [
                    `${groupBy === "site" ? t("valuation.bySite") : t("valuation.byCategory")};Valeur (FCFA);Références`,
                    ...query.data.groups.map(
                      (g) => `${g.label || t("valuation.noCategory")};${g.value};${g.items}`,
                    ),
                    `${t("common.total")};${query.data.total};`,
                  ].join("\n"),
                )
              }
            >
              {t("valuation.export")}
            </Button>
          </div>
          <p className="text-xs text-muted">{t("valuation.negativesHint")}</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {query.data.groups.map((g) => (
              <li key={g.key} className="rounded-lg border border-border bg-surface p-3">
                <div className="text-sm text-muted">{g.label || t("valuation.noCategory")}</div>
                <div className="text-lg font-semibold">{formatFCFA(g.value)}</div>
                <div className="text-xs text-muted">{t("valuation.items", { count: g.items })}</div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function DormantTab() {
  const [days, setDays] = useState<number | undefined>(undefined);
  const query = trpc.stock.dormant.useQuery({ days });
  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-xs">
        <Field label={t("valuation.dormantDays")}>
          <Select
            value={days ?? ""}
            onChange={(e) => setDays(e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">
              {query.data ? t("valuation.dormantDaysOption", { days: query.data.days }) : "—"}
            </option>
            {DORMANT_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {t("valuation.dormantDaysOption", { days: d })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {query.isLoading ? <ListSkeleton /> : null}
      {query.isError ? <ErrorBox onRetry={() => query.refetch()} /> : null}
      {query.data ? (
        <>
          <p className="font-medium">
            {t("valuation.dormantTotal", { value: formatFCFA(query.data.totalValue) })}
          </p>
          <DataTable
            rows={query.data.rows}
            rowKey={(r) => r.productId}
            empty={<EmptyState title={t("valuation.noDormant")} />}
            columns={[
              {
                key: "name",
                header: t("common.product"),
                primary: true,
                render: (r) => (
                  <Link href={`/stock/${r.productId}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                ),
              },
              { key: "sku", header: t("catalog.columns.sku"), render: (r) => r.sku },
              {
                key: "qty",
                header: t("product.level.onHand"),
                render: (r) => qtyText(r.onHand, r.quantityScale, r.unit),
              },
              {
                key: "value",
                header: t("movements.columns.value"),
                render: (r) => formatFCFA(r.value),
              },
              {
                key: "last",
                header: t("product.lastIssuedAt"),
                render: (r) =>
                  r.lastIssuedAt
                    ? `${formatDay(r.lastIssuedAt)} (${t("valuation.daysAgo", { days: r.days })})`
                    : t("valuation.neverIssued"),
              },
              {
                key: "bucket",
                header: t("common.status"),
                render: (r) => (
                  <StatusBadge
                    tone={r.bucket === "over_365" ? "bad" : "warn"}
                    label={t(`valuation.dormantBucket.${r.bucket}`, { days: query.data.days })}
                  />
                ),
              },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}

function NegativesTab() {
  const query = trpc.stock.negatives.useQuery();
  if (query.isLoading) return <ListSkeleton />;
  if (query.isError || !query.data) return <ErrorBox onRetry={() => query.refetch()} />;
  return (
    <DataTable
      rows={query.data}
      rowKey={(l) => l.id}
      empty={<EmptyState title={t("valuation.noNegatives")} />}
      columns={[
        {
          key: "name",
          header: t("common.product"),
          primary: true,
          render: (l) => (
            <Link href={`/stock/${l.product.id}`} className="font-medium hover:underline">
              {l.product.name}
            </Link>
          ),
        },
        { key: "site", header: t("common.site"), render: (l) => l.site.code },
        {
          key: "qty",
          header: t("product.level.onHand"),
          render: (l) => (
            <StatusBadge
              tone="bad"
              label={qtyText(l.onHand, l.product.quantityScale, l.product.unit)}
            />
          ),
        },
      ]}
    />
  );
}

function BelowCostTab() {
  const query = trpc.stock.belowCostSales.useQuery();
  if (query.isLoading) return <ListSkeleton />;
  if (query.isError || !query.data) return <ErrorBox onRetry={() => query.refetch()} />;
  if (query.data.length === 0) {
    return (
      <EmptyState title={t("valuation.noBelowCost")} description={t("valuation.belowCostHint")} />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {query.data.map((e) => (
        <li key={e.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
          <div className="text-muted">{formatDateTime(e.occurredAt)}</div>
          <pre className="whitespace-pre-wrap break-words text-xs">
            {JSON.stringify(e.payload, null, 2)}
          </pre>
        </li>
      ))}
    </ul>
  );
}
