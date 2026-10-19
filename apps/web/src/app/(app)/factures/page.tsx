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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          {perms.has("accounting:export") && (
            <Link href="/factures/exports" className="btn btn-secondary min-h-11">
              {t("exports")}
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
        <ul className="flex flex-col gap-2" aria-label={t("title")}>
          {list.data.items.map((inv) => (
            <li key={inv.id}>
              <Link
                href={`/factures/${inv.id}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm hover:border-accent md:flex-row md:items-center md:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{inv.number ?? t("draft")}</span>
                    {inv.type !== "INVOICE" && (
                      <span className="text-xs font-semibold">{t(`type.${inv.type}`)}</span>
                    )}
                    {inv.billTo === "INSURANCE" && (
                      <span className="text-xs font-semibold">{t("billTo.INSURANCE")}</span>
                    )}
                    <InvoiceStatusBadge status={inv.status} />
                    {inv.status !== "DRAFT" && <FneBadge status={inv.fneStatus} />}
                  </span>
                  <span className="truncate">{inv.customer.displayName}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {inv.vehicle && <PlateBadge plate={inv.vehicle.plate} />}
                    {inv.repairOrder && <span>{inv.repairOrder.number}</span>}
                    <span>{formatDay(inv.issuedAt ?? inv.createdAt, list.data.timeZone)}</span>
                    {inv.dueDate && inv.type !== "CREDIT_NOTE" && (
                      <span>
                        {t("fields.dueDate")} {formatDay(inv.dueDate, "UTC")}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 md:flex-col md:items-end">
                  <span className="font-semibold">{formatFCFA(inv.total)}</span>
                  {inv.status !== "DRAFT" && inv.type !== "CREDIT_NOTE" && inv.balance > 0 && (
                    <span className="text-xs">
                      {t("fields.balance")} {formatFCFA(inv.balance)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
