"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@atelieros/ui";
import type { AppointmentCreateInput } from "@atelieros/validators";
import { trpc } from "@/trpc/react";
import { APPOINTMENT_TYPE_LABELS } from "../appointment-labels";

type AppointmentType = AppointmentCreateInput["type"];

export default function NewAppointmentPage() {
  const router = useRouter();
  const me = trpc.me.get.useQuery();
  const siteId = me.data?.activeSiteId ?? me.data?.allowedSites[0]?.id ?? "";

  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [type, setType] = useState<AppointmentType>("SERVICE");
  const [date, setDate] = useState("");
  const [complaint, setComplaint] = useState("");

  const create = trpc.appointment.create.useMutation({
    onSuccess: (appointment) => router.push(`/rendez-vous?created=${appointment.id}`),
  });

  return (
    <div className="flex flex-col gap-4 pb-20">
      <h1 className="text-2xl font-semibold">Nouveau rendez-vous</h1>

      <form
        className="flex max-w-xl flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!customerId.trim() || !date || !siteId) return;
          create.mutate({
            siteId,
            customerId: customerId.trim(),
            vehicleId: vehicleId.trim() || undefined,
            type,
            startsAt: new Date(date),
            source: "STAFF",
            complaint: complaint.trim() || undefined,
            notifyCustomer: true,
          });
        }}
      >
        <label className="text-sm">
          ID client
          <input
            className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="cuid du client"
          />
        </label>

        <label className="text-sm">
          ID véhicule (facultatif)
          <input
            className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder="cuid du véhicule"
          />
        </label>

        <label className="text-sm">
          Type de rendez-vous
          <select
            className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as AppointmentType)}
          >
            {Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          Date et heure
          <input
            type="datetime-local"
            className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

        <label className="text-sm">
          Motif / doléances
          <input
            className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            placeholder="Bruit au freinage, vidange…"
          />
        </label>

        <Button type="submit" disabled={create.isPending || !siteId}>
          Enregistrer et envoyer la confirmation
        </Button>
        {create.error && <p className="text-sm text-status-bad">{create.error.message}</p>}
      </form>
    </div>
  );
}
