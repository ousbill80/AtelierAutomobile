"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, DueBadge, Input, PlateBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { VehicleInsuranceCard } from "@/components/claims/vehicle-insurance-card";
import { ReminderMiniBlock } from "../../relances/reminder-mini-block";
import { formatDate } from "../../relances/reminder-labels";
import { t } from "@/i18n/t";

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

  if (isLoading) return <p className="text-sm text-muted">{t("vehicles.detail.loading")}</p>;
  if (isError || !vehicle)
    return <p className="text-sm text-status-bad">{t("vehicles.detail.notFound")}</p>;

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
          {t("vehicles.detail.owner")}
        </Link>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">{t("vehicles.detail.inspection")}</h2>
          <DueBadge status={vehicle.status.inspection} />
          <p className="mt-2 text-sm text-muted">
            {vehicle.inspectionExpiryDate
              ? t("vehicles.detail.expiresOn", { date: formatDate(vehicle.inspectionExpiryDate) })
              : t("vehicles.detail.unknownDate")}
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
              label={t("vehicles.detail.inspectionDoneOn")}
              value={inspectionDate}
              onChange={(e) => setInspectionDate(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={recordInspection.isPending}>
              {t("vehicles.detail.inspectionDone")}
            </Button>
          </form>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">{t("vehicles.detail.service")}</h2>
          <DueBadge status={vehicle.status.service} />
          <p className="mt-2 text-sm text-muted">
            {vehicle.nextServiceDueDate
              ? t("vehicles.detail.serviceDueOn", {
                  date: formatDate(vehicle.nextServiceDueDate),
                }) +
                (vehicle.nextServiceDueMileage
                  ? t("vehicles.detail.serviceDueKm", { km: vehicle.nextServiceDueMileage })
                  : "")
              : t("vehicles.detail.unknownHistory")}
          </p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">{t("vehicles.detail.mileage")}</h2>
          <p className="tabular text-lg font-semibold">
            {vehicle.status.estimatedMileage == null
              ? "—"
              : t("vehicles.detail.mileageValue", { km: vehicle.status.estimatedMileage })}
          </p>
          <p className="text-sm text-muted">{t("vehicles.detail.estimatedToday")}</p>
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
              label={t("vehicles.detail.newReading")}
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
            />
            {recordMileage.error && (
              <p className="text-xs text-status-bad">{recordMileage.error.message}</p>
            )}
            <Button type="submit" variant="secondary" disabled={recordMileage.isPending}>
              {t("vehicles.detail.saveMileage")}
            </Button>
          </form>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <VehicleInsuranceCard vehicle={vehicle} />
      </div>

      <ReminderMiniBlock vehicleId={id} />
    </div>
  );
}
