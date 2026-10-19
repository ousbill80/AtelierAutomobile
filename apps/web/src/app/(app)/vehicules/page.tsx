"use client";

import { useState } from "react";
import Link from "next/link";
import { DataTable, EmptyState, Input, PlateBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";

export default function VehiclesPage() {
  const [q, setQ] = useState("");
  const { data, isLoading, isError } = trpc.vehicle.list.useQuery({ q: q || undefined, limit: 50 });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Véhicules</h1>

      <Input
        placeholder="Rechercher (plaque, VIN, n° de parc)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />

      {isLoading && <p className="text-sm text-muted">Chargement…</p>}
      {isError && <p className="text-sm text-status-bad">Impossible de charger les véhicules.</p>}
      {data && data.items.length === 0 && <EmptyState title="Aucun véhicule." />}

      {data && data.items.length > 0 && (
        <DataTable
          rows={data.items}
          rowKey={(v) => v.id}
          columns={[
            {
              key: "plate",
              header: "Plaque",
              render: (v) => (
                <Link href={`/vehicules/${v.id}`}>
                  <PlateBadge plate={v.plate} plateType={v.plateType} />
                </Link>
              ),
            },
            { key: "model", header: "Marque / modèle", render: (v) => `${v.make} ${v.model}` },
            {
              key: "mileage",
              header: "Km estimé",
              render: (v) => v.status.estimatedMileage ?? "—",
            },
          ]}
        />
      )}
    </div>
  );
}
