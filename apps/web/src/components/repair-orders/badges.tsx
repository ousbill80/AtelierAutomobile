"use client";

// M04 §7 — badges partagés : statut d'OR, accord de ligne, résultat d'inspection, promesse.
// Toujours couleur + pastille + texte (CLAUDE.md « Statuts »).
import { StatusBadge } from "@atelieros/ui";
import { APPROVAL_TONE, INSPECTION_TONE, STATUS_TONE, formatDateTime, t } from "./i18n";

export function RepairOrderStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={STATUS_TONE[status] ?? "off"} label={t(`status.${status}`)} />;
}

export function LineApprovalBadge({ approval }: { approval: string }) {
  return <StatusBadge tone={APPROVAL_TONE[approval] ?? "off"} label={t(`approval.${approval}`)} />;
}

export function InspectionResultBadge({ result }: { result: string }) {
  return (
    <StatusBadge
      tone={INSPECTION_TONE[result] ?? "off"}
      label={t(`inspection.results.${result}`)}
    />
  );
}

export function PromiseCountdown({
  promisedAt,
  late,
  timeZone,
}: {
  promisedAt: Date | string | null;
  late: boolean;
  timeZone?: string;
}) {
  if (!promisedAt) return <span className="text-xs text-muted">{t("card.noPromise")}</span>;
  return (
    <span className={`text-xs ${late ? "font-semibold text-status-bad" : "text-muted"}`}>
      {late ? `⏰ ${t("card.late")} · ` : ""}
      {t("card.promise", { date: formatDateTime(promisedAt, timeZone) })}
    </span>
  );
}
