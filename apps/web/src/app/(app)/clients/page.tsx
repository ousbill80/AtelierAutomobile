"use client";

import Link from "next/link";
import { useState } from "react";
import { DataTable, EmptyState, Input, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { LinkButton } from "@/components/link-button";

export default function ClientsPage() {
  const [q, setQ] = useState("");
  const { data, isLoading, isError } = trpc.customer.list.useQuery({
    q: q || undefined,
    limit: 50,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <LinkButton href="/clients/nouveau">Nouveau client</LinkButton>
      </div>

      <Input
        placeholder="Rechercher un client (nom, téléphone, email)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />

      {isLoading && <p className="text-sm text-muted">Chargement…</p>}
      {isError && <p className="text-sm text-status-bad">Impossible de charger les clients.</p>}

      {data && data.items.length === 0 && (
        <EmptyState
          title="Aucun client pour l'instant."
          description="Importez votre fichier ou créez votre premier client."
          action={<LinkButton href="/clients/nouveau">Nouveau client</LinkButton>}
        />
      )}

      {data && data.items.length > 0 && (
        <DataTable
          rows={data.items}
          rowKey={(c) => c.id}
          columns={[
            {
              key: "name",
              header: "Nom",
              render: (c) => (
                <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                  {c.displayName}
                </Link>
              ),
            },
            {
              key: "type",
              header: "Type",
              render: (c) => (
                <StatusBadge tone={c.type === "COMPANY" ? "off" : "ok"}>
                  {c.type === "COMPANY" ? "Entreprise" : "Particulier"}
                </StatusBadge>
              ),
            },
            { key: "phone", header: "Téléphone", render: (c) => c.phone ?? "—" },
            { key: "commune", header: "Commune", render: (c) => c.commune ?? "—" },
          ]}
        />
      )}
    </div>
  );
}
