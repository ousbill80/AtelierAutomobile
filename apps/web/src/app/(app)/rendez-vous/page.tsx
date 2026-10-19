"use client";

// PRD M03 §7 — Planning. Simplification documentée (cf. message de commit) : vue Liste
// uniquement pour cette étape (pas de grille par pont/mécanicien avec glisser-déposer —
// même précédent de simplification que M10 pour les écrans mobiles). "Déplacer" se fait via
// un petit formulaire plutôt qu'un geste, comme la file des relances.
import { useState } from "react";
import Link from "next/link";
import { Button, EmptyState, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  appointmentStatusTone,
  formatDateTime,
} from "./appointment-labels";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type AppointmentCard = RouterOutputs["appointment"]["list"]["appointments"][number];

function rangeFromToday(days: number): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export default function AppointmentsPage() {
  const me = trpc.me.get.useQuery();
  const siteId = me.data?.activeSiteId ?? me.data?.allowedSites[0]?.id ?? null;
  const { from, to } = rangeFromToday(14);

  const { data, isLoading, isError, refetch } = trpc.appointment.list.useQuery(
    { siteId: siteId!, from, to },
    { enabled: !!siteId },
  );
  const utils = trpc.useUtils();
  const invalidate = () => utils.appointment.list.invalidate();

  const byDate = new Map<string, AppointmentCard[]>();
  for (const appointment of data?.appointments ?? []) {
    const key = new Date(appointment.startsAt).toLocaleDateString("fr-FR");
    const list = byDate.get(key) ?? [];
    list.push(appointment);
    byDate.set(key, list);
  }

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Rendez-vous</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/rendez-vous/aujourdhui"
            className="min-h-11 rounded-md bg-surface-2 px-4 py-2 text-sm font-medium hover:bg-border"
          >
            Aujourd&apos;hui
          </Link>
          <Link
            href="/rendez-vous/nouveau"
            className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Nouveau RDV
          </Link>
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-border bg-surface-2"
            />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">Impossible de charger les rendez-vous.</p>
          <Button variant="secondary" onClick={() => refetch()}>
            Réessayer
          </Button>
        </div>
      )}

      {data && data.appointments.length === 0 && (
        <EmptyState
          title="Aucun RDV ce jour."
          description="Les relances VT et révision vont remplir votre agenda."
        />
      )}

      {[...byDate.entries()].map(([date, appointments]) => (
        <div key={date} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted">{date}</h2>
          {appointments.map((appointment) => (
            <AppointmentRow key={appointment.id} appointment={appointment} onChanged={invalidate} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function AppointmentRow({
  appointment,
  onChanged,
}: {
  appointment: AppointmentCard;
  onChanged: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("Pièce non disponible");

  const confirm = trpc.appointment.confirm.useMutation({ onSuccess: onChanged });
  const markArrived = trpc.appointment.markArrived.useMutation({ onSuccess: onChanged });
  const markNoShow = trpc.appointment.markNoShow.useMutation({ onSuccess: onChanged });
  const cancel = trpc.appointment.cancel.useMutation({
    onSuccess: () => {
      setCancelling(false);
      onChanged();
    },
  });

  const anyPending =
    confirm.isPending || markArrived.isPending || markNoShow.isPending || cancel.isPending;
  const canConfirm = appointment.status === "BOOKED";
  const canArrive = appointment.status === "BOOKED" || appointment.status === "CONFIRMED";
  const canCancel = canArrive;
  const canNoShow = canArrive;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid={`appointment-${appointment.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/clients/${appointment.customerId}`}
              className="font-medium hover:underline"
            >
              {appointment.customer.displayName}
            </Link>
            {appointment.vehicle && (
              <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs">
                {appointment.vehicle.plate}
              </span>
            )}
            <StatusBadge tone={appointmentStatusTone(appointment.status)}>
              {APPOINTMENT_STATUS_LABELS[appointment.status] ?? appointment.status}
            </StatusBadge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {APPOINTMENT_TYPE_LABELS[appointment.type] ?? appointment.type} ·{" "}
            {APPOINTMENT_SOURCE_LABELS[appointment.source] ?? appointment.source}
            {appointment.overbooked && " · ⚠ surréservé"}
          </p>
        </div>
        <p className="text-sm text-muted">{formatDateTime(appointment.startsAt)}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {canConfirm && (
          <Button
            variant="secondary"
            disabled={anyPending}
            onClick={() => confirm.mutate({ id: appointment.id, via: "in_person" })}
          >
            Confirmer
          </Button>
        )}
        {canArrive && (
          <Button disabled={anyPending} onClick={() => markArrived.mutate({ id: appointment.id })}>
            Client arrivé
          </Button>
        )}
        {canNoShow && (
          <Button
            variant="ghost"
            disabled={anyPending}
            onClick={() => markNoShow.mutate({ id: appointment.id })}
          >
            Marquer absent
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" disabled={anyPending} onClick={() => setCancelling((v) => !v)}>
            Annuler
          </Button>
        )}
      </div>

      {cancelling && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate({ id: appointment.id, cancelledBy: "GARAGE", reason });
          }}
        >
          <select
            className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {[
              "Pièce non disponible",
              "Atelier surchargé",
              "Mécanicien absent",
              "Doublon",
              "Autre",
            ].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={cancel.isPending}>
            Confirmer l&apos;annulation
          </Button>
          <Button type="button" variant="ghost" onClick={() => setCancelling(false)}>
            Fermer
          </Button>
        </form>
      )}

      {confirm.error && <p className="text-xs text-status-bad">{confirm.error.message}</p>}
      {markArrived.error && <p className="text-xs text-status-bad">{markArrived.error.message}</p>}
      {markNoShow.error && <p className="text-xs text-status-bad">{markNoShow.error.message}</p>}
      {cancel.error && <p className="text-xs text-status-bad">{cancel.error.message}</p>}
    </div>
  );
}
