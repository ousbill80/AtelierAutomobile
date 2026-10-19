"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, DueBadge, Input, PlateBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ReminderMiniBlock } from "../../relances/reminder-mini-block";

export function VehicleView({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const { data: vehicle, isLoading, isError } = trpc.vehicle.get.useQuery({ id });

  const [mileage, setMileage] = useState("");
  const [inspectionDate, setInspectionDate] = useState("");

  const recordMileage = trpc.vehicle.recordMileage.useMutation({
    onSuccess: () => {
      setMileage("");
      utils.vehicle.get.invalidate({ id });
    },
  });
  const recordInspection = trpc.vehicle.recordInspection.useMutation({
    onSuccess: () => {
      setInspectionDate("");
      utils.vehicle.get.invalidate({ id });
    },
  });

  if (isLoading) return <p className="text-sm text-muted">Chargement…</p>;
  if (isError || !vehicle) return <p className="text-sm text-status-bad">Véhicule introuvable.</p>;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <PlateBadge plate={vehicle.plate} plateType={vehicle.plateType} />
        <h1 className="text-2xl font-semibold">
          {vehicle.make} {vehicle.model} {vehicle.year ?? ""}
        </h1>
        <Link
          href={`/clients/${vehicle.customerId}`}
          className="text-sm text-accent hover:underline"
        >
          Voir le propriétaire
        </Link>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">Visite technique</h2>
          <DueBadge status={vehicle.status.inspection} />
          <p className="mt-2 text-sm text-muted">
            {vehicle.inspectionExpiryDate
              ? `Expire le ${vehicle.inspectionExpiryDate.toLocaleDateString("fr-FR")}`
              : "Date inconnue"}
          </p>
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!inspectionDate) return;
              recordInspection.mutate({ vehicleId: id, date: new Date(inspectionDate) });
            }}
          >
            <Input
              type="date"
              label="VT effectuée le"
              value={inspectionDate}
              onChange={(e) => setInspectionDate(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={recordInspection.isPending}>
              VT effectuée
            </Button>
          </form>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">Révision</h2>
          <DueBadge status={vehicle.status.service} />
          <p className="mt-2 text-sm text-muted">
            {vehicle.nextServiceDueDate
              ? `Due vers le ${vehicle.nextServiceDueDate.toLocaleDateString("fr-FR")}` +
                (vehicle.nextServiceDueMileage ? ` (≈ ${vehicle.nextServiceDueMileage} km)` : "")
              : "Historique inconnu"}
          </p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">Kilométrage</h2>
          <p className="tabular text-lg font-semibold">
            {vehicle.status.estimatedMileage ?? "—"} km
          </p>
          <p className="text-sm text-muted">estimé du jour</p>
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(mileage);
              if (!value) return;
              recordMileage.mutate({
                vehicleId: id,
                mileage: value,
                readAt: new Date(),
                source: "RECEPTION",
              });
            }}
          >
            <Input
              type="number"
              label="Nouveau relevé"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
            />
            {recordMileage.error && (
              <p className="text-xs text-status-bad">{recordMileage.error.message}</p>
            )}
            <Button type="submit" variant="secondary" disabled={recordMileage.isPending}>
              Saisir le km
            </Button>
          </form>
        </section>
      </div>

      <ReminderMiniBlock vehicleId={id} />
    </div>
  );
}
