"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { trpc } from "@/trpc/react";

/**
 * Coquille minimale de l'espace applicatif : barre latérale + nom de l'organisation active.
 * Le sélecteur de site, le menu profil et la recherche globale plein écran restent à faire
 * (portée promise par l'Étape 0.4 / M01, non encore livrée) — voir le message de commit.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { data: me } = trpc.me.get.useQuery();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-1 border-b border-border bg-surface p-4 md:w-56 md:border-b-0 md:border-r">
        <p className="mb-4 font-display text-lg font-bold">AtelierOS</p>
        {me?.activeOrganization && (
          <p className="mb-2 truncate text-xs text-muted">{me.activeOrganization.name}</p>
        )}
        <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
          <Link
            href="/clients"
            className="min-h-11 rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Clients
          </Link>
          <Link
            href="/vehicules"
            className="min-h-11 rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Véhicules
          </Link>
          <Link
            href="/clients/doublons"
            className="min-h-11 rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Doublons
          </Link>
          <Link
            href="/messages"
            className="min-h-11 rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Messages
          </Link>
          <Link
            href="/parametres/canaux"
            className="min-h-11 rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Canaux
          </Link>
          <Link
            href="/parametres/modeles"
            className="min-h-11 rounded-md px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Modèles
          </Link>
        </nav>
      </aside>
      <main className="flex-1 bg-bg p-4 md:p-8">{children}</main>
    </div>
  );
}
