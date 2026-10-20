// M14 §7 — cadre des pages du portail : en-tête compact (garage, appel, WhatsApp), largeur
// maximale 560 px centrée, cibles ≥ 48 px, texte ≥ 16 px, pied « Propulsé par AtelierOS ».
// Composant sans état (utilisable côté serveur comme côté client).
import type { ReactNode } from "react";

export interface PortalGarage {
  name: string;
  phone?: string | null;
  address?: string | null;
  whatsapp?: string | null;
}

function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

export function PortalFrame({
  garage,
  labels,
  children,
}: {
  garage?: PortalGarage | null;
  labels: { call: string; whatsapp: string; poweredBy: string };
  children: ReactNode;
}) {
  const whatsapp = garage?.whatsapp ?? garage?.phone ?? null;
  return (
    <div className="mx-auto flex min-h-dvh w-full min-w-0 max-w-[560px] flex-col text-base">
      {garage && (
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-lg font-semibold">{garage.name}</p>
          {garage.phone && (
            <a
              href={`tel:${garage.phone}`}
              className="btn btn-secondary min-h-12 min-w-12 px-3"
              aria-label={labels.call}
            >
              <span aria-hidden>📞</span>
            </a>
          )}
          {whatsapp && (
            <a
              href={waLink(whatsapp)}
              className="btn btn-secondary min-h-12 min-w-12 px-3"
              aria-label={labels.whatsapp}
              rel="noreferrer noopener"
              target="_blank"
            >
              <span aria-hidden>💬</span>
            </a>
          )}
        </header>
      )}
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-4">{children}</main>
      <footer className="flex flex-col gap-1 border-t border-border px-4 py-3 text-sm text-muted">
        {garage?.address && <span>{garage.address}</span>}
        <span>{labels.poweredBy}</span>
      </footer>
    </div>
  );
}

/** Squelette léger (état de chargement). */
export function PortalSkeleton({ label }: { label: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 p-4" aria-busy="true">
      <p className="sr-only">{label}</p>
      <div className="h-8 w-2/3 animate-pulse rounded bg-surface-2" />
      <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
      <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}
