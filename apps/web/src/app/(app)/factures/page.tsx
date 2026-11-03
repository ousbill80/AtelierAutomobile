"use client";

// M08 §7 — /factures : onglets (brouillons, à encaisser, payées, non certifiées FNE, avoirs),
// recherche ; cartes lisibles sur mobile (390 px) et sur ordinateur.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { EmptyState, Input, PlateBadge, Tabs } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay } from "@/components/repair-orders/i18n";
import { FneBadge, InvoiceStatusBadge } from "@/components/billing/badges";
import { t } from "@/components/billing/i18n";
import { GuideLink } from "@/components/guide-link";

const VIEWS = ["all", "drafts", "open", "paid", "fne_pending", "credit_notes"] as const;
type View = (typeof VIEWS)[number];

export default function InvoicesPage() {
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const list = trpc.invoice.list.useQuery({ view, q: q.trim() || undefined });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("listSubtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GuideLink href="/factures/guide" />
          {perms.has("accounting:export") && (
            <Link href="/factures/exports" className="btn btn-secondary min-h-11">
              {t("exportsAction")}
            </Link>
          )}
          {perms.has("invoice:create") && (
            <Link href="/factures/nouvelle" className="btn btn-primary min-h-11">
              + {t("new")}
            </Link>
          )}
        </div>
      </div>
      <div className="max-w-full overflow-x-auto">
        <Tabs
          items={VIEWS.map((key) => ({
            key,
            label:
              key === "fne_pending" && list.data?.fnePendingCount
                ? `${t(`views.${key}`)} (${list.data.fnePendingCount})`
                : t(`views.${key}`),
          }))}
          activeKey={view}
          onChange={(key) => setView(key as View)}
        />
      </div>
      <Input
        aria-label={t("search")}
        placeholder={t("search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {list.isLoading ? (
        <ListSkeleton rows={4} />
      ) : list.isError || !list.data ? (
        <ErrorBox onRetry={() => list.refetch()} message={t("loadError")} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="hidden grid-cols-[8.5rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_minmax(0,1.1fr)_7.5rem_6.5rem] gap-3 border-b border-border bg-surface-2 px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase lg:grid">
            <span>{t("fields.number")}</span>
            <span>{t("fields.customer")}</span>
            <span>{t("fields.vehicle")}</span>
            <span>{t("fields.date")}</span>
            <span>{t("fields.status")}</span>
            <span className="text-right">{t("fields.total")}</span>
            <span className="text-right">{t("fields.balance")}</span>
          </div>
          <ul aria-label={t("title")}>
            {list.data.items.map((inv) => (
              <li key={inv.id} className="border-b border-border last:border-b-0">
                <Link
                  href={`/factures/${inv.id}`}
                  className="flex min-w-0 flex-col gap-2 p-3 text-sm hover:bg-surface-2 lg:grid lg:grid-cols-[8.5rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_minmax(0,1.1fr)_7.5rem_6.5rem] lg:items-center lg:gap-3 lg:px-4"
                >
                  <span className="flex items-baseline justify-between gap-3 lg:contents">
                    <span className="font-mono font-semibold">{inv.number ?? t("draft")}</span>
                    <span className="font-semibold tabular-nums lg:hidden">
                      {formatFCFA(inv.total)}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{inv.customer.displayName}</span>
                    {inv.type !== "INVOICE" && (
                      <span className="text-xs text-muted">{t(`type.${inv.type}`)}</span>
                    )}
                    {inv.billTo === "INSURANCE" && (
                      <span className="text-xs text-muted">{t("billTo.INSURANCE")}</span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
                    {inv.vehicle ? <PlateBadge plate={inv.vehicle.plate} /> : <span>—</span>}
                    {inv.repairOrder && <span className="truncate">{inv.repairOrder.number}</span>}
                  </span>
                  <span className="text-muted">
                    {formatDay(inv.issuedAt ?? inv.createdAt, list.data.timeZone)}
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <InvoiceStatusBadge status={inv.status} />
                    {inv.status !== "DRAFT" && <FneBadge status={inv.fneStatus} />}
                  </span>
                  <span className="hidden font-semibold tabular-nums lg:block lg:text-right">
                    {formatFCFA(inv.total)}
                  </span>
                  <span className="text-muted tabular-nums lg:text-right">
                    {inv.status !== "DRAFT" && inv.type !== "CREDIT_NOTE"
                      ? formatFCFA(inv.balance)
                      : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
