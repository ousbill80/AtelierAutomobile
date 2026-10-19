"use client";

// M05 — badges : statut du devis, priorité d'un groupe. Couleur + pastille + texte.
import { StatusBadge } from "@atelieros/ui";
import { PRIORITY_TONE, QUOTE_STATUS_TONE, t } from "./i18n";

export function QuoteStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={QUOTE_STATUS_TONE[status] ?? "off"} label={t(`status.${status}`)} />;
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority || !PRIORITY_TONE[priority]) return null;
  return (
    <StatusBadge
      tone={PRIORITY_TONE[priority]!}
      label={`${priority === "URGENT" ? "⚠ " : "👁 "}${t(`priority.${priority}`)}`}
    />
  );
}
