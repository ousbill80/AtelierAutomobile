"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Building2,
  Car,
  ChevronLeft,
  ChevronRight,
  Filter,
  Grid3X3,
  List,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Search,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { LinkButton } from "@/components/link-button";
import { GuideLink } from "@/components/guide-link";
import { MiniStat, MiniStatSkeleton } from "@/components/listing/mini-stat";
import { t } from "@/i18n/t";

type ViewMode = "grid" | "list";
type Segment = "ALL" | "INDIVIDUAL" | "COMPANY" | "BALANCE";

const PAGE_SIZE = 10;

export default function ClientsPage() {
  const [q, setQ] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [segment, setSegment] = useState<Segment>("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const summary = trpc.customer.summary.useQuery();
  const type = segment === "INDIVIDUAL" || segment === "COMPANY" ? segment : undefined;
  const { data, isLoading, isError } = trpc.customer.list.useQuery({
    q: q || undefined,
    type,
    hasBalance: segment === "BALANCE" ? true : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const clearFilters = () => {
    setQ("");
    setSegment("ALL");
    setPage(1);
  };

  const chooseSegment = (next: Segment) => {
    setSegment(next);
    setPage(1);
  };

  const totalCount = data?.total ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const startItem = (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, totalCount);

  const hasActiveFilters = Boolean(q) || segment !== "ALL";

  return (
    <div className="listing-page">
      {/* Header */}
      <div className="listing-header">
        <div>
          <h1>{t("customers.page.title")}</h1>
          {data && (
            <p className="listing-subtitle">
              {t(totalCount > 1 ? "customers.page.countMany" : "customers.page.countOne", {
                count: totalCount,
              })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <GuideLink href="/clients/guide" />
          <LinkButton href="/clients/nouveau">
            <Plus size={18} />
            {t("customers.page.new")}
          </LinkButton>
        </div>
      </div>

      {summary.isLoading && <MiniStatSkeleton />}
      {summary.data && (
        <div className="mini-stats" role="group" aria-label={t("customers.list.widgetsLabel")}>
          <MiniStat
            icon={Users}
            label={t("customers.list.all")}
            value={summary.data.total}
            pressed={segment === "ALL"}
            onClick={() => chooseSegment("ALL")}
            help={t("customers.list.help.all")}
            example={t("customers.list.example.all")}
          />
          <MiniStat
            icon={User}
            label={t("customers.list.individual")}
            value={summary.data.individual}
            pressed={segment === "INDIVIDUAL"}
            onClick={() => chooseSegment("INDIVIDUAL")}
            help={t("customers.list.help.individual")}
            example={t("customers.list.example.individual")}
          />
          <MiniStat
            icon={Building2}
            label={t("customers.list.company")}
            value={summary.data.company}
            pressed={segment === "COMPANY"}
            onClick={() => chooseSegment("COMPANY")}
            help={t("customers.list.help.company")}
            example={t("customers.list.example.company")}
          />
          <MiniStat
            icon={Wallet}
            label={t("customers.list.balance")}
            value={summary.data.withBalance}
            tone={summary.data.withBalance > 0 ? "bad" : "neutral"}
            pressed={segment === "BALANCE"}
            onClick={() => chooseSegment("BALANCE")}
            help={t("customers.list.help.balance")}
            example={t("customers.list.example.balance")}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="listing-toolbar">
        {/* Search */}
        <div className="listing-search">
          <Search size={18} />
          <input
            type="text"
            placeholder={t("customers.page.searchPlaceholder")}
            aria-label={t("customers.page.searchPlaceholder")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setPage(1);
              }}
              className="listing-search-clear"
              aria-label={t("customers.page.clearSearch")}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Filters toggle */}
        <button
          type="button"
          className={`listing-filter-btn ${showFilters ? "active" : ""}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={18} />
          {t("customers.page.filters")}
          {hasActiveFilters && <span className="listing-filter-dot" />}
        </button>

        {/* View toggle */}
        <div className="listing-view-toggle">
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
            title={t("customers.page.viewList")}
            aria-label={t("customers.page.viewList")}
          >
            <List size={18} />
          </button>
          <button
            type="button"
            className={viewMode === "grid" ? "active" : ""}
            onClick={() => setViewMode("grid")}
            title={t("customers.page.viewGrid")}
            aria-label={t("customers.page.viewGrid")}
          >
            <Grid3X3 size={18} />
          </button>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="listing-filters">
          <div className="listing-filter-group">
            <label>{t("customers.page.type")}</label>
            <select
              value={segment === "INDIVIDUAL" || segment === "COMPANY" ? segment : "ALL"}
              onChange={(e) => {
                const value = e.target.value;
                chooseSegment(value === "INDIVIDUAL" || value === "COMPANY" ? value : "ALL");
              }}
              className="select"
            >
              <option value="ALL">{t("customers.page.all")}</option>
              <option value="INDIVIDUAL">{t("customers.page.individual")}</option>
              <option value="COMPANY">{t("customers.page.company")}</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button type="button" className="listing-clear-filters" onClick={clearFilters}>
              <X size={14} />
              {t("customers.page.clearFilters")}
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="listing-loading">
          <div className="listing-loading-spinner" />
          <p>{t("customers.page.loading")}</p>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="listing-error">
          <p>{t("customers.page.loadError")}</p>
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            {t("customers.page.retry")}
          </Button>
        </div>
      )}

      {/* Empty */}
      {data && data.items.length === 0 && (
        <EmptyState
          title={q ? t("customers.page.emptySearchTitle", { q }) : t("customers.page.emptyTitle")}
          description={q ? t("customers.page.emptySearchHint") : t("customers.page.emptyHint")}
          action={
            q ? (
              <Button variant="secondary" onClick={clearFilters}>
                {t("customers.page.clearSearch")}
              </Button>
            ) : (
              <LinkButton href="/clients/nouveau">{t("customers.page.new")}</LinkButton>
            )
          }
        />
      )}

      {/* List view */}
      {data && data.items.length > 0 && viewMode === "list" && (
        <div className="listing-table-wrap">
          <table className="listing-table">
            <thead>
              <tr>
                <th>{t("customers.page.colClient")}</th>
                <th>{t("customers.page.colType")}</th>
                <th>{t("customers.page.colPhone")}</th>
                <th>{t("customers.page.colCommune")}</th>
                <th>{t("customers.page.colVehicles")}</th>
                <th>
                  <span className="sr-only">{t("customers.page.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((client) => (
                <tr key={client.id}>
                  <td>
                    <Link href={`/clients/${client.id}`} className="listing-table-link">
                      <span className="listing-table-avatar">
                        {client.type === "COMPANY" ? (
                          <Building2 size={14} />
                        ) : (
                          getInitials(client.displayName)
                        )}
                      </span>
                      <span className="listing-table-name">{client.displayName}</span>
                    </Link>
                  </td>
                  <td>
                    <span className={`listing-type-badge ${client.type.toLowerCase()}`}>
                      {client.type === "COMPANY"
                        ? t("customers.page.company")
                        : t("customers.page.individual")}
                    </span>
                  </td>
                  <td className="listing-table-phone">
                    {client.phone ? formatPhone(client.phone) : "—"}
                  </td>
                  <td className="listing-table-muted">{client.commune || "—"}</td>
                  <td>
                    <span className="listing-vehicle-count">
                      <Car size={14} />
                      {client.vehicleCount}
                    </span>
                  </td>
                  <td>
                    <div className="listing-table-actions">
                      {client.phone && (
                        <a
                          href={`tel:${client.phone}`}
                          className="listing-action-btn"
                          title={t("customers.page.call")}
                          aria-label={t("customers.page.call")}
                        >
                          <Phone size={16} />
                        </a>
                      )}
                      {client.phone && (
                        <a
                          href={`https://wa.me/${client.phone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="listing-action-btn whatsapp"
                          title={t("customers.page.whatsapp")}
                          aria-label={t("customers.page.whatsapp")}
                        >
                          <MessageCircle size={16} />
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

      {/* Grid view */}
      {data && data.items.length > 0 && viewMode === "grid" && (
        <div className="listing-grid">
          {data.items.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`} className="listing-card">
              <div className="listing-card-header">
                <span
                  className={`listing-card-avatar ${client.type === "COMPANY" ? "company" : ""}`}
                >
                  {client.type === "COMPANY" ? (
                    <Building2 size={18} />
                  ) : (
                    getInitials(client.displayName)
                  )}
                </span>
                <span className={`listing-type-badge ${client.type.toLowerCase()}`}>
                  {client.type === "COMPANY"
                    ? t("customers.page.company")
                    : t("customers.page.individual")}
                </span>
              </div>

              <h3 className="listing-card-name">{client.displayName}</h3>

              <div className="listing-card-details">
                {client.phone && (
                  <span>
                    <Phone size={14} />
                    {formatPhone(client.phone)}
                  </span>
                )}
                {client.commune && (
                  <span>
                    <MapPin size={14} />
                    {client.commune}
                  </span>
                )}
              </div>

              <div className="listing-card-footer">
                <span className="listing-vehicle-count">
                  <Car size={14} />
                  {t(
                    client.vehicleCount > 1
                      ? "customers.page.vehicleMany"
                      : "customers.page.vehicleOne",
                    { count: client.vehicleCount },
                  )}
                </span>

                <div className="listing-card-actions">
                  {client.phone && (
                    <button
                      type="button"
                      className="listing-action-btn"
                      aria-label={t("customers.page.call")}
                      onClick={(e) => {
                        e.preventDefault();
                        window.open(`tel:${client.phone}`);
                      }}
                    >
                      <Phone size={14} />
                    </button>
                  )}
                  {client.phone && (
                    <button
                      type="button"
                      className="listing-action-btn whatsapp"
                      aria-label={t("customers.page.whatsapp")}
                      onClick={(e) => {
                        e.preventDefault();
                        window.open(`https://wa.me/${client.phone?.replace(/\D/g, "")}`);
                      }}
                    >
                      <MessageCircle size={14} />
                    </button>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="listing-pagination">
          <span className="listing-pagination-info">
            {t("customers.page.pageRange", { start: startItem, end: endItem, total: totalCount })}
          </span>
          <div className="listing-pagination-btns">
            <button
              type="button"
              className="listing-pagination-btn"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              <ChevronLeft size={20} />
              {t("customers.page.previous")}
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  type="button"
                  className={`listing-pagination-btn ${page === pageNum ? "active" : ""}`}
                  onClick={() => setPage(pageNum)}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              type="button"
              className="listing-pagination-btn"
              onClick={() => setPage(page + 1)}
              disabled={page === totalPages}
            >
              {t("customers.page.next")}
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.substring(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

function formatPhone(phone: string): string {
  if (phone.startsWith("+225") && phone.length === 13) {
    const rest = phone.slice(4);
    return `+225 ${rest.slice(0, 2)} ${rest.slice(2, 4)} ${rest.slice(4, 6)} ${rest.slice(6, 8)} ${rest.slice(8, 10)}`;
  }
  return phone;
}
