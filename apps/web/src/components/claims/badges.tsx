"use client";

// M16 — badges : statut du dossier, blocages (US-M16-09). Couleur + icône + texte.
import { formatFCFA } from "@atelieros/core/money";
import { StatusBadge } from "@atelieros/ui";
import { CLAIM_STATUS_ICON, CLAIM_STATUS_TONE, t } from "./i18n";

export function ClaimStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge
      tone={CLAIM_STATUS_TONE[status] ?? "off"}
      label={`${CLAIM_STATUS_ICON[status] ?? ""} ${t(`status.${status}`)}`.trim()}
    />
  );
}

export type Blocker =
  | { code: "expert_overdue"; days: number }
  | { code: "approval_waiting"; days: number }
  | { code: "ready_deductible_unpaid"; amount: number }
  | { code: "insurer_invoice_overdue"; days: number };

export function BlockerBadge({ blocker }: { blocker: Blocker }) {
  const label =
    blocker.code === "ready_deductible_unpaid"
      ? t(`blocker.${blocker.code}`, { amount: formatFCFA(blocker.amount) })
      : t(`blocker.${blocker.code}`, { days: blocker.days });
  return <StatusBadge tone="bad" label={`⚠ ${label}`} />;
}
