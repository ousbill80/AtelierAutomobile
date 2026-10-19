"use client";

// M08 — badges : statut de facture, état FNE. Couleur + pastille + icône + texte.
import { StatusBadge } from "@atelieros/ui";
import { FNE_TONE, INVOICE_STATUS_TONE, t } from "./i18n";

export function InvoiceStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={INVOICE_STATUS_TONE[status] ?? "off"} label={t(`status.${status}`)} />;
}

export function FneBadge({ status }: { status: string }) {
  if (status === "NOT_REQUIRED") return null;
  const icon =
    status === "CERTIFIED" || status === "MANUAL" ? "✓ " : status === "FAILED" ? "✕ " : "⚠ ";
  return <StatusBadge tone={FNE_TONE[status] ?? "off"} label={`${icon}${t(`fne.${status}`)}`} />;
}
