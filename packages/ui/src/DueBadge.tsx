import { StatusBadge, type StatusTone } from "./StatusBadge";

export interface DueBadgeProps {
  /** "UNKNOWN" | "OK" | "DUE_SOON" | "EXPIRED" | "OVERDUE" (inspection ou révision). */
  status: "UNKNOWN" | "OK" | "DUE_SOON" | "EXPIRED" | "OVERDUE";
  /** Jours restants (négatif = dépassé) ; sert au libellé "J-15" / "Expirée depuis 6 j". */
  daysRemaining?: number | null;
}

const TONE_BY_STATUS: Record<DueBadgeProps["status"], StatusTone> = {
  UNKNOWN: "off",
  OK: "ok",
  DUE_SOON: "warn",
  EXPIRED: "bad",
  OVERDUE: "bad",
};

const LABEL_BY_STATUS: Record<DueBadgeProps["status"], string> = {
  UNKNOWN: "Inconnue",
  OK: "À jour",
  DUE_SOON: "Bientôt",
  EXPIRED: "Expirée",
  OVERDUE: "Dépassée",
};

/** RG-M02-12/§5 — « J-15 », « Expirée depuis 6 j », etc. */
export function DueBadge({ status, daysRemaining }: DueBadgeProps) {
  const suffix =
    daysRemaining == null
      ? ""
      : daysRemaining >= 0
        ? ` (J-${daysRemaining})`
        : ` (depuis ${Math.abs(daysRemaining)} j)`;
  return (
    <StatusBadge tone={TONE_BY_STATUS[status]} label={`${LABEL_BY_STATUS[status]}${suffix}`} />
  );
}
