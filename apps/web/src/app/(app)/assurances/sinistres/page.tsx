"use client";

// M16 §7 — /assurances/sinistres : n° SIN, n° assureur, client, plaque, compagnie, statut, parts
// et soldes, badges de blocage (US-M16-09) ; recherche, filtres statut/compagnie, export CSV.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import { EmptyState, Input, PlateBadge, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { BlockerBadge, ClaimStatusBadge, type Blocker } from "@/components/claims/badges";
import { CLAIM_STATUSES, t } from "@/components/claims/i18n";
import { ClaimsNav } from "../nav";

type Status = (typeof CLAIM_STATUSES)[number];

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ClaimsList() {
  const params = useSearchParams();
  const me = trpc.me.get.useQuery();
  const perms = new Set(me.data?.permissions ?? []);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const [insurerId, setInsurerId] = useState(params.get("compagnie") ?? "");
  const [blockedOnly, setBlockedOnly] = useState(params.get("bloques") === "1");
  const insurers = trpc.insurer.list.useQuery();
  const list = trpc.claim.list.useQuery({
    q: q.trim() || undefined,
    status: status || undefined,
    insurerId: insurerId || undefined,
    blockedOnly: blockedOnly || undefined,
    limit: 100,
  });

  function exportCsv() {
    if (!list.data) return;
    const head = [
      t("fields.number"),
      t("fields.claimNumber"),
      t("fields.customer"),
      t("fields.plate"),
      t("fields.insurer"),
      t("fields.insurerShare"),
      t("fields.insurerBalance"),
      t("fields.customerShare"),
      t("fields.customerBalance"),
    ];
    const rows = list.data.items.map((c) => [
      c.number,
      c.claimNumber,
      c.customer.displayName,
      c.vehicle.plate,
      c.insurer.name,
      c.insurerTotal,
      c.insurerBalance,
      c.customerTotal,
      c.customerBalance,
    ]);
    const csv = [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\n");
    const url = URL.createObjectURL(
      new Blob([`${String.fromCharCode(0xfeff)}${csv}`], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "sinistres.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("claimsTitle")}</h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary min-h-11" onClick={exportCsv}>
            {t("csv")}
          </button>
          {perms.has("insurance:manage") && (
            <Link href="/assurances/sinistres/nouveau" className="btn btn-primary min-h-11">
              + {t("new")}
            </Link>
          )}
        </div>
      </div>
      <ClaimsNav />
      <Input
        aria-label={t("search")}
        placeholder={t("search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Select
          aria-label={t("allStatuses")}
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | "")}
        >
          <option value="">{t("allStatuses")}</option>
          {CLAIM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("allInsurers")}
          value={insurerId}
          onChange={(e) => setInsurerId(e.target.value)}
        >
          <option value="">{t("allInsurers")}</option>
          {insurers.data?.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={blockedOnly}
            onChange={(e) => setBlockedOnly(e.target.checked)}
          />
          {t("blockedOnly")}
        </label>
      </div>
      {list.isLoading ? (
        <ListSkeleton rows={4} />
      ) : list.isError || !list.data ? (
        <ErrorBox onRetry={() => list.refetch()} message={t("loadError")} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("claimsTitle")}>
          {list.data.items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/assurances/sinistres/${c.id}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm hover:border-accent md:flex-row md:items-center md:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{c.number}</span>
                    {c.claimNumber && <span className="text-xs text-muted">{c.claimNumber}</span>}
                    <ClaimStatusBadge status={c.status} />
                  </span>
                  <span className="truncate">
                    {c.customer.displayName} · {c.insurer.name}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <PlateBadge plate={c.vehicle.plate} />
                    <span>
                      {c.vehicle.make} {c.vehicle.model}
                    </span>
                  </span>
                  {c.blockers.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {(c.blockers as Blocker[]).map((b) => (
                        <BlockerBadge key={b.code} blocker={b} />
                      ))}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-xs md:flex-col md:items-end">
                  {c.insurerTotal !== null && (
                    <span>
                      {t("fields.insurerShare")} {formatFCFA(c.insurerTotal)}
                      {c.insurerBalance
                        ? ` · ${t("dueAmount", { amount: formatFCFA(c.insurerBalance) })}`
                        : ""}
                    </span>
                  )}
                  {c.customerTotal !== null && (
                    <span>
                      {t("fields.customerShare")} {formatFCFA(c.customerTotal)}
                      {c.customerBalance
                        ? ` · ${t("dueAmount", { amount: formatFCFA(c.customerBalance) })}`
                        : ""}
                    </span>
                  )}
                  {c.insurerTotal === null && c.approvedAmount !== null && (
                    <span>
                      {t("fields.approvedAmount")} {formatFCFA(c.approvedAmount)}
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

export default function ClaimsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <ClaimsList />
    </Suspense>
  );
}
