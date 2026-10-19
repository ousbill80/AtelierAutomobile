export type StatusTone = "ok" | "warn" | "bad" | "off";

export interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
}

/** Statut toujours couleur + pastille + texte (jamais la couleur seule). */
export function StatusBadge({ tone, label }: StatusBadgeProps) {
  return (
    <span className={`pill pill-${tone}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function TypeBadge({ label }: { label: string }) {
  return <span className="pill pill-type">{label}</span>;
}
