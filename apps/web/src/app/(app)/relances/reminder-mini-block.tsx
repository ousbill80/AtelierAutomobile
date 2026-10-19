"use client";

// PRD M10 §7.4 — bloc « Relances » des fiches client/véhicule. Simplification documentée : le
// routeur `reminders` n'expose pas de requête « toutes les relances d'un client/véhicule, tous
// onglets confondus » ; on affiche donc seulement les deux onglets les plus utiles ici (« À
// valider » et « Planifiées aujourd'hui »), limités à 5 lignes chacun, avec un lien vers
// l'écran complet /relances pour le reste.
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/trpc/client";
import type { AppRouter } from "@/server/routers/_app";
import { REMINDER_TYPE_LABELS, formatDateTime } from "./reminder-labels";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ReminderMiniItem = RouterOutputs["reminders"]["queue"]["items"][number];

export function ReminderMiniBlock({
  customerId,
  vehicleId,
}: {
  customerId?: string;
  vehicleId?: string;
}) {
  const toApprove = trpc.reminders.queue.useQuery({
    tab: "TO_APPROVE",
    customerId,
    vehicleId,
    limit: 5,
  });
  const planned = trpc.reminders.queue.useQuery({
    tab: "PLANNED_TODAY",
    customerId,
    vehicleId,
    limit: 5,
  });

  const loading = toApprove.isLoading || planned.isLoading;
  const toApproveItems = toApprove.data?.items ?? [];
  const plannedItems = planned.data?.items ?? [];
  const empty = !loading && toApproveItems.length === 0 && plannedItems.length === 0;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Relances</h2>
        <Link href="/relances" className="text-sm text-accent hover:underline">
          Voir tout
        </Link>
      </div>
      {loading && <p className="text-sm text-muted">Chargement…</p>}
      {empty && <p className="text-sm text-muted">Aucune relance en attente.</p>}
      {!loading && !empty && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniList title="À valider" items={toApproveItems} />
          <MiniList title="Planifiées aujourd'hui" items={plannedItems} />
        </div>
      )}
    </section>
  );
}

function MiniList({ title, items }: { title: string; items: ReminderMiniItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-muted">{title}</p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="text-sm">
            {REMINDER_TYPE_LABELS[item.type] ?? item.type} · palier {item.stepKey} —{" "}
            {formatDateTime(item.scheduledFor)}
          </li>
        ))}
      </ul>
    </div>
  );
}
