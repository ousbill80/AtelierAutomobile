"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Calendar,
  CalendarClock,
  Car,
  Clock,
  ExternalLink,
  FileSignature,
  FileText,
  Gauge,
  History,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  Send,
  ShieldAlert,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import {
  Button,
  DueBadge,
  EmptyState,
  Field,
  Modal,
  PlateBadge,
  StatusBadge,
  Textarea,
  TypeBadge,
  type StatusTone,
} from "@atelieros/ui";
import { CreditAlert } from "@/components/credit-alert";
import { LinkButton } from "@/components/link-button";
import { trpc } from "@/trpc/react";
import { ReminderMiniBlock } from "../../relances/reminder-mini-block";
import { ContactsSection } from "./contacts-section";

type ActiveTab =
  | "vehicles"
  | "repairOrders"
  | "quotes"
  | "invoices"
  | "contacts"
  | "reminders"
  | "timeline";

function formatAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const clean = phone.replace(/\s+/g, "");
  if (clean.startsWith("+225") && clean.length === 14) {
    return `+225 ${clean.slice(4, 6)} ${clean.slice(6, 8)} ${clean.slice(8, 10)} ${clean.slice(10, 12)} ${clean.slice(12)}`;
  }
  return phone;
}

const RO_STATUS_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: "Brouillon", tone: "off" },
  CHECKED_IN: { label: "Réceptionné", tone: "accent" },
  DIAGNOSING: { label: "En diagnostic", tone: "warn" },
  AWAITING_APPROVAL: { label: "Attente accord", tone: "warn" },
  APPROVED: { label: "Validé", tone: "ok" },
  IN_PROGRESS: { label: "En cours", tone: "accent" },
  WAITING_PARTS: { label: "Attente pièces", tone: "warn" },
  QUALITY_CHECK: { label: "Contrôle qualité", tone: "accent" },
  READY: { label: "Prêt", tone: "ok" },
  DELIVERED: { label: "Livré", tone: "ok" },
  INVOICED: { label: "Facturé", tone: "ok" },
  CANCELLED: { label: "Annulé", tone: "bad" },
};

const QUOTE_STATUS_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: "Brouillon", tone: "off" },
  PENDING_INTERNAL_APPROVAL: { label: "Validation interne", tone: "warn" },
  SENT: { label: "Envoyé", tone: "accent" },
  VIEWED: { label: "Consulté", tone: "accent" },
  ACCEPTED: { label: "Accepté", tone: "ok" },
  PARTIALLY_ACCEPTED: { label: "Partiel", tone: "ok" },
  DECLINED: { label: "Refusé", tone: "bad" },
  EXPIRED: { label: "Expiré", tone: "off" },
  CONVERTED: { label: "Converti en OR", tone: "ok" },
};

const INVOICE_STATUS_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: "Brouillon", tone: "off" },
  ISSUED: { label: "Émise", tone: "accent" },
  PARTIALLY_PAID: { label: "Partiellement payée", tone: "warn" },
  PAID: { label: "Payée", tone: "ok" },
  OVERDUE: { label: "En retard", tone: "bad" },
  DISPUTED: { label: "En litige", tone: "bad" },
  VOID: { label: "Annulée", tone: "off" },
  WRITTEN_OFF: { label: "Passée en perte", tone: "bad" },
};

export function CustomerView({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<ActiveTab>("vehicles");
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [notePinned, setNotePinned] = useState(false);

  const { data: customer, isLoading, isError } = trpc.customer.get.useQuery({ id });
  const { data: timeline } = trpc.customer.timeline.useQuery({ id });

  const addNote = trpc.customer.addNote.useMutation({
    onSuccess: () => {
      setIsNoteModalOpen(false);
      setNoteBody("");
      setNotePinned(false);
      void utils.customer.timeline.invalidate({ id });
    },
  });

  const reactivateReminders = trpc.customer.reactivateReminders.useMutation({
    onSuccess: () => {
      void utils.customer.get.invalidate({ id });
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 pb-16">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-32 animate-pulse rounded-2xl border border-border bg-surface-2/40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2/40" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !customer) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-status-bad/30 bg-status-bad-bg p-12 text-center">
        <AlertCircle size={32} className="text-status-bad" />
        <div>
          <h2 className="text-lg font-bold text-status-bad">Client introuvable</h2>
          <p className="mt-1 text-xs text-muted">
            Ce client n&apos;existe pas ou a été supprimé de votre atelier.
          </p>
        </div>
        <LinkButton href="/clients" variant="secondary">
          <ArrowLeft size={15} className="mr-1 inline" />
          Retour aux clients
        </LinkButton>
      </div>
    );
  }

  const vehicles = customer.vehicles ?? [];
  const repairOrders = customer.repairOrders ?? [];
  const quotes = customer.quotes ?? [];
  const invoices = customer.invoices ?? [];

  return (
    <div className="flex flex-col gap-6 pb-20">
      {/* Fil d'Ariane & Navigation retour */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <Link href="/clients" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft size={13} />
          <span>Clients</span>
        </Link>
        <span>/</span>
        <span className="font-semibold text-foreground">{customer.displayName}</span>
      </div>

      {/* En-tête enrichi & Carte d'identité client */}
      <div className="rounded-2xl border border-border/80 bg-surface p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {/* Avatar stylisé */}
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold ${
                customer.type === "COMPANY"
                  ? "bg-accent text-accent-fg shadow-sm"
                  : "bg-surface-2 text-foreground"
              }`}
            >
              {customer.type === "COMPANY" ? (
                <Building2 size={26} strokeWidth={2.2} />
              ) : (
                customer.displayName.slice(0, 2).toUpperCase()
              )}
            </div>

            {/* Identité */}
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {customer.displayName}
                </h1>
                <TypeBadge label={customer.type === "COMPANY" ? "Entreprise" : "Particulier"} />

                {customer.reachability === "OPTED_OUT" && (
                  <StatusBadge tone="bad">Désinscrit (STOP)</StatusBadge>
                )}
                {customer.reachability === "DO_NOT_REMIND" && (
                  <StatusBadge tone="bad">Ne plus relancer</StatusBadge>
                )}
                {customer.reachability === "UNREACHABLE" && (
                  <StatusBadge tone="off">Injoignable</StatusBadge>
                )}
                {customer.reachability === "REACHABLE" && (
                  <StatusBadge tone="ok">Relances actives</StatusBadge>
                )}
              </div>

              {/* Mentions Entreprise : NCC & RCCM */}
              {customer.type === "COMPANY" && (customer.ncc || customer.rccm) && (
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                  {customer.ncc && <span>NCC : <strong className="text-foreground">{customer.ncc}</strong></span>}
                  {customer.ncc && customer.rccm && <span>•</span>}
                  {customer.rccm && <span>RCCM : <strong className="text-foreground">{customer.rccm}</strong></span>}
                </div>
              )}

              {/* Coordonnées & Liens directs d'action */}
              <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs">
                {customer.phone && (
                  <div className="flex items-center gap-2">
                    <a
                      href={`tel:${customer.phone}`}
                      className="inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-accent"
                      title="Appeler"
                    >
                      <Phone size={13} className="text-muted" />
                      <span>{formatPhone(customer.phone)}</span>
                    </a>
                    <a
                      href={`https://wa.me/${customer.phone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-6 items-center gap-1 rounded bg-status-ok-bg px-1.5 text-[11px] font-bold text-status-ok hover:opacity-90"
                      title="Envoyer un message WhatsApp"
                    >
                      <MessageCircle size={12} />
                      <span>WhatsApp</span>
                    </a>
                  </div>
                )}

                {customer.phone2 && (
                  <a
                    href={`tel:${customer.phone2}`}
                    className="inline-flex items-center gap-1 text-muted hover:text-foreground"
                    title="Téléphone secondaire"
                  >
                    <span>Ligne 2 : {formatPhone(customer.phone2)}</span>
                  </a>
                )}

                {customer.email && (
                  <a
                    href={`mailto:${customer.email}`}
                    className="inline-flex items-center gap-1.5 text-muted hover:text-foreground"
                    title="Envoyer un email"
                  >
                    <Mail size={13} />
                    <span>{customer.email}</span>
                  </a>
                )}

                {customer.commune && (
                  <span className="inline-flex items-center gap-1 text-muted">
                    <MapPin size={13} />
                    <span>{customer.commune}</span>
                    {customer.address ? ` (${customer.address})` : ""}
                  </span>
                )}
              </div>

              {/* Tags */}
              {customer.tags && customer.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {customer.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Boutons d'action rapide */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setIsNoteModalOpen(true)}>
              <MessageSquare size={14} className="mr-1 inline" />
              Note
            </Button>
            <LinkButton href={`/vehicules/nouveau?customerId=${id}`} variant="secondary">
              <Car size={14} className="mr-1 inline" />
              + Véhicule
            </LinkButton>
            <LinkButton href={`/rendez-vous/nouveau?customerId=${id}`} variant="secondary">
              <Calendar size={14} className="mr-1 inline" />
              RDV
            </LinkButton>
            <LinkButton href={`/ordres/reception?customerId=${id}`} variant="primary">
              <Wrench size={14} className="mr-1 inline" />
              Nouvel OR
            </LinkButton>
          </div>
        </div>
      </div>

      {/* Cartes KPI synthétiques */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Encours financier */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Solde & Encours</span>
            <Wallet size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">
            {formatAmount(customer.balance.due)}
          </div>
          <div className="mt-1 text-[11px]">
            {customer.balance.overdue > 0 ? (
              <span className="font-semibold text-status-bad">
                dont {formatAmount(customer.balance.overdue)} en retard
              </span>
            ) : (
              <span className="text-status-ok font-medium">À jour des paiements</span>
            )}
          </div>
        </div>

        {/* Modalités de paiement */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Modalités de règlement</span>
            <Clock size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight">
            {customer.paymentTermsDays > 0 ? `${customer.paymentTermsDays} jours` : "Comptant"}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {customer.creditLimit ? `Plafond : ${formatAmount(customer.creditLimit)}` : "Sans plafond"}
          </div>
        </div>

        {/* Parc véhicules */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Véhicules rattachés</span>
            <Car size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-accent">
            {vehicles.length}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {vehicles.length > 0 ? "Véhicule(s) dans le parc" : "Aucun véhicule enregistré"}
          </div>
        </div>

        {/* Activité atelier */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Historique interventions</span>
            <Wrench size={16} className="text-muted" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight">
              {customer.stats.repairedRoCount}
            </span>
            <span className="text-xs text-muted">réparations</span>
          </div>
          <div className="mt-1 text-[11px]">
            {customer.stats.activeRoCount > 0 ? (
              <span className="font-semibold text-status-warn">
                {customer.stats.activeRoCount} OR en atelier en ce moment
              </span>
            ) : (
              <span className="text-muted">Aucune intervention en cours</span>
            )}
          </div>
        </div>
      </div>

      {/* Alertes spécifiques */}
      <CreditAlert customerId={customer.id} />

      {/* Alerte si désinscrit des relances avec bouton de réactivation */}
      {customer.reachability === "OPTED_OUT" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-bad/40 bg-status-bad-bg p-3.5 text-xs text-status-bad">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} />
            <span>
              Ce client s&apos;est désinscrit des relances automatiques (réponse STOP). Aucune relance
              VT ou facture ne lui sera envoyée.
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={reactivateReminders.isPending}
            onClick={() =>
              reactivateReminders.mutate({
                id: customer.id,
                source: "counter",
                proof: "Réactivation explicite au comptoir",
              })
            }
          >
            Réactiver les relances
          </Button>
        </div>
      )}

      {/* Barre des onglets */}
      <div className="border-b border-border/80">
        <div className="-mb-px flex flex-wrap gap-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("vehicles")}
            className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 transition-all ${
              activeTab === "vehicles"
                ? "border-accent text-accent font-bold"
                : "border-transparent text-muted hover:border-border hover:text-foreground"
            }`}
          >
            <Car size={15} />
            <span>Véhicules</span>
            <span className="rounded-full bg-surface-2 px-1.5 py-0.2 text-[10px] text-muted">
              {vehicles.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("repairOrders")}
            className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 transition-all ${
              activeTab === "repairOrders"
                ? "border-accent text-accent font-bold"
                : "border-transparent text-muted hover:border-border hover:text-foreground"
            }`}
          >
            <Wrench size={15} />
            <span>Ordres de réparation</span>
            <span className="rounded-full bg-surface-2 px-1.5 py-0.2 text-[10px] text-muted">
              {repairOrders.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("quotes")}
            className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 transition-all ${
              activeTab === "quotes"
                ? "border-accent text-accent font-bold"
                : "border-transparent text-muted hover:border-border hover:text-foreground"
            }`}
          >
            <FileSignature size={15} />
            <span>Devis</span>
            <span className="rounded-full bg-surface-2 px-1.5 py-0.2 text-[10px] text-muted">
              {quotes.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("invoices")}
            className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 transition-all ${
              activeTab === "invoices"
                ? "border-accent text-accent font-bold"
                : "border-transparent text-muted hover:border-border hover:text-foreground"
            }`}
          >
            <FileText size={15} />
            <span>Facturation & Règlements</span>
            <span className="rounded-full bg-surface-2 px-1.5 py-0.2 text-[10px] text-muted">
              {invoices.length}
            </span>
          </button>

          {customer.type === "COMPANY" && (
            <button
              type="button"
              onClick={() => setActiveTab("contacts")}
              className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 transition-all ${
                activeTab === "contacts"
                  ? "border-accent text-accent font-bold"
                  : "border-transparent text-muted hover:border-border hover:text-foreground"
              }`}
            >
              <Users size={15} />
              <span>Interlocuteurs</span>
              <span className="rounded-full bg-surface-2 px-1.5 py-0.2 text-[10px] text-muted">
                {customer.contacts.length}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab("reminders")}
            className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 transition-all ${
              activeTab === "reminders"
                ? "border-accent text-accent font-bold"
                : "border-transparent text-muted hover:border-border hover:text-foreground"
            }`}
          >
            <Send size={15} />
            <span>Relances & Messagerie</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("timeline")}
            className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 transition-all ${
              activeTab === "timeline"
                ? "border-accent text-accent font-bold"
                : "border-transparent text-muted hover:border-border hover:text-foreground"
            }`}
          >
            <History size={15} />
            <span>Chronologie & Notes</span>
          </button>
        </div>
      </div>

      {/* Contenu de l'onglet Véhicules */}
      {activeTab === "vehicles" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground">Portefeuille de véhicules</h2>
              <p className="text-xs text-muted">
                Véhicules enregistrés, échéances des visites techniques et révisions
              </p>
            </div>
            <LinkButton href={`/vehicules/nouveau?customerId=${id}`} variant="secondary">
              <Plus size={14} className="mr-1 inline" />
              Ajouter un véhicule
            </LinkButton>
          </div>

          {vehicles.length === 0 ? (
            <EmptyState
              title="Aucun véhicule enregistré"
              description="Ce client n'a pas encore de véhicule associé. Ajoutez son premier véhicule pour pouvoir créer des ordres de réparation et programmer des relances."
              action={
                <LinkButton href={`/vehicules/nouveau?customerId=${id}`} variant="primary">
                  Ajouter un véhicule
                </LinkButton>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {vehicles.map((v) => {
                const isVtExpired =
                  v.inspectionExpiryDate && new Date(v.inspectionExpiryDate) < new Date();

                return (
                  <div
                    key={v.id}
                    className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-4 shadow-xs transition-all hover:border-accent/40"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/vehicules/${v.id}`}>
                          <PlateBadge plate={v.plate} plateType={v.plateType} />
                        </Link>
                        <DueBadge
                          status={
                            !v.inspectionExpiryDate
                              ? "UNKNOWN"
                              : isVtExpired
                                ? "EXPIRED"
                                : "OK"
                          }
                        />
                      </div>

                      <div className="mt-3">
                        <Link
                          href={`/vehicules/${v.id}`}
                          className="font-bold text-foreground hover:text-accent hover:underline"
                        >
                          {v.make} {v.model}
                        </Link>
                        {v.vin && (
                          <div className="mt-0.5 text-[11px] font-mono text-muted">
                            VIN : {v.vin}
                          </div>
                        )}
                      </div>

                      <div className="mt-3.5 flex flex-col gap-1.5 border-t border-border/60 pt-3 text-xs">
                        <div className="flex items-center justify-between text-muted">
                          <span className="inline-flex items-center gap-1">
                            <Gauge size={13} />
                            <span>Kilométrage :</span>
                          </span>
                          <span className="font-semibold text-foreground tabular-nums">
                            {v.currentMileage != null
                              ? `${v.currentMileage.toLocaleString("fr-FR")} km`
                              : "Non relevé"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-muted">
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={13} />
                            <span>Visite technique :</span>
                          </span>
                          <span
                            className={`font-semibold tabular-nums ${
                              isVtExpired ? "text-status-bad" : "text-foreground"
                            }`}
                          >
                            {formatDate(v.inspectionExpiryDate)}
                          </span>
                        </div>

                        {v.nextServiceDueDate && (
                          <div className="flex items-center justify-between text-muted">
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock size={13} />
                              <span>Révision due :</span>
                            </span>
                            <span className="font-medium text-foreground tabular-nums">
                              {formatDate(v.nextServiceDueDate)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                      <Link
                        href={`/ordres/reception?customerId=${id}&vehicleId=${v.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                      >
                        <Wrench size={12} />
                        <span>Nouvel OR</span>
                      </Link>
                      <Link
                        href={`/vehicules/${v.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2"
                      >
                        <span>Consulter</span>
                        <ExternalLink size={11} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Contenu de l'onglet Ordres de Réparation */}
      {activeTab === "repairOrders" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground">Ordres de réparation</h2>
              <p className="text-xs text-muted">Historique des interventions sur les véhicules du client</p>
            </div>
            <LinkButton href={`/ordres/reception?customerId=${id}`} variant="primary">
              <Plus size={14} className="mr-1 inline" />
              Nouvel OR
            </LinkButton>
          </div>

          {repairOrders.length === 0 ? (
            <EmptyState
              title="Aucun ordre de réparation"
              description="Ce client n'a pas encore fait réparer de véhicule dans votre atelier."
              action={
                <LinkButton href={`/ordres/reception?customerId=${id}`} variant="primary">
                  Créer un ordre de réparation
                </LinkButton>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase text-muted">
                  <tr>
                    <th className="py-3 pl-4 pr-3">N° OR</th>
                    <th className="px-3 py-3">Véhicule</th>
                    <th className="px-3 py-3">Statut</th>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3 text-right">Montant TTC</th>
                    <th className="py-3 pl-3 pr-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {repairOrders.map((ro) => {
                    const statusMeta = RO_STATUS_LABELS[ro.status] ?? {
                      label: ro.status,
                      tone: "off" as StatusTone,
                    };

                    return (
                      <tr key={ro.id} className="hover:bg-surface-2/40">
                        <td className="py-3 pl-4 pr-3 font-semibold">
                          <Link href={`/ordres/${ro.id}`} className="hover:text-accent hover:underline">
                            {ro.number ?? "Brouillon"}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-xs">
                          {ro.vehicle ? (
                            <div className="flex items-center gap-1.5">
                              <PlateBadge
                                plate={ro.vehicle.plate}
                                plateType={ro.vehicle.plateType}
                                className="scale-90 origin-left"
                              />
                              <span className="text-muted">{ro.vehicle.make} {ro.vehicle.model}</span>
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted">
                          {formatDate(ro.createdAt)}
                        </td>
                        <td className="px-3 py-3 text-right font-medium">
                          {formatAmount(ro.totalEstimate)}
                        </td>
                        <td className="py-3 pl-3 pr-4 text-right">
                          <Link
                            href={`/ordres/${ro.id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2"
                          >
                            <span>Ouvrir</span>
                            <ExternalLink size={11} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Contenu de l'onglet Devis */}
      {activeTab === "quotes" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground">Devis</h2>
              <p className="text-xs text-muted">Propositions tarifaires et estimations de réparations</p>
            </div>
            <LinkButton href={`/devis/nouveau?customerId=${id}`} variant="primary">
              <Plus size={14} className="mr-1 inline" />
              Nouveau devis
            </LinkButton>
          </div>

          {quotes.length === 0 ? (
            <EmptyState
              title="Aucun devis émis"
              description="Aucun devis n'a encore été créé pour ce client."
              action={
                <LinkButton href={`/devis/nouveau?customerId=${id}`} variant="primary">
                  Créer un devis
                </LinkButton>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase text-muted">
                  <tr>
                    <th className="py-3 pl-4 pr-3">N° Devis</th>
                    <th className="px-3 py-3">Véhicule</th>
                    <th className="px-3 py-3">Statut</th>
                    <th className="px-3 py-3">Validité</th>
                    <th className="px-3 py-3 text-right">Total TTC</th>
                    <th className="py-3 pl-3 pr-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {quotes.map((q) => {
                    const statusMeta = QUOTE_STATUS_LABELS[q.status] ?? {
                      label: q.status,
                      tone: "off" as StatusTone,
                    };

                    return (
                      <tr key={q.id} className="hover:bg-surface-2/40">
                        <td className="py-3 pl-4 pr-3 font-semibold">
                          <Link href={`/devis/${q.id}`} className="hover:text-accent hover:underline">
                            {q.number ?? "Brouillon"}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-xs">
                          {q.vehicle ? (
                            <span>{q.vehicle.plate} • {q.vehicle.make} {q.vehicle.model}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted">
                          {formatDate(q.validUntil)}
                        </td>
                        <td className="px-3 py-3 text-right font-medium">
                          {formatAmount(q.total)}
                        </td>
                        <td className="py-3 pl-3 pr-4 text-right">
                          <Link
                            href={`/devis/${q.id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2"
                          >
                            <span>Voir</span>
                            <ExternalLink size={11} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Contenu de l'onglet Facturation */}
      {activeTab === "invoices" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground">Facturation & Règlements</h2>
              <p className="text-xs text-muted">Factures émises, acomptes et solde des créances</p>
            </div>
            <LinkButton href={`/factures/nouvelle?customerId=${id}`} variant="primary">
              <Plus size={14} className="mr-1 inline" />
              Nouvelle facture
            </LinkButton>
          </div>

          {invoices.length === 0 ? (
            <EmptyState
              title="Aucune facture émise"
              description="Aucune facture n'a encore été générée pour ce client."
              action={
                <LinkButton href={`/factures/nouvelle?customerId=${id}`} variant="primary">
                  Créer une facture
                </LinkButton>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase text-muted">
                  <tr>
                    <th className="py-3 pl-4 pr-3">N° Facture</th>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3">Échéance</th>
                    <th className="px-3 py-3">Statut</th>
                    <th className="px-3 py-3 text-right">Montant TTC</th>
                    <th className="px-3 py-3 text-right">Reste dû</th>
                    <th className="py-3 pl-3 pr-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {invoices.map((inv) => {
                    const statusMeta = INVOICE_STATUS_LABELS[inv.status] ?? {
                      label: inv.status,
                      tone: "off" as StatusTone,
                    };

                    return (
                      <tr key={inv.id} className="hover:bg-surface-2/40">
                        <td className="py-3 pl-4 pr-3 font-semibold">
                          <Link href={`/factures/${inv.id}`} className="hover:text-accent hover:underline">
                            {inv.number ?? "Brouillon"}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted">
                          {formatDate(inv.issuedAt ?? inv.createdAt)}
                        </td>
                        <td className="px-3 py-3 text-xs text-muted">
                          {formatDate(inv.dueDate)}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                        </td>
                        <td className="px-3 py-3 text-right font-medium">
                          {formatAmount(inv.total)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {inv.balance > 0 ? (
                            <span className="font-bold text-status-bad">
                              {formatAmount(inv.balance)}
                            </span>
                          ) : (
                            <span className="text-xs text-status-ok font-medium">Réglée</span>
                          )}
                        </td>
                        <td className="py-3 pl-3 pr-4 text-right">
                          <Link
                            href={`/factures/${inv.id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2"
                          >
                            <span>Voir</span>
                            <ExternalLink size={11} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Contenu de l'onglet Interlocuteurs (pour entreprises) */}
      {activeTab === "contacts" && customer.type === "COMPANY" && (
        <ContactsSection customerId={id} />
      )}

      {/* Contenu de l'onglet Relances */}
      {activeTab === "reminders" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-base font-bold text-foreground">Relances & Notifications</h2>
            <p className="mt-1 text-xs text-muted">
              Canal de communication favori :{" "}
              <strong className="text-foreground">
                {customer.preferredChannel ?? "Par défaut (WhatsApp puis SMS)"}
              </strong>
            </p>
          </div>
          <ReminderMiniBlock customerId={id} />
        </div>
      )}

      {/* Contenu de l'onglet Chronologie & Notes */}
      {activeTab === "timeline" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground">Chronologie & Notes</h2>
              <p className="text-xs text-muted">Historique des interactions, notes internes et relances</p>
            </div>
            <Button variant="primary" onClick={() => setIsNoteModalOpen(true)}>
              <Plus size={14} className="mr-1 inline" />
              Ajouter une note
            </Button>
          </div>

          {!timeline || timeline.items.length === 0 ? (
            <EmptyState
              title="Pas encore d'historique"
              description="Les notes, relances et relevés de compteurs apparaîtront ici."
              action={
                <Button variant="secondary" onClick={() => setIsNoteModalOpen(true)}>
                  Ajouter la première note
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {timeline.items.map((item, index) => {
                const date = new Date(item.at);
                const isNote = item.type === "note";
                const isReminder = item.type === "reminder";
                const isMileage = item.type === "mileage_reading";

                return (
                  <div
                    key={index}
                    className="flex items-start gap-3 rounded-xl border border-border/80 bg-surface p-3.5 shadow-xs"
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                        isNote
                          ? "bg-accent/15 text-accent"
                          : isReminder
                            ? "bg-surface-2 text-foreground"
                            : "bg-surface-2 text-muted"
                      }`}
                    >
                      {isNote && <MessageSquare size={14} />}
                      {isReminder && <Send size={14} />}
                      {isMileage && <Gauge size={14} />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold capitalize text-foreground">
                          {isNote ? "Note interne" : isReminder ? "Relance envoyée" : "Relevé kilométrique"}
                        </span>
                        <span className="text-[11px] text-muted">
                          {date.toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>

                      {isNote && typeof item.data === "object" && item.data !== null && "body" in item.data && (
                        <p className="mt-1 text-xs text-foreground whitespace-pre-wrap">
                          {String(item.data.body)}
                        </p>
                      )}

                      {isReminder && typeof item.data === "object" && item.data !== null && "type" in item.data && (
                        <p className="mt-1 text-xs text-muted">
                          Type : <strong>{String(item.data.type)}</strong> • Statut :{" "}
                          <span>{String("status" in item.data ? item.data.status : "—")}</span>
                        </p>
                      )}

                      {isMileage && typeof item.data === "object" && item.data !== null && "mileage" in item.data && (
                        <p className="mt-1 text-xs text-muted">
                          Relevé à : <strong>{Number(item.data.mileage).toLocaleString("fr-FR")} km</strong>
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal d'ajout de note */}
      <Modal
        open={isNoteModalOpen}
        title="Ajouter une note interne"
        onClose={() => setIsNoteModalOpen(false)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!noteBody.trim()) return;
            addNote.mutate({
              customerId: id,
              body: noteBody.trim(),
              pinned: notePinned,
            });
          }}
          className="stack"
        >
          <Field label="Texte de la note">
            <Textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Remarques particulières, préférences du client, suivi..."
              rows={4}
              required
            />
          </Field>

          <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={notePinned}
              onChange={(e) => setNotePinned(e.target.checked)}
              className="rounded border-border text-accent focus:ring-accent"
            />
            <span>Épingler cette note en haut de la fiche</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsNoteModalOpen(false)}
            >
              Annuler
            </Button>
            <Button type="submit" variant="primary" loading={addNote.isPending}>
              Enregistrer la note
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
