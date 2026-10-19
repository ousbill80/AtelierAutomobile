"use client";

import Link from "next/link";
import { DueBadge, EmptyState, PlateBadge, StatusBadge } from "@atelieros/ui";
import { LinkButton } from "@/components/link-button";
import { trpc } from "@/trpc/react";
import { ReminderMiniBlock } from "../../relances/reminder-mini-block";

export function CustomerView({ id }: { id: string }) {
  const { data: customer, isLoading, isError } = trpc.customer.get.useQuery({ id });
  const { data: timeline } = trpc.customer.timeline.useQuery({ id });

  if (isLoading) return <p className="text-sm text-muted">Chargement…</p>;
  if (isError || !customer) return <p className="text-sm text-status-bad">Client introuvable.</p>;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{customer.displayName}</h1>
          <div className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
            <StatusBadge tone={customer.type === "COMPANY" ? "off" : "ok"}>
              {customer.type === "COMPANY" ? "Entreprise" : "Particulier"}
            </StatusBadge>
            {customer.phone && <span>{customer.phone}</span>}
            {customer.email && <span>{customer.email}</span>}
            {customer.reachability === "OPTED_OUT" && (
              <StatusBadge tone="bad">Désinscrit</StatusBadge>
            )}
            {customer.reachability === "DO_NOT_REMIND" && (
              <StatusBadge tone="bad">Ne plus relancer</StatusBadge>
            )}
            {customer.reachability === "UNREACHABLE" && (
              <StatusBadge tone="off">Injoignable</StatusBadge>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 text-sm">
          <p className="text-muted">Encours</p>
          <p className="tabular text-lg font-semibold">
            {customer.balance.due.toLocaleString("fr-FR")} FCFA
          </p>
          {customer.balance.overdue > 0 && (
            <p className="text-status-bad">
              dont {customer.balance.overdue.toLocaleString("fr-FR")} FCFA en retard
            </p>
          )}
        </div>
      </header>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Véhicules</h2>
          <LinkButton href={`/vehicules/nouveau?customerId=${id}`} variant="secondary">
            Ajouter un véhicule
          </LinkButton>
        </div>
        {customer.vehicles.length === 0 ? (
          <EmptyState
            title="Aucun véhicule."
            description="Ajoutez le premier véhicule de ce client."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {customer.vehicles.map((vehicle) => (
              <li key={vehicle.id}>
                <Link
                  href={`/vehicules/${vehicle.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 hover:bg-surface-2"
                >
                  <PlateBadge plate={vehicle.plate} plateType={vehicle.plateType} />
                  <span className="font-medium">
                    {vehicle.make} {vehicle.model}
                  </span>
                  <DueBadge
                    status={
                      !vehicle.inspectionExpiryDate
                        ? "UNKNOWN"
                        : vehicle.inspectionExpiryDate < new Date()
                          ? "EXPIRED"
                          : "OK"
                    }
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReminderMiniBlock customerId={id} />

      <section>
        <h2 className="mb-2 text-lg font-semibold">Chronologie</h2>
        {!timeline || timeline.items.length === 0 ? (
          <EmptyState title="Pas encore d'historique." />
        ) : (
          <ul className="flex flex-col gap-2">
            {timeline.items.map((item, index) => (
              <li
                key={index}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
              >
                <span className="text-muted">{item.at.toLocaleDateString("fr-FR")}</span> —{" "}
                {item.type}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
