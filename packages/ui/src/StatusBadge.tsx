import type { ReactNode } from "react";

export type StatusTone = "ok" | "warn" | "bad" | "off";

export interface StatusBadgeProps {
  tone: StatusTone;
  label?: string;
  /** Alternative à `label` pour un contenu composé. */
  children?: ReactNode;
  className?: string;
}

/** Statut toujours couleur + pastille + texte (jamais la couleur seule). */
export function StatusBadge({ tone, label, children, className }: StatusBadgeProps) {
  return (
    <span className={["pill", `pill-${tone}`, className].filter(Boolean).join(" ")}>
      <span className="dot" />
      {label ?? children}
    </span>
  );
}

export function TypeBadge({ label }: { label: string }) {
  return <span className="pill pill-type">{label}</span>;
}
