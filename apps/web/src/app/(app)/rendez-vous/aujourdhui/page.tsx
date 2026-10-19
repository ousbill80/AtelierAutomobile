"use client";

// PRD M03 §7 — écran "Aujourd'hui" de l'accueil. Simplification documentée : pas de section
// "Confirmations à obtenir par téléphone" dans cette étape (dépend de `appointments.
// unconfirmed_check`, dont le résultat n'est pas encore exposé par une requête dédiée).
import Link from "next/link";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { AppointmentRow } from "../page";

export default function AppointmentsTodayPage() {
  const me = trpc.me.get.useQuery();
  const siteId = me.data?.activeSiteId ?? me.data?.allowedSites[0]?.id ?? null;

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

  const { data, isLoading, refetch } = trpc.appointment.list.useQuery(
    { siteId: siteId!, from, to },
    { enabled: !!siteId },
  );
  const utils = trpc.useUtils();
  const invalidate = () => utils.appointment.list.invalidate();

  const appointments = data?.appointments ?? [];
  const confirmed = appointments.filter((a) => a.status === "CONFIRMED").length;
  const unanswered = appointments.filter((a) => a.status === "BOOKED").length;

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Aujourd&apos;hui</h1>
        <Link href="/rendez-vous" className="text-sm text-accent hover:underline">
          Voir le planning complet
        </Link>
      </div>

      {data && (
        <p className="text-sm text-muted">
          {appointments.length} RDV · {confirmed} confirmés · {unanswered} sans réponse
        </p>
      )}

      {isLoading && (
        <div className="h-24 animate-pulse rounded-lg border border-border bg-surface-2" />
      )}

      {data && appointments.length === 0 && (
        <EmptyState title="Aucun RDV aujourd'hui." description="Revenez plus tard." />
      )}

      <div className="flex flex-col gap-3">
        {appointments.map((appointment) => (
          <AppointmentRow key={appointment.id} appointment={appointment} onChanged={invalidate} />
        ))}
      </div>
      {!isLoading && (
        <Button variant="ghost" onClick={() => refetch()}>
          Actualiser
        </Button>
      )}
    </div>
  );
}
