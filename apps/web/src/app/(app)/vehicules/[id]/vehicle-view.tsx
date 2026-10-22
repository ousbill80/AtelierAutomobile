"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  FileText,
  Gauge,
  Phone,
  Plus,
  ShieldCheck,
  User,
  Wallet,
  Wrench,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  DueBadge,
  EmptyState,
  Field,
  Input,
  PlateBadge,
  StatusBadge,
  Tabs,
  type StatusTone,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { t } from "@/i18n/t";
import { ReminderMiniBlock } from "../../relances/reminder-mini-block";

const RO_STATUS_MAP: Record<string, { label: string; tone: StatusTone }> = {
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

export function VehicleView({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const { data: vehicle, isLoading, isError } = trpc.vehicle.get.useQuery({ id });
  const [activeTab, setActiveTab] = useState<string>("overview");

  const [mileage, setMileage] = useState("");
  const [inspectionDate, setInspectionDate] = useState("");
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Historique des OR de ce véhicule
  const roList = trpc.repairOrder.list.useQuery(
    { vehicleId: id, limit: 20 },
    { enabled: !!vehicle },
  );

  const recordMileage = trpc.vehicle.recordMileage.useMutation({
    onSuccess: () => {
      setMileage("");
      setActionSuccess(t("vehicleDetail.mileage.success"));
      setTimeout(() => setActionSuccess(null), 3500);
      utils.vehicle.get.invalidate({ id });
    },
  });

  const recordInspection = trpc.vehicle.recordInspection.useMutation({
    onSuccess: () => {
      setInspectionDate("");
      setActionSuccess(t("vehicleDetail.inspection.success"));
      setTimeout(() => setActionSuccess(null), 3500);
      utils.vehicle.get.invalidate({ id });
    },
  });

  const stats = useMemo(() => {
    const orders = roList.data?.items ?? [];
    const activeOrders = orders.filter(
      (o) => !["DELIVERED", "INVOICED", "CANCELLED"].includes(o.status),
    );
    const totalAmount = orders.reduce((sum, o) => sum + (o.totalEstimate ?? 0), 0);
    return {
      totalCount: roList.data?.counters ? roList.data.counters.active + (orders.length - activeOrders.length) : orders.length,
      activeCount: activeOrders.length,
      totalAmount,
    };
  }, [roList.data]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 pb-16 animate-pulse">
        <div className="h-6 w-36 rounded bg-surface-2" />
        <div className="h-14 w-80 rounded bg-surface-2" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-surface-2" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !vehicle) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <AlertCircle className="size-12 text-status-bad" />
        <p className="text-base font-semibold text-foreground">Véhicule introuvable.</p>
        <Link href="/vehicules" className="text-sm text-accent hover:underline">
          {t("vehicleDetail.back")}
        </Link>
      </div>
    );
  }

  const readings = vehicle.mileageReadings ?? [];

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* ── EN-TÊTE DU VÉHICULE ── */}
      <div className="flex flex-col gap-4">
        <Link
          href="/vehicules"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground w-fit transition"
        >
          <ArrowLeft className="size-3.5" />
          {t("vehicleDetail.back")}
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <PlateBadge plate={vehicle.plate} plateType={vehicle.plateType} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")}
              </h1>
              {vehicle.customer && (
                <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                  <User className="size-3.5 text-accent" />
                  <span>{t("vehicleDetail.owner")} :</span>
                  <Link
                    href={`/clients/${vehicle.customer.id}`}
                    className="font-medium text-foreground hover:text-accent hover:underline flex items-center gap-1"
                  >
                    {vehicle.customer.displayName}
                  </Link>
                  {vehicle.customer.phone && (
                    <a
                      href={`tel:${vehicle.customer.phone}`}
                      className="inline-flex items-center gap-1 font-mono text-muted hover:text-foreground ml-1"
                    >
                      <Phone className="size-3 text-status-ok" />
                      {vehicle.customer.phone}
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/ordres/reception?vehicleId=${vehicle.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-xs font-semibold text-background shadow-sm hover:opacity-90 transition min-h-11"
            >
              <Wrench className="size-4" />
              {t("vehicleDetail.orders.newRo")}
            </Link>
          </div>
        </div>

        {actionSuccess && (
          <div className="rounded-lg border border-status-ok/30 bg-status-ok/10 p-3 text-xs font-semibold text-status-ok animate-in fade-in">
            {actionSuccess}
          </div>
        )}
      </div>

      {/* ── 4 CARTES KPIS EN HAUT ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>{t("vehicleDetail.kpis.activeRo")}</span>
            <Wrench className="size-4 text-accent" />
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums mt-0.5">
            {stats.activeCount}
          </p>
          <span className="text-[11px] text-muted">Sur le pont ou en atelier</span>
        </div>

        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>{t("vehicleDetail.kpis.totalRos")}</span>
            <FileText className="size-4 text-accent" />
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums mt-0.5">
            {stats.totalCount}
          </p>
          <span className="text-[11px] text-muted">Passages enregistrés</span>
        </div>

        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>{t("vehicleDetail.kpis.totalSpent")}</span>
            <Wallet className="size-4 text-status-ok" />
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums mt-0.5">
            {formatFCFA(stats.totalAmount)}
          </p>
          <span className="text-[11px] text-muted">Facturé & estimé</span>
        </div>

        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-muted text-xs font-medium">
            <span>{t("vehicleDetail.mileage.title")}</span>
            <Gauge className="size-4 text-accent" />
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums mt-0.5">
            {vehicle.status.estimatedMileage
              ? `${vehicle.status.estimatedMileage.toLocaleString("fr-FR")} km`
              : "—"}
          </p>
          <span className="text-[11px] text-muted">{t("vehicleDetail.mileage.estimated")}</span>
        </div>
      </div>

      {/* ── BARRE D'ONGLETS ── */}
      <Tabs
        items={[
          { key: "overview", label: t("vehicleDetail.tabs.overview") },
          { key: "history", label: `${t("vehicleDetail.tabs.history")} (${roList.data?.items.length ?? 0})` },
          { key: "mileage", label: `${t("vehicleDetail.tabs.mileage")} (${readings.length})` },
          { key: "reminders", label: t("vehicleDetail.tabs.reminders") },
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
      />

      {/* ── ONGLET 1 : SYNTHÈSE & SANTÉ DU VÉHICULE ── */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            {/* Carte Visite Technique */}
            <section className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
                    <ShieldCheck className="size-4 text-accent" />
                    {t("vehicleDetail.inspection.title")}
                  </span>
                  <DueBadge status={vehicle.status.inspection} />
                </div>
                <p className="text-sm text-muted mt-1">
                  {vehicle.inspectionExpiryDate
                    ? t("vehicleDetail.inspection.expiresOn", {
                        date: new Date(vehicle.inspectionExpiryDate).toLocaleDateString("fr-FR"),
                      })
                    : t("vehicleDetail.inspection.unknown")}
                </p>
              </div>

              <form
                className="mt-4 flex flex-col gap-2.5 border-t border-border pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!inspectionDate) return;
                  recordInspection.mutate({ vehicleId: id, date: new Date(inspectionDate) });
                }}
              >
                <Field label={t("vehicleDetail.inspection.recordDate")}>
                  <Input
                    type="date"
                    value={inspectionDate}
                    onChange={(e) => setInspectionDate(e.target.value)}
                    className="min-h-10 font-mono text-xs"
                  />
                </Field>
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  loading={recordInspection.isPending}
                  disabled={!inspectionDate}
                  className="w-full text-xs"
                >
                  {t("vehicleDetail.inspection.button")}
                </Button>
              </form>
            </section>

            {/* Carte Révision */}
            <section className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
                    <CalendarClock className="size-4 text-accent" />
                    {t("vehicleDetail.service.title")}
                  </span>
                  <DueBadge status={vehicle.status.service} />
                </div>
                <p className="text-sm text-muted mt-1">
                  {vehicle.nextServiceDueDate
                    ? t("vehicleDetail.service.dueOn", {
                        date: new Date(vehicle.nextServiceDueDate).toLocaleDateString("fr-FR"),
                      }) +
                      (vehicle.nextServiceDueMileage
                        ? ` (${t("vehicleDetail.service.approxKm", { km: vehicle.nextServiceDueMileage })})`
                        : "")
                    : t("vehicleDetail.service.unknown")}
                </p>
              </div>

              <div className="border-t border-border pt-3 mt-4 text-xs text-muted flex flex-col gap-1">
                <span className="font-medium text-foreground">Intervalles programmés :</span>
                <span>
                  {vehicle.serviceIntervalKm ? `${vehicle.serviceIntervalKm.toLocaleString("fr-FR")} km` : "10 000 km"} /{" "}
                  {vehicle.serviceIntervalMonths ? `${vehicle.serviceIntervalMonths} mois` : "6 mois"}
                </span>
              </div>
            </section>

            {/* Carte Relevé kilométrique rapide */}
            <section className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
                    <Gauge className="size-4 text-accent" />
                    {t("vehicleDetail.mileage.title")}
                  </span>
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {vehicle.status.estimatedMileage
                      ? `${vehicle.status.estimatedMileage.toLocaleString("fr-FR")} km`
                      : "—"}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Relevé au compteur le plus récent ou estimé automatiquement selon le rythme d&apos;utilisation.
                </p>
              </div>

              <form
                className="mt-4 flex flex-col gap-2.5 border-t border-border pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = Number(mileage);
                  if (!value) return;
                  recordMileage.mutate({
                    vehicleId: id,
                    mileage: value,
                    readAt: new Date(),
                    source: "MANUAL",
                  });
                }}
              >
                <Field label={t("vehicleDetail.mileage.inputLabel")}>
                  <Input
                    type="number"
                    min={0}
                    value={mileage}
                    onChange={(e) => setMileage(e.target.value)}
                    placeholder="Ex: 85200"
                    className="min-h-10 font-mono text-xs"
                  />
                </Field>
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  loading={recordMileage.isPending}
                  disabled={!mileage}
                  className="w-full text-xs"
                >
                  {t("vehicleDetail.mileage.button")}
                </Button>
              </form>
            </section>
          </div>

          {/* Fiche technique / Données véhicule */}
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
              Caractéristiques & Informations techniques
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
              <div>
                <span className="text-muted block">Marque</span>
                <span className="font-medium text-foreground">{vehicle.make || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">Modèle</span>
                <span className="font-medium text-foreground">{vehicle.model || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">Année</span>
                <span className="font-medium text-foreground">{vehicle.year || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">N° Châssis (VIN)</span>
                <span className="font-mono font-medium text-foreground">{vehicle.vin || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">Carburant</span>
                <span className="font-medium text-foreground">{vehicle.fuel || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">Transmission</span>
                <span className="font-medium text-foreground">{vehicle.transmission || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">Couleur</span>
                <span className="font-medium text-foreground">{vehicle.color || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">N° de flotte</span>
                <span className="font-medium text-foreground">{vehicle.fleetNumber || "—"}</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── ONGLET 2 : HISTORIQUE DES ORDRES DE RÉPARATION ── */}
      {activeTab === "history" && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">
              {t("vehicleDetail.orders.title")}
            </h2>
            <Link
              href={`/ordres/reception?vehicleId=${vehicle.id}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
            >
              <Plus className="size-3.5" />
              {t("vehicleDetail.orders.newRo")}
            </Link>
          </div>

          {roList.isLoading && (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 rounded-lg bg-surface-2 animate-pulse" />
              ))}
            </div>
          )}

          {roList.data && roList.data.items.length === 0 && (
            <EmptyState
              title={t("vehicleDetail.orders.empty")}
              description="Ce véhicule n'a pas encore fait l'objet d'un ordre de réparation."
            />
          )}

          {roList.data && roList.data.items.length > 0 && (
            <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
              {roList.data.items.map((order) => {
                const statusMeta = RO_STATUS_MAP[order.status] ?? {
                  label: order.status,
                  tone: "off" as const,
                };
                return (
                  <Link
                    key={order.id}
                    href={`/ordres/${order.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface-2/60 transition"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold font-mono text-foreground text-sm">
                          {order.number}
                        </span>
                        <StatusBadge tone={statusMeta.tone}>
                          {statusMeta.label}
                        </StatusBadge>
                      </div>
                      <p className="text-xs text-muted line-clamp-1 max-w-lg">
                        {order.number}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-right">
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground font-mono">
                          {formatFCFA(order.totalEstimate)}
                        </span>
                        <span className="text-muted">
                          {order.createdAt ? new Date(order.createdAt).toLocaleDateString("fr-FR") : "—"}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── ONGLET 3 : HISTORIQUE KILOMÉTRIQUE ── */}
      {activeTab === "mileage" && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">
              {t("vehicleDetail.mileage.tableTitle")}
            </h2>
          </div>

          {readings.length === 0 ? (
            <EmptyState
              title="Aucun relevé enregistré"
              description="Les relevés kilométriques effectués lors des réceptions d'atelier apparaîtront ici."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-surface-2/40 text-muted uppercase font-semibold">
                  <tr>
                    <th className="p-3">{t("vehicleDetail.mileage.colDate")}</th>
                    <th className="p-3">{t("vehicleDetail.mileage.colMileage")}</th>
                    <th className="p-3">{t("vehicleDetail.mileage.colSource")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-medium">
                  {readings.map((reading) => (
                    <tr key={reading.id} className="hover:bg-surface-2/40 transition">
                      <td className="p-3 font-mono text-muted">
                        {new Date(reading.readAt).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-3 font-mono font-bold text-foreground">
                        {reading.mileage.toLocaleString("fr-FR")} km
                      </td>
                      <td className="p-3 text-muted">
                        {reading.source
                          ? ["RECEPTION", "MANUAL", "INSPECTION", "WORKSHOP"].includes(reading.source)
                            ? t(`vehicleDetail.mileage.sources.${reading.source as "RECEPTION" | "MANUAL" | "INSPECTION" | "WORKSHOP"}`)
                            : reading.source
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── ONGLET 4 : RELANCES & ÉCHÉANCES ── */}
      {activeTab === "reminders" && (
        <section className="flex flex-col gap-4">
          <ReminderMiniBlock vehicleId={id} />
        </section>
      )}
    </div>
  );
}
