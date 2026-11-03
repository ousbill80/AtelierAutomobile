"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  CalendarOff,
  Car,
  CircleAlert,
  Grid3X3,
  List,
  Phone,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button, DueBadge, EmptyState, PlateBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { LinkButton } from "@/components/link-button";
import { GuideLink } from "@/components/guide-link";
import { MiniStat, MiniStatSkeleton } from "@/components/listing/mini-stat";
import { t } from "@/i18n/t";

type ViewMode = "grid" | "list";
type Segment = "ALL" | "DUE_SOON" | "EXPIRED" | "UNKNOWN";

export default function VehiclesPage() {
  const [q, setQ] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [segment, setSegment] = useState<Segment>("ALL");

  const summary = trpc.vehicle.summary.useQuery();
  const list = trpc.vehicle.list.useInfiniteQuery(
    {
      q: q.trim() || undefined,
      inspectionStatus: segment === "ALL" ? undefined : segment,
      limit: 20,
    },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const count =
    segment === "DUE_SOON"
      ? summary.data?.dueSoon
      : segment === "EXPIRED"
        ? summary.data?.expired
        : segment === "UNKNOWN"
          ? summary.data?.unknown
          : summary.data?.total;

  return (
    <div className="listing-page">
      <div className="listing-header">
        <div>
          <h1>{t("vehicles.list.title")}</h1>
          {!q && count != null && (
            <p className="listing-subtitle">
              {t(count === 1 ? "vehicles.list.countOne" : "vehicles.list.countMany", { count })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <GuideLink href="/clients/guide" />
          <LinkButton href="/vehicules/nouveau">
            <Plus size={18} />
            {t("vehicles.list.new")}
          </LinkButton>
        </div>
      </div>

      {summary.isLoading && <MiniStatSkeleton />}
      {summary.data && (
        <div className="mini-stats" role="group" aria-label={t("vehicles.list.widgetsLabel")}>
          <MiniStat
            icon={Car}
            label={t("vehicles.list.all")}
            value={summary.data.total}
            pressed={segment === "ALL"}
            onClick={() => setSegment("ALL")}
            help={t("vehicles.list.help.all")}
            example={t("vehicles.list.example.all")}
          />
          <MiniStat
            icon={CalendarClock}
            label={t("vehicles.list.dueSoon")}
            value={summary.data.dueSoon}
            tone={summary.data.dueSoon > 0 ? "warn" : "neutral"}
            pressed={segment === "DUE_SOON"}
            onClick={() => setSegment("DUE_SOON")}
            help={t("vehicles.list.help.dueSoon")}
            example={t("vehicles.list.example.dueSoon")}
          />
          <MiniStat
            icon={CircleAlert}
            label={t("vehicles.list.expired")}
            value={summary.data.expired}
            tone={summary.data.expired > 0 ? "bad" : "neutral"}
            pressed={segment === "EXPIRED"}
            onClick={() => setSegment("EXPIRED")}
            help={t("vehicles.list.help.expired")}
            example={t("vehicles.list.example.expired")}
          />
          <MiniStat
            icon={CalendarOff}
            label={t("vehicles.list.unknown")}
            value={summary.data.unknown}
            tone={summary.data.unknown > 0 ? "warn" : "neutral"}
            pressed={segment === "UNKNOWN"}
            onClick={() => setSegment("UNKNOWN")}
            help={t("vehicles.list.help.unknown")}
            example={t("vehicles.list.example.unknown")}
          />
        </div>
      )}

      <div className="listing-toolbar">
        <div className="listing-search">
          <Search size={18} />
          <input
            type="text"
            placeholder={t("vehicles.list.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t("vehicles.list.search")}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="listing-search-clear"
              aria-label={t("vehicles.list.clearSearch")}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="listing-view-toggle">
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
            title={t("vehicles.list.viewList")}
          >
            <List size={18} />
          </button>
          <button
            type="button"
            className={viewMode === "grid" ? "active" : ""}
            onClick={() => setViewMode("grid")}
            title={t("vehicles.list.viewGrid")}
          >
            <Grid3X3 size={18} />
          </button>
        </div>
      </div>

      {list.isLoading && (
        <div className="listing-loading">
          <div className="listing-loading-spinner" />
          <p>{t("vehicles.list.loading")}</p>
        </div>
      )}

      {list.isError && (
        <div className="listing-error">
          <p>{t("vehicles.list.error")}</p>
          <Button variant="secondary" size="sm" onClick={() => list.refetch()}>
            {t("vehicles.list.retry")}
          </Button>
        </div>
      )}

      {list.data && items.length === 0 && (
        <EmptyState
          title={q ? t("vehicles.list.emptySearch", { query: q.trim() }) : t("vehicles.list.empty")}
          description={q ? t("vehicles.list.emptySearchHint") : t("vehicles.list.emptyHint")}
          action={
            q ? (
              <Button variant="secondary" onClick={() => setQ("")}>
                {t("vehicles.list.clearSearch")}
              </Button>
            ) : (
              <LinkButton href="/vehicules/nouveau">{t("vehicles.list.new")}</LinkButton>
            )
          }
        />
      )}

      {items.length > 0 && viewMode === "list" && (
        <div className="listing-table-wrap">
          <table className="listing-table">
            <thead>
              <tr>
                <th>{t("vehicles.list.colVehicle")}</th>
                <th>{t("vehicles.list.colClient")}</th>
                <th>{t("vehicles.list.colInspection")}</th>
                <th>{t("vehicles.list.colMileage")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td>
                    <Link href={`/vehicules/${vehicle.id}`} className="listing-table-link">
                      <PlateBadge plate={vehicle.plate} plateType={vehicle.plateType} />
                      <span className="listing-table-name">
                        {vehicle.make} {vehicle.model}
                        {vehicle.year ? (
                          <span className="listing-table-year"> {vehicle.year}</span>
                        ) : null}
                      </span>
                    </Link>
                  </td>
                  <td>
                    <Link href={`/clients/${vehicle.customer.id}`} className="listing-table-name">
                      {vehicle.customer.displayName}
                    </Link>
                  </td>
                  <td>
                    <DueBadge status={vehicle.status.inspection} />
                  </td>
                  <td className="listing-table-muted">
                    {formatKm(vehicle.status.estimatedMileage)}
                  </td>
                  <td>
                    <div className="listing-table-actions">
                      {vehicle.customer.phone && (
                        <a
                          href={`tel:${vehicle.customer.phone}`}
                          className="listing-action-btn"
                          title={t("vehicles.list.call")}
                        >
                          <Phone size={16} />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && viewMode === "grid" && (
        <div className="listing-grid">
          {items.map((vehicle) => (
            <Link key={vehicle.id} href={`/vehicules/${vehicle.id}`} className="listing-card">
              <div className="listing-card-header">
                <PlateBadge plate={vehicle.plate} plateType={vehicle.plateType} />
                <DueBadge status={vehicle.status.inspection} />
              </div>
              <h3 className="listing-card-name">
                {vehicle.make} {vehicle.model}
                {vehicle.year ? <span className="listing-table-year"> {vehicle.year}</span> : null}
              </h3>
              <div className="listing-card-details">
                <span>
                  <Car size={14} />
                  {vehicle.customer.displayName}
                </span>
              </div>
              <div className="listing-card-footer">
                <span className="listing-vehicle-count">
                  {formatKm(vehicle.status.estimatedMileage)}
                </span>
                {vehicle.customer.phone && (
                  <button
                    type="button"
                    className="listing-action-btn"
                    title={t("vehicles.list.call")}
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(`tel:${vehicle.customer.phone}`);
                    }}
                  >
                    <Phone size={14} />
                  </button>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {list.hasNextPage && (
        <div className="listing-pagination">
          <span className="listing-pagination-info" />
          <button
            type="button"
            className="listing-pagination-btn"
            onClick={() => list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            {t("vehicles.list.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}

function formatKm(value: number | null | undefined): string {
  if (value == null) return t("vehicles.list.mileageUnknown");
  return `${new Intl.NumberFormat("fr-FR").format(value)} km`;
}
