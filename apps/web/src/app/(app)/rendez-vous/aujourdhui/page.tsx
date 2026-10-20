"use client";

// §7 `/(app)/rendez-vous/aujourdhui` — Accueil du jour moderne & intelligent pour l'atelier :
// - En-tête KPI interactif avec 6 cartes cliquables filtrantes (Total, Confirmés, À confirmer, Arrivés, En retard, Confirmations demain).
// - Sélecteur de date fluide (Hier, Aujourd'hui, Demain, flèches précédent/suivant, datepicker libre).
// - Recherche instantanée multi-champs (client, plaque, tél, véhicule) + filtres de statut et bouton Reset.
// - Cartes RDV complètes avec créneau horaire, PlateBadge officiel, TypeDot, actions directes :
//   « Client arrivé » (déclenche OR de réception), « Appeler » (tel:), « WhatsApp » direct (wa.me), Fiche RDV.
// - Section modernisée des confirmations téléphoniques de demain avec motifs d'appel.
// - Empty states soignés et intelligents avec actions rapides.
import { useCallback, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  FilterX,
  LogIn,
  MessageCircle,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  UserCheck,
  X,
} from "lucide-react";
import { addDaysToKey, formatDayFr, localDateKey } from "@atelieros/core/planning";
import { Button, EmptyState, PlateBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { AppointmentPanel } from "../appointment-panel";
import {
  SOURCE_ICONS,
  StatusLabel,
  TypeDot,
  errorInfo,
  fmtTime,
  ta,
  type AppointmentSource,
  type AppointmentStatus,
  type AppointmentType,
} from "../labels";
import type { PlanningAppointment } from "../types";
import { ErrorBox, SidePanel, Toast, type ToastState } from "../ui-bits";

type KpiFilter = "ALL" | "CONFIRMED" | "BOOKED" | "ARRIVED" | "LATE" | "PHONE_CONFIRMATIONS";

function waLink(phone: string | null | undefined, text?: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const enc = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${enc}`;
}

export default function TodayPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const searchInputId = useId();
  const dateInputId = useId();

  const me = trpc.me.get.useQuery();
  const permissions = useMemo(() => new Set<string>(me.data?.permissions ?? []), [me.data]);
  const tz = me.data?.activeOrganization?.timezone ?? "Africa/Abidjan";
  const realTodayKey = useMemo(() => localDateKey(new Date(), tz), [tz]);

  // Sélecteur de date
  const [selectedDate, setSelectedDate] = useState<string>(() => localDateKey(new Date(), "Africa/Abidjan"));
  const today = trpc.appointment.today.useQuery({ date: selectedDate });

  // Recherche & Filtres interactifs
  const [search, setSearch] = useState("");
  const [activeKpi, setActiveKpi] = useState<KpiFilter>("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback(
    (message: string, tone: "ok" | "bad" = "ok") => setToast({ message, tone }),
    [],
  );
  const onError = (e: Parameters<typeof errorInfo>[0]) =>
    showToast(errorInfo(e)?.message ?? ta("errors.generic"), "bad");
  const refresh = () => utils.appointment.invalidate();

  const arrived = trpc.appointment.markArrived.useMutation({
    onSuccess(result) {
      refresh();
      if (result.receptionUrl) router.push(result.receptionUrl);
    },
    onError,
  });

  const confirm = trpc.appointment.confirm.useMutation({
    onSuccess: () => {
      refresh();
      showToast(ta("panel.confirmed"));
    },
    onError,
  });

  const noShow = trpc.appointment.markNoShow.useMutation({ onSuccess: refresh, onError });
  const canUpdate = permissions.has("appointment:update");

  const d = today.data;
  const activeTz = d?.timeZone ?? tz;

  // Calcul des dates relatives
  const yesterdayKey = useMemo(() => addDaysToKey(realTodayKey, -1), [realTodayKey]);
  const tomorrowKey = useMemo(() => addDaysToKey(realTodayKey, 1), [realTodayKey]);
  const isViewingToday = selectedDate === realTodayKey;

  // Liste consolidée de tous les RDV de la journée (sans les annulés)
  const allAppointments = useMemo(() => {
    if (!d) return [];
    const seen = new Set<string>();
    const list: PlanningAppointment[] = [];
    const pushAll = (items: PlanningAppointment[]) => {
      for (const item of items) {
        if (!seen.has(item.id) && item.status !== "CANCELLED") {
          seen.add(item.id);
          list.push(item);
        }
      }
    };
    pushAll(d.late);
    pushAll(d.upcoming);
    pushAll(d.arrived);
    pushAll(d.noShow);
    return list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [d]);

  // Filtrage combiné : recherche multi-champs + filtre KPI
  const filteredAppointments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allAppointments.filter((a) => {
      // 1. Filtre KPI
      if (activeKpi === "CONFIRMED" && a.status !== "CONFIRMED") return false;
      if (activeKpi === "BOOKED" && a.status !== "BOOKED") return false;
      if (activeKpi === "ARRIVED" && a.status !== "ARRIVED" && a.status !== "COMPLETED") return false;
      if (activeKpi === "LATE" && !a.flags.late) return false;
      if (activeKpi === "PHONE_CONFIRMATIONS") return false; // affiché dans sa section dédiée

      // 2. Recherche multi-champs (client, plaque, tel, véhicule, type)
      if (!q) return true;
      const client = a.customer.displayName.toLowerCase();
      const phone = (a.customer.phone ?? "").toLowerCase();
      const plate = (a.vehicle?.plate ?? "").toLowerCase();
      const make = (a.vehicle?.make ?? "").toLowerCase();
      const model = (a.vehicle?.model ?? "").toLowerCase();
      const typeLabel = ta(`types.${a.type as AppointmentType}`).toLowerCase();
      const bay = (a.bay?.name ?? "").toLowerCase();

      return (
        client.includes(q) ||
        phone.includes(q) ||
        plate.includes(q) ||
        make.includes(q) ||
        model.includes(q) ||
        typeLabel.includes(q) ||
        bay.includes(q)
      );
    });
  }, [allAppointments, search, activeKpi]);

  // Filtrage des confirmations téléphoniques
  const filteredPhoneConfirmations = useMemo(() => {
    if (!d) return [];
    if (activeKpi !== "ALL" && activeKpi !== "PHONE_CONFIRMATIONS") return [];
    const q = search.trim().toLowerCase();
    if (!q) return d.phoneConfirmations;
    return d.phoneConfirmations.filter((a) => {
      const client = a.customer.displayName.toLowerCase();
      const phone = (a.customer.phone ?? "").toLowerCase();
      const plate = (a.vehicle?.plate ?? "").toLowerCase();
      return client.includes(q) || phone.includes(q) || plate.includes(q);
    });
  }, [d, activeKpi, search]);

  const hasFilterActive = Boolean(search.trim() || activeKpi !== "ALL");
  const resetFilters = () => {
    setSearch("");
    setActiveKpi("ALL");
  };

  const actions: ActionHandlers = {
    canUpdate,
    onArrived: (id) => arrived.mutate({ id }),
    onConfirm: (id) => confirm.mutate({ id, via: "phone" }),
    onNoShow: (id) => noShow.mutate({ id }),
    onSelect: setSelected,
    tz: activeTz,
  };

  // Groupes selon statut pour affichage naturel quand filtre = "ALL"
  const lateItems = useMemo(
    () => filteredAppointments.filter((a) => a.flags.late),
    [filteredAppointments],
  );
  const upcomingItems = useMemo(
    () =>
      filteredAppointments.filter(
        (a) => (a.status === "BOOKED" || a.status === "CONFIRMED") && !a.flags.late,
      ),
    [filteredAppointments],
  );
  const arrivedItems = useMemo(
    () => filteredAppointments.filter((a) => a.status === "ARRIVED" || a.status === "COMPLETED"),
    [filteredAppointments],
  );
  const noShowItems = useMemo(
    () => filteredAppointments.filter((a) => a.status === "NO_SHOW"),
    [filteredAppointments],
  );

  return (
    <div className="flex min-w-0 flex-col gap-5 pb-16">
      {/* ── En-tête : Titre, actions rapides, sélecteur de date ── */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {ta("todayPage.title")}
            </h1>
            <p className="mt-0.5 text-xs text-muted sm:text-sm">
              {formatDayFr(new Date(`${selectedDate}T12:00:00Z`), activeTz)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/rendez-vous/nouveau"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-semibold text-accent-foreground shadow-xs transition-opacity hover:opacity-90"
            >
              <Plus size={16} aria-hidden />
              <span>{ta("todayPage.newAppointment")}</span>
            </Link>
            <Link
              href="/rendez-vous"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <CalendarIcon size={15} className="text-muted" aria-hidden />
              <span>{ta("todayPage.openPlanning")}</span>
            </Link>
          </div>
        </div>

        {/* ── Barre de navigation temporelle fluide ── */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-border/70 bg-surface p-2 shadow-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSelectedDate((prev) => addDaysToKey(prev, -1))}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/80 bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label={ta("todayPage.previousDay")}
            >
              <ArrowLeft size={16} />
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedDate(yesterdayKey)}
                className={`min-h-10 rounded-xl px-3 text-xs font-medium transition-all ${
                  selectedDate === yesterdayKey
                    ? "bg-accent text-accent-foreground shadow-xs"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {ta("todayPage.yesterday")}
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(realTodayKey)}
                className={`min-h-10 rounded-xl px-3 text-xs font-medium transition-all ${
                  isViewingToday
                    ? "bg-accent text-accent-foreground shadow-xs"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {ta("todayPage.today")}
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(tomorrowKey)}
                className={`min-h-10 rounded-xl px-3 text-xs font-medium transition-all ${
                  selectedDate === tomorrowKey
                    ? "bg-accent text-accent-foreground shadow-xs"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {ta("todayPage.tomorrow")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDate((prev) => addDaysToKey(prev, 1))}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/80 bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label={ta("todayPage.nextDay")}
            >
              <ArrowRight size={16} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor={dateInputId} className="sr-only">
              {ta("todayPage.pickDate")}
            </label>
            <input
              id={dateInputId}
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="min-h-10 rounded-xl border border-border bg-surface px-3 py-1.5 font-mono text-xs text-foreground shadow-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => today.refetch()}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="Rafraîchir"
              title="Rafraîchir"
            >
              <RefreshCw size={15} className={today.isFetching ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* ── KPIs interactifs & cliquables ── */}
      {d && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            title={ta("todayPage.kpis.total")}
            count={d.counts.total}
            icon={CalendarIcon}
            active={activeKpi === "ALL"}
            onClick={() => setActiveKpi("ALL")}
            colorClass="text-accent"
          />
          <KpiCard
            title={ta("todayPage.kpis.confirmed")}
            count={d.counts.confirmed}
            icon={UserCheck}
            active={activeKpi === "CONFIRMED"}
            onClick={() => setActiveKpi(activeKpi === "CONFIRMED" ? "ALL" : "CONFIRMED")}
            colorClass="text-status-ok"
          />
          <KpiCard
            title={ta("todayPage.kpis.unanswered")}
            count={d.counts.unanswered}
            icon={Clock}
            active={activeKpi === "BOOKED"}
            onClick={() => setActiveKpi(activeKpi === "BOOKED" ? "ALL" : "BOOKED")}
            colorClass="text-amber-500"
          />
          <KpiCard
            title={ta("todayPage.kpis.arrived")}
            count={d.counts.arrived}
            icon={CheckCircle2}
            active={activeKpi === "ARRIVED"}
            onClick={() => setActiveKpi(activeKpi === "ARRIVED" ? "ALL" : "ARRIVED")}
            colorClass="text-blue-500"
          />
          <KpiCard
            title={ta("todayPage.kpis.late")}
            count={d.late.length}
            icon={AlertTriangle}
            active={activeKpi === "LATE"}
            onClick={() => setActiveKpi(activeKpi === "LATE" ? "ALL" : "LATE")}
            colorClass="text-status-bad"
            pulse={d.late.length > 0}
          />
          <KpiCard
            title={ta("todayPage.kpis.phoneConfirmations")}
            count={d.phoneConfirmations.length}
            icon={PhoneCall}
            active={activeKpi === "PHONE_CONFIRMATIONS"}
            onClick={() =>
              setActiveKpi(activeKpi === "PHONE_CONFIRMATIONS" ? "ALL" : "PHONE_CONFIRMATIONS")
            }
            colorClass="text-purple-500"
          />
        </div>
      )}

      {/* ── Barre de recherche multi-champs + filtres rapides ── */}
      <div className="flex flex-col gap-2 rounded-2xl border border-border/80 bg-surface p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <label htmlFor={searchInputId} className="sr-only">
              {ta("todayPage.searchPlaceholder")}
            </label>
            <input
              id={searchInputId}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={ta("todayPage.searchPlaceholder")}
              className="min-h-11 w-full rounded-xl border border-border bg-surface-2/40 pl-10 pr-9 text-xs text-foreground placeholder:text-muted focus:border-accent focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent sm:text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label={ta("todayPage.clearSearch")}
              >
                <X size={15} />
              </button>
            )}
          </div>

          {hasFilterActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="min-h-11 gap-1 text-xs text-muted hover:text-foreground"
            >
              <FilterX size={14} />
              <span>{ta("todayPage.resetFilters")}</span>
            </Button>
          )}
        </div>

        {/* Badges de filtres actifs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <FilterChip
            label={ta("todayPage.filterAll", { count: allAppointments.length })}
            active={activeKpi === "ALL"}
            onClick={() => setActiveKpi("ALL")}
          />
          {d && d.late.length > 0 && (
            <FilterChip
              label={ta("todayPage.filterLateCount", { count: d.late.length })}
              active={activeKpi === "LATE"}
              onClick={() => setActiveKpi(activeKpi === "LATE" ? "ALL" : "LATE")}
              tone="bad"
            />
          )}
          {d && (
            <>
              <FilterChip
                label={ta("todayPage.filterConfirmedCount", { count: d.counts.confirmed })}
                active={activeKpi === "CONFIRMED"}
                onClick={() => setActiveKpi(activeKpi === "CONFIRMED" ? "ALL" : "CONFIRMED")}
              />
              <FilterChip
                label={ta("todayPage.filterBookedCount", { count: d.counts.unanswered })}
                active={activeKpi === "BOOKED"}
                onClick={() => setActiveKpi(activeKpi === "BOOKED" ? "ALL" : "BOOKED")}
              />
              <FilterChip
                label={ta("todayPage.filterArrivedCount", { count: d.counts.arrived })}
                active={activeKpi === "ARRIVED"}
                onClick={() => setActiveKpi(activeKpi === "ARRIVED" ? "ALL" : "ARRIVED")}
              />
            </>
          )}
        </div>
      </div>

      {/* Résumé textuel requis par tests (data-testid="today-summary") */}
      {d && (
        <p className="sr-only" data-testid="today-summary">
          {ta("todayPage.summary", {
            total: d.counts.total,
            confirmed: d.counts.confirmed,
            unanswered: d.counts.unanswered,
          })}
        </p>
      )}

      {/* ── États de chargement & erreur ── */}
      {today.isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-28 rounded-2xl" />
          ))}
        </div>
      )}
      {today.isError && <ErrorBox message={ta("loadError")} onRetry={() => today.refetch()} />}

      {/* ── Contenu principal : Sections & Cartes RDV modernisées ── */}
      {d && (
        <>
          {allAppointments.length === 0 && d.phoneConfirmations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-8">
              <EmptyState
                title={ta("todayPage.empty")}
                description={ta("todayPage.emptyDescription")}
                action={
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                    <Link
                      href="/rendez-vous/nouveau"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-semibold text-accent-foreground"
                    >
                      <Plus size={16} />
                      <span>{ta("todayPage.newAppointment")}</span>
                    </Link>
                    <Link
                      href="/rendez-vous"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-4 text-xs font-medium text-foreground hover:bg-surface-2"
                    >
                      <span>{ta("todayPage.openPlanning")}</span>
                    </Link>
                  </div>
                }
              />
            </div>
          ) : filteredAppointments.length === 0 && activeKpi !== "PHONE_CONFIRMATIONS" ? (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-xs">
              <p className="text-sm font-semibold text-foreground">{ta("todayPage.emptyFiltered")}</p>
              <p className="mt-1 text-xs text-muted">{ta("todayPage.emptyFilteredHint")}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={resetFilters}
                className="mt-4 min-h-11"
              >
                {ta("todayPage.resetFilters")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Si filtre KPI spécifique actif (sauf PHONE_CONFIRMATIONS) : affichage plat direct */}
              {activeKpi !== "ALL" && activeKpi !== "PHONE_CONFIRMATIONS" ? (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
                      {ta(`todayPage.kpis.${activeKpi.toLowerCase()}`)} ({filteredAppointments.length})
                    </h2>
                    <span className="text-xs text-muted">
                      {ta("todayPage.searchResultsCount", { count: filteredAppointments.length })}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {filteredAppointments.map((a) => (
                      <AppointmentCard key={a.id} a={a} actions={actions} />
                    ))}
                  </div>
                </div>
              ) : (
                /* Mode Vue globale structurée */
                <>
                  {lateItems.length > 0 && (
                    <AppointmentSection
                      title={ta("todayPage.late")}
                      items={lateItems}
                      tone="bad"
                      actions={actions}
                    />
                  )}

                  {upcomingItems.length > 0 && (
                    <AppointmentSection
                      title={ta("todayPage.upcoming")}
                      items={upcomingItems}
                      actions={actions}
                    />
                  )}

                  {arrivedItems.length > 0 && (
                    <AppointmentSection
                      title={ta("todayPage.arrived")}
                      items={arrivedItems}
                      actions={actions}
                    />
                  )}

                  {noShowItems.length > 0 && (
                    <AppointmentSection
                      title={ta("todayPage.noShow")}
                      items={noShowItems}
                      actions={actions}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Section Confirmations téléphoniques de demain ── */}
          {(activeKpi === "ALL" || activeKpi === "PHONE_CONFIRMATIONS") && (
            <section
              className={`flex flex-col gap-3 rounded-2xl border p-4 shadow-xs transition-all ${
                filteredPhoneConfirmations.length > 0
                  ? "border-purple-500/40 bg-purple-500/5"
                  : "border-border bg-surface"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/15 text-purple-600">
                    <PhoneCall size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-foreground">
                        {ta("todayPage.phoneConfirmationsTitle")}
                      </h2>
                      <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                        {filteredPhoneConfirmations.length}
                      </span>
                    </div>
                    <p className="text-xs text-muted">
                      {ta("todayPage.phoneConfirmationsHint")}
                    </p>
                  </div>
                </div>
              </div>

              {filteredPhoneConfirmations.length === 0 ? (
                <p className="py-2 text-xs text-muted">{ta("todayPage.nothing")}</p>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {filteredPhoneConfirmations.map((a) => (
                    <PhoneConfirmationCard key={a.id} a={a} actions={actions} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ── Tiroir latéral détails RDV ── */}
      <SidePanel open={!!selected} title={ta("panel.title")} onClose={() => setSelected(null)}>
        {selected && (
          <AppointmentPanel
            id={selected}
            permissions={permissions}
            onToast={showToast}
            onChanged={() => today.refetch()}
          />
        )}
      </SidePanel>

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

// ── Interfaces & Composants internes ──

interface ActionHandlers {
  canUpdate: boolean;
  onArrived: (id: string) => void;
  onConfirm: (id: string) => void;
  onNoShow: (id: string) => void;
  onSelect: (id: string) => void;
  tz: string;
}

function KpiCard({
  title,
  count,
  icon: Icon,
  active,
  onClick,
  colorClass,
  pulse,
}: {
  title: string;
  count: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  onClick: () => void;
  colorClass: string;
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-h-20 flex-col justify-between rounded-2xl border p-3.5 text-left transition-all ${
        active
          ? "border-accent bg-accent/10 shadow-xs ring-2 ring-accent/30"
          : "border-border/70 bg-surface hover:border-accent/40 hover:bg-surface-2"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted group-hover:text-foreground">
          {title}
        </span>
        <Icon size={16} className={colorClass} />
      </div>
      <div className="flex items-baseline gap-1.5 pt-1">
        <span className={`text-2xl font-bold tracking-tight ${colorClass}`}>
          {count}
        </span>
        {pulse && count > 0 && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-bad opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-status-bad" />
          </span>
        )}
      </div>
    </button>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  tone = "default",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "default" | "bad";
}) {
  const isBad = tone === "bad";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-xl px-3 text-xs font-semibold transition-all ${
        active
          ? isBad
            ? "bg-status-bad text-white shadow-xs"
            : "bg-foreground text-background shadow-xs"
          : isBad
            ? "border border-status-bad/40 bg-status-bad-bg text-status-bad hover:bg-status-bad/15"
            : "border border-border/80 bg-surface-2/60 text-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function AppointmentSection({
  title,
  items,
  tone,
  actions,
}: {
  title: string;
  items: PlanningAppointment[];
  tone?: "bad";
  actions: ActionHandlers;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h2
          className={`text-sm font-bold uppercase tracking-wider ${
            tone === "bad" ? "text-status-bad" : "text-muted"
          }`}
        >
          {title}
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            tone === "bad"
              ? "bg-status-bad-bg text-status-bad border border-status-bad/30"
              : "bg-surface-2 text-muted"
          }`}
        >
          {items.length}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2.5">
        {items.map((a) => (
          <AppointmentCard key={a.id} a={a} actions={actions} />
        ))}
      </div>
    </section>
  );
}

/** Carte de rendez-vous moderne et tactile */
function AppointmentCard({ a, actions }: { a: PlanningAppointment; actions: ActionHandlers }) {
  const { tz, onSelect, canUpdate, onArrived, onConfirm, onNoShow } = actions;
  const isLate = a.flags.late;
  const pending = a.status === "BOOKED" || a.status === "CONFIRMED";
  const SourceIconComponent = SOURCE_ICONS[a.source as AppointmentSource];

  const formattedDate = formatDayFr(new Date(a.startsAt), tz);
  const formattedTime = fmtTime(a.startsAt, tz);
  const waMessage = ta("todayPage.whatsappMsg", {
    name: a.customer.displayName,
    type: ta(`types.${a.type as AppointmentType}`),
    date: formattedDate,
    time: formattedTime,
  });

  return (
    <div
      data-testid="appt-row"
      data-appointment-id={a.id}
      className={`group relative flex flex-col gap-3 rounded-2xl border p-4 shadow-xs transition-all hover:shadow-sm ${
        isLate
          ? "border-status-bad/40 bg-status-bad-bg/15 hover:border-status-bad"
          : "border-border/80 bg-surface hover:border-accent/40"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        {/* Créneau horaire bien visible + statut + source */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSelect(a.id)}
            className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold text-foreground hover:bg-surface-3"
          >
            <Clock size={13} className="text-muted" />
            <span>
              {fmtTime(a.startsAt, tz)} – {fmtTime(a.endsAt, tz)}
            </span>
          </button>
          <StatusLabel status={a.status as AppointmentStatus} />
          {SourceIconComponent && (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 text-muted"
              title={ta(`sources.${a.source as AppointmentSource}`)}
            >
              <SourceIconComponent size={13} />
            </span>
          )}
          {isLate && (
            <span className="rounded-md border border-status-bad/40 bg-status-bad text-[10px] font-bold text-white px-2 py-0.5">
              ⚠ {ta("todayPage.badgeLate")}
            </span>
          )}
          {a.flags.noShowCount >= 2 && (
            <span className="pill pill-bad">
              {ta("badges.noShows", { count: a.flags.noShowCount })}
            </span>
          )}
        </div>

        {/* Emplacement pont / baie */}
        <span className="text-xs font-medium text-muted">
          {a.bay?.name ? ta("todayPage.bay", { bay: a.bay.name }) : ta("todayPage.unassignedBay")}
        </span>
      </div>

      {/* Données client & véhicule */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(a.id)}
              className="text-base font-bold text-foreground hover:text-accent text-left"
            >
              {a.customer.displayName}
            </button>
            <TypeDot type={a.type as AppointmentType} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {a.vehicle ? (
              <div className="flex items-center gap-1.5">
                <PlateBadge plate={a.vehicle.plate} />
                <span className="font-medium text-foreground">
                  {a.vehicle.make} {a.vehicle.model}
                </span>
              </div>
            ) : null}
            {a.customer.phone && (
              <span className="font-mono text-[11px] text-muted">· {a.customer.phone}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Actions directes tactiles (>= 44px) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* « Client arrivé » déclenche la réception OR */}
          {pending && canUpdate && (
            <Button
              size="sm"
              onClick={() => onArrived(a.id)}
              className="min-h-11 gap-1.5 font-bold shadow-xs"
            >
              <LogIn size={15} />
              <span>{ta("todayPage.clientArrived")}</span>
            </Button>
          )}

          {a.status === "BOOKED" && canUpdate && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onConfirm(a.id)}
              className="min-h-11 gap-1.5"
            >
              <UserCheck size={14} />
              <span>{ta("todayPage.confirmPhone")}</span>
            </Button>
          )}

          {pending && canUpdate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onNoShow(a.id)}
              className="min-h-11 text-xs text-muted hover:text-status-bad"
            >
              {ta("todayPage.markNoShow")}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Bouton Appeler tel: */}
          {a.customer.phone && (
            <a
              href={`tel:${a.customer.phone}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-foreground transition-colors hover:bg-surface-2"
              title={ta("todayPage.callCustomer")}
            >
              <Phone size={14} className="text-muted" />
              <span>{ta("todayPage.call")}</span>
            </a>
          )}

          {/* Bouton WhatsApp direct wa.me */}
          {a.customer.phone && (
            <a
              href={waLink(a.customer.phone, waMessage)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-green-500/30 bg-green-500/10 px-3 text-xs font-semibold text-green-700 transition-colors hover:bg-green-500/20"
              title={ta("todayPage.openWhatsApp")}
            >
              <MessageCircle size={14} />
              <span>{ta("todayPage.quickWhatsApp")}</span>
            </a>
          )}

          {/* Voir Fiche RDV */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSelect(a.id)}
            className="min-h-11 text-xs text-muted hover:text-foreground"
          >
            {ta("todayPage.viewFile")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Carte spécifique pour la section des confirmations téléphoniques de demain */
function PhoneConfirmationCard({
  a,
  actions,
}: {
  a: PlanningAppointment;
  actions: ActionHandlers;
}) {
  const { tz, onSelect, canUpdate, onConfirm, onNoShow } = actions;
  const reasonText = a.flags.noChannel
    ? ta("todayPage.reasonNoChannel")
    : a.flags.mandatoryConfirmation
      ? ta("todayPage.reasonNoShows")
      : ta("todayPage.reasonAfterSix");

  const formattedDate = formatDayFr(new Date(a.startsAt), tz);
  const formattedTime = fmtTime(a.startsAt, tz);
  const waMessage = ta("todayPage.whatsappMsg", {
    name: a.customer.displayName,
    type: ta(`types.${a.type as AppointmentType}`),
    date: formattedDate,
    time: formattedTime,
  });

  return (
    <div
      data-testid="phone-conf-row"
      className="flex flex-col gap-3 rounded-2xl border border-purple-500/30 bg-surface p-3.5 shadow-xs transition-all hover:border-purple-500/60"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold text-foreground">
            <Clock size={13} className="text-muted" />
            {fmtTime(a.startsAt, tz)}
          </span>
          <TypeDot type={a.type as AppointmentType} />
          <span className="rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
            {reasonText}
          </span>
        </div>
        <StatusLabel status={a.status as AppointmentStatus} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => onSelect(a.id)}
            className="text-base font-bold text-foreground hover:text-accent text-left"
          >
            {a.customer.displayName}
          </button>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {a.vehicle && (
              <div className="flex items-center gap-1.5">
                <PlateBadge plate={a.vehicle.plate} />
                <span>
                  {a.vehicle.make} {a.vehicle.model}
                </span>
              </div>
            )}
            {a.customer.phone ? (
              <span className="font-mono">{a.customer.phone}</span>
            ) : (
              <span className="text-status-bad">{ta("todayPage.noPhone")}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {canUpdate && (
            <Button
              size="sm"
              onClick={() => onConfirm(a.id)}
              className="min-h-11 gap-1.5 bg-purple-600 font-semibold text-white hover:bg-purple-700"
            >
              <UserCheck size={14} />
              <span>{ta("todayPage.confirmPhone")}</span>
            </Button>
          )}
          {canUpdate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onNoShow(a.id)}
              className="min-h-11 text-xs text-muted hover:text-status-bad"
            >
              {ta("todayPage.markNoShow")}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {a.customer.phone && (
            <a
              href={`tel:${a.customer.phone}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-foreground hover:bg-surface-2"
            >
              <Phone size={14} className="text-muted" />
              <span>{ta("todayPage.call")}</span>
            </a>
          )}
          {a.customer.phone && (
            <a
              href={waLink(a.customer.phone, waMessage)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-green-500/30 bg-green-500/10 px-3 text-xs font-semibold text-green-700 hover:bg-green-500/20"
            >
              <MessageCircle size={14} />
              <span>{ta("todayPage.quickWhatsApp")}</span>
            </a>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSelect(a.id)}
            className="min-h-11 text-xs text-muted hover:text-foreground"
          >
            {ta("todayPage.viewFile")}
          </Button>
        </div>
      </div>
    </div>
  );
}
