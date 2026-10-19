"use client";

// M07 §7 — /stock/mouvements : journal filtrable (type, site, période) et export CSV.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { Button, DataTable, EmptyState, Field, Input, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  downloadText,
  ErrorBox,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  SiteSelect,
  useCan,
} from "../_lib/components";
import { formatDateTime, qtyText, t } from "../_lib/i18n";

const TYPES = [
  "PURCHASE_RECEIPT",
  "ISSUE_TO_RO",
  "RETURN_FROM_RO",
  "ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "COUNT_CORRECTION",
  "SUPPLIER_RETURN",
] as const;
type MovementType = (typeof TYPES)[number];

export default function MovementsPage() {
  const can = useCan();
  const utils = trpc.useUtils();
  const [type, setType] = useState<MovementType | "">("");
  const [siteId, setSiteId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = {
    type: type || undefined,
    siteId: siteId || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const list = trpc.stock.movements.useInfiniteQuery(
    { ...filters, limit: 50 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      const csv = await utils.stock.movementsCsv.fetch(filters);
      downloadText(csv.filename, csv.content);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ModuleNav section="stock" />
      <PageTitle
        title={t("movements.title")}
        actions={
          <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
            {t("movements.export")}
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("movements.type")}>
          <Select value={type} onChange={(e) => setType(e.target.value as MovementType | "")}>
            <option value="">{t("movements.allTypes")}</option>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`movementTypes.${ty}`)}
              </option>
            ))}
          </Select>
        </Field>
        <SiteSelect value={siteId} onChange={setSiteId} allowAll />
        <Input
          label={t("movements.from")}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          label={t("movements.to")}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {list.isLoading ? <ListSkeleton rows={6} /> : null}
      {list.isError ? <ErrorBox onRetry={() => list.refetch()} /> : null}
      {list.data ? (
        <>
          <DataTable
            rows={rows}
            rowKey={(m) => m.id}
            empty={<EmptyState title={t("movements.empty")} />}
            columns={[
              {
                key: "product",
                header: t("movements.columns.product"),
                primary: true,
                render: (m) => (
                  <Link href={`/stock/${m.product.id}`} className="font-medium hover:underline">
                    {m.product.name}
                  </Link>
                ),
              },
              {
                key: "date",
                header: t("movements.columns.date"),
                render: (m) => formatDateTime(m.createdAt),
              },
              {
                key: "type",
                header: t("movements.columns.type"),
                render: (m) => t(`movementTypes.${m.type}`),
              },
              { key: "site", header: t("movements.columns.site"), render: (m) => m.siteCode },
              {
                key: "qty",
                header: t("movements.columns.qty"),
                render: (m) => (
                  <span className={m.quantity < 0 ? "text-status-bad" : "text-status-ok"}>
                    {m.quantity > 0 ? "+" : ""}
                    {qtyText(m.quantity, m.product.quantityScale, m.product.unit)}
                  </span>
                ),
              },
              ...(can("product:view_cost")
                ? [
                    {
                      key: "value",
                      header: t("movements.columns.value"),
                      render: (m: (typeof rows)[number]) =>
                        m.value != null ? formatFCFA(m.value) : "—",
                    },
                  ]
                : []),
              {
                key: "doc",
                header: t("movements.columns.document"),
                render: (m) => m.repairOrder?.number ?? m.purchaseOrder?.number ?? "—",
              },
              {
                key: "reason",
                header: t("movements.columns.reason"),
                render: (m) =>
                  [m.reasonCode ? t(`adjust.codes.${m.reasonCode}`) : null, m.reason]
                    .filter(Boolean)
                    .join(" — ") || "—",
              },
              {
                key: "user",
                header: t("movements.columns.user"),
                render: (m) => m.createdBy ?? "—",
              },
            ]}
          />
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t("common.loadMore")}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
