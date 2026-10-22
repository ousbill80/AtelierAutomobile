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
  X,
} from "lucide-react";
import { Button, EmptyState, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { LinkButton } from "@/components/link-button";

type ViewMode = "grid" | "list";
type CustomerType = "ALL" | "INDIVIDUAL" | "COMPANY";

const PAGE_SIZE = 10;

export default function ClientsPage() {
  const [q, setQ] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [typeFilter, setTypeFilter] = useState<CustomerType>("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = trpc.customer.list.useQuery({
    q: q || undefined,
    type: typeFilter === "ALL" ? undefined : typeFilter,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const clearFilters = () => {
    setQ("");
    setTypeFilter("ALL");
    setPage(1);
  };

  const totalCount = data?.total ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const startItem = (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, totalCount);

  const hasActiveFilters = q || typeFilter !== "ALL";

  return (
    <div className="listing-page">
      {/* Header */}
      <div className="listing-header">
        <div>
          <h1>Clients</h1>
          {data && (
            <p className="listing-subtitle">
              {totalCount} client{totalCount > 1 ? "s" : ""}
            </p>
          )}
        </div>
        <LinkButton href="/clients/nouveau">
          <Plus size={18} />
          Nouveau client
        </LinkButton>
      </div>

      {/* Toolbar */}
      <div className="listing-toolbar">
        {/* Search */}
        <div className="listing-search">
          <Search size={18} />
          <input
            type="text"
            placeholder="Rechercher..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          {q && (
            <button type="button" onClick={() => { setQ(""); setPage(1); }} className="listing-search-clear">
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
          Filtres
          {hasActiveFilters && <span className="listing-filter-dot" />}
        </button>

        {/* View toggle */}
        <div className="listing-view-toggle">
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
            title="Vue liste"
          >
            <List size={18} />
          </button>
          <button
            type="button"
            className={viewMode === "grid" ? "active" : ""}
            onClick={() => setViewMode("grid")}
            title="Vue grille"
          >
            <Grid3X3 size={18} />
          </button>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="listing-filters">
          <div className="listing-filter-group">
            <label>Type</label>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as CustomerType);
                setPage(1);
              }}
              className="select"
            >
              <option value="ALL">Tous</option>
              <option value="INDIVIDUAL">Particulier</option>
              <option value="COMPANY">Entreprise</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button type="button" className="listing-clear-filters" onClick={clearFilters}>
              <X size={14} />
              Effacer les filtres
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="listing-loading">
          <div className="listing-loading-spinner" />
          <p>Chargement...</p>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="listing-error">
          <p>Erreur lors du chargement</p>
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            Reessayer
          </Button>
        </div>
      )}

      {/* Empty */}
      {data && data.items.length === 0 && (
        <EmptyState
          title={q ? `Aucun resultat pour "${q}"` : "Aucun client"}
          description={q ? "Essayez avec d'autres termes" : "Creez votre premier client"}
          action={
            q ? (
              <Button variant="secondary" onClick={clearFilters}>
                Effacer la recherche
              </Button>
            ) : (
              <LinkButton href="/clients/nouveau">Nouveau client</LinkButton>
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
                <th>Client</th>
                <th>Type</th>
                <th>Telephone</th>
                <th>Commune</th>
                <th>Vehicules</th>
                <th></th>
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
                      {client.type === "COMPANY" ? "Entreprise" : "Particulier"}
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
                          title="Appeler"
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
                          title="WhatsApp"
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
                  {client.type === "COMPANY" ? "Entreprise" : "Particulier"}
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
                  {client.vehicleCount} vehicule{client.vehicleCount > 1 ? "s" : ""}
                </span>

                <div className="listing-card-actions">
                  {client.phone && (
                    <button
                      type="button"
                      className="listing-action-btn"
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
            {startItem} - {endItem} sur {totalCount} clients
          </span>
          <div className="listing-pagination-btns">
            <button
              type="button"
              className="listing-pagination-btn"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              <ChevronLeft size={20} />
              Precedent
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
              Suivant
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
