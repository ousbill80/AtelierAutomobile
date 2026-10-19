"use client";

// M05 §7 — badges : statut du devis, priorité d'un groupe, remise à valider.
// Toujours couleur + pastille + texte (CLAUDE.md « Statuts »).
import { StatusBadge } from "@atelieros/ui";
import { DISCOUNT_APPROVAL_TONE, PRIORITY_TONE, STATUS_TONE, t } from "./i18n";

export function QuoteStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={STATUS_TONE[status] ?? "off"} label={t(`status.${status}`)} />;
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  const key = priority ?? "NONE";
  return <StatusBadge tone={PRIORITY_TONE[key] ?? "off"} label={t(`priority.${key}`)} />;
}

export function DiscountApprovalBadge({ status }: { status: string }) {
  if (status === "NONE") return null;
  return (
    <StatusBadge
      tone={DISCOUNT_APPROVAL_TONE[status] ?? "off"}
      label={t(`discountApproval.${status}`)}
    />
  );
}
