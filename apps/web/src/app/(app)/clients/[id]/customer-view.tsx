"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Car,
  ChevronRight,
  Clock,
  Edit,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { DueBadge, EmptyState, PlateBadge, StatusBadge } from "@atelieros/ui";
import { CreditAlert } from "@/components/credit-alert";
import { LinkButton } from "@/components/link-button";
import { trpc } from "@/trpc/react";
import { ReminderMiniBlock } from "../../relances/reminder-mini-block";
import { ContactsSection } from "./contacts-section";

export function CustomerView({ id }: { id: string }) {
  const { data: customer, isLoading, isError } = trpc.customer.get.useQuery({ id });
  const { data: timeline } = trpc.customer.timeline.useQuery({ id });

  if (isLoading) {
    return (
      <div className="detail-loading">
        <div className="detail-loading-spinner" />
        <p>Chargement...</p>
      </div>
    );
  }

  if (isError || !customer) {
    return (
      <div className="detail-error">
        <p>Client introuvable.</p>
        <Link href="/clients" className="btn btn-secondary btn-sm">
          Retour aux clients
        </Link>
      </div>
    );
  }

  const isCompany = customer.type === "COMPANY";

  return (
    <div className="detail-page">
      {/* Back link */}
      <Link href="/clients" className="detail-back">
        <ArrowLeft size={16} />
        Clients
      </Link>

      {/* Header */}
      <header className="detail-header">
        <div className="detail-header-left">
          <div className={`detail-avatar ${isCompany ? "company" : ""}`}>
            {isCompany ? <Building2 size={28} /> : getInitials(customer.displayName)}
          </div>
          <div className="detail-header-info">
            <h1>{customer.displayName}</h1>
            <div className="detail-header-meta">
              <span className={`detail-type-badge ${isCompany ? "company" : "individual"}`}>
                {isCompany ? "Entreprise" : "Particulier"}
              </span>
              {customer.reachability === "OPTED_OUT" && (
                <StatusBadge tone="bad">Desinscrit</StatusBadge>
              )}
              {customer.reachability === "DO_NOT_REMIND" && (
                <StatusBadge tone="bad">Ne plus relancer</StatusBadge>
              )}
              {customer.reachability === "UNREACHABLE" && (
                <StatusBadge tone="off">Injoignable</StatusBadge>
              )}
            </div>
          </div>
        </div>

        <div className="detail-header-actions">
          {customer.phone && (
            <a href={`tel:${customer.phone}`} className="detail-action-btn" title="Appeler">
              <Phone size={18} />
            </a>
          )}
          {customer.phone && (
            <a
              href={`https://wa.me/${customer.phone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="detail-action-btn whatsapp"
              title="WhatsApp"
            >
              <MessageCircle size={18} />
            </a>
          )}
          {customer.email && (
            <a href={`mailto:${customer.email}`} className="detail-action-btn" title="Email">
              <Mail size={18} />
            </a>
          )}
          <LinkButton href={`/clients/${id}/modifier`} variant="secondary" size="sm">
            <Edit size={16} />
            Modifier
          </LinkButton>
        </div>
      </header>

      <CreditAlert customerId={customer.id} />

      {/* Info cards grid */}
      <div className="detail-cards">
        {/* Contact info */}
        <div className="detail-card">
          <div className="detail-card-header">
            <Phone size={18} />
            <span>Coordonnees</span>
          </div>
          <div className="detail-card-body">
            <div className="detail-info-row">
              <Phone size={16} />
              <span>{customer.phone ? formatPhone(customer.phone) : "—"}</span>
            </div>
            {customer.phone2 && (
              <div className="detail-info-row">
                <Phone size={16} />
                <span>{formatPhone(customer.phone2)}</span>
              </div>
            )}
            <div className="detail-info-row">
              <Mail size={16} />
              <span>{customer.email || "—"}</span>
            </div>
            <div className="detail-info-row">
              <MapPin size={16} />
              <span>
                {customer.commune || customer.address
                  ? `${customer.commune || ""}${customer.commune && customer.address ? ", " : ""}${customer.address || ""}`
                  : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Balance */}
        <div className="detail-card">
          <div className="detail-card-header">
            <Wallet size={18} />
            <span>Encours</span>
          </div>
          <div className="detail-card-body">
            <div className="detail-balance">
              <span className="detail-balance-amount">
                {customer.balance.due.toLocaleString("fr-FR")} FCFA
              </span>
              {customer.balance.overdue > 0 && (
                <span className="detail-balance-overdue">
                  dont {customer.balance.overdue.toLocaleString("fr-FR")} FCFA en retard
                </span>
              )}
              {customer.balance.due === 0 && (
                <span className="detail-balance-ok">Aucun impaye</span>
              )}
            </div>
            {customer.balance.creditLimit && (
              <div className="detail-info-row muted">
                <span>Limite credit : {customer.balance.creditLimit.toLocaleString("fr-FR")} FCFA</span>
              </div>
            )}
          </div>
        </div>

        {/* Company info */}
        {isCompany && (
          <div className="detail-card">
            <div className="detail-card-header">
              <Building2 size={18} />
              <span>Entreprise</span>
            </div>
            <div className="detail-card-body">
              <div className="detail-info-row">
                <span className="detail-info-label">NCC</span>
                <span>{customer.ncc || "—"}</span>
              </div>
              <div className="detail-info-row">
                <span className="detail-info-label">RCCM</span>
                <span>{customer.rccm || "—"}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Vehicles section */}
      <section className="detail-section">
        <div className="detail-section-header">
          <div className="detail-section-title">
            <Car size={20} />
            <h2>Vehicules</h2>
            <span className="detail-section-count">{customer.vehicles.length}</span>
          </div>
          <LinkButton href={`/vehicules/nouveau?customerId=${id}`} variant="secondary" size="sm">
            <Plus size={16} />
            Ajouter
          </LinkButton>
        </div>

        {customer.vehicles.length === 0 ? (
          <EmptyState
            title="Aucun vehicule"
            description="Ajoutez le premier vehicule de ce client"
          />
        ) : (
          <div className="detail-vehicles">
            {customer.vehicles.map((vehicle) => (
              <Link key={vehicle.id} href={`/vehicules/${vehicle.id}`} className="detail-vehicle-card">
                <div className="detail-vehicle-main">
                  <PlateBadge plate={vehicle.plate} plateType={vehicle.plateType} />
                  <div className="detail-vehicle-info">
                    <span className="detail-vehicle-name">
                      {vehicle.make} {vehicle.model}
                    </span>
                    {vehicle.vin && (
                      <span className="detail-vehicle-vin">VIN: {vehicle.vin}</span>
                    )}
                  </div>
                </div>
                <div className="detail-vehicle-right">
                  <DueBadge
                    status={
                      !vehicle.inspectionExpiryDate
                        ? "UNKNOWN"
                        : vehicle.inspectionExpiryDate < new Date()
                          ? "EXPIRED"
                          : "OK"
                    }
                  />
                  <ChevronRight size={18} className="detail-vehicle-arrow" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Contacts section */}
      <ContactsSection customerId={id} />

      {/* Reminders */}
      <ReminderMiniBlock customerId={id} />

      {/* Timeline */}
      <section className="detail-section">
        <div className="detail-section-header">
          <div className="detail-section-title">
            <Clock size={20} />
            <h2>Chronologie</h2>
          </div>
        </div>

        {!timeline || timeline.items.length === 0 ? (
          <EmptyState title="Pas encore d'historique" />
        ) : (
          <div className="detail-timeline">
            {timeline.items.map((item, index) => (
              <div key={index} className="detail-timeline-item">
                <div className="detail-timeline-dot" />
                <div className="detail-timeline-content">
                  <span className="detail-timeline-date">
                    {item.at.toLocaleDateString("fr-FR")}
                  </span>
                  <span className="detail-timeline-type">{item.type}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
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
