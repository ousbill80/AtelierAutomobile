"use client";

// M14 §7 — `/clients/avis` : avis laissés par les clients après restitution (US-M14-11),
// filtre par note, moyenne sur 30 jours. Permission `customer:read` (vérifiée côté serveur).
import Link from "next/link";
import { useState } from "react";
import { EmptyState, StatusBadge, type StatusTone } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { formatDateTime } from "@/components/repair-orders/i18n";
import { t } from "@/i18n/t";

function tone(rating: number): StatusTone {
  return rating >= 4 ? "ok" : rating === 3 ? "warn" : "bad";
}

export default function ReviewsPage() {
  const [rating, setRating] = useState<number | undefined>(undefined);
  const query = trpc.feedback.list.useQuery({ rating, limit: 50 });
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("portal.reviews.title")}</h1>
      {data && (
        <p className="text-sm">
          {data.average30d !== null
            ? t("portal.reviews.average", {
                avg: data.average30d.toFixed(1).replace(".", ","),
                count: data.count30d,
              })
            : t("portal.reviews.noAverage")}
        </p>
      )}
      <label className="flex max-w-xs flex-col gap-1 text-sm">
        <span>{t("portal.reviews.filter")}</span>
        <select
          className="min-h-11 rounded-md border border-border bg-surface px-2"
          value={rating ?? ""}
          onChange={(e) => setRating(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">{t("portal.reviews.all")}</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {"★".repeat(n)} ({n}/5)
            </option>
          ))}
        </select>
      </label>
      {query.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <div className="h-16 animate-pulse rounded bg-surface-2" />
          <div className="h-16 animate-pulse rounded bg-surface-2" />
        </div>
      ) : query.isError ? (
        <p role="alert" className="text-status-bad">
          {t("portal.reviews.error")}
        </p>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t("portal.reviews.empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((f) => (
            <li
              key={f.id}
              className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={tone(f.rating)}
                  label={`${"★".repeat(f.rating)} ${f.rating}/5`}
                />
                <Link href={`/clients/${f.customer.id}`} className="font-medium underline">
                  {f.customer.displayName}
                </Link>
                <Link href={`/ordres/${f.repairOrder.id}`} className="text-muted underline">
                  {t("portal.reviews.order", { number: f.repairOrder.number })}
                </Link>
                <span className="text-muted">{formatDateTime(f.createdAt)}</span>
              </div>
              {f.comment && <p className="break-words">{f.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
