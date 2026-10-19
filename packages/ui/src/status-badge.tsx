import type { ComponentType, ReactNode } from "react";
import { cn } from "./cn";

export type StatusTone = "ok" | "warn" | "bad" | "off" | "info";

const TONE_CLASSES: Record<StatusTone, string> = {
  ok: "bg-status-ok-bg text-status-ok",
  warn: "bg-status-warn-bg text-status-warn",
  bad: "bg-status-bad-bg text-status-bad",
  off: "bg-status-off-bg text-status-off",
  info: "bg-accent/15 text-accent",
};

export interface StatusBadgeProps {
  tone: StatusTone;
  /** Icône facultative (ex. `lucide-react`) — jamais la seule couleur comme indicateur (voir CLAUDE.md « UI »). */
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}

/**
 * Badge de statut générique : couleur + icône + texte (jamais la couleur
 * seule), conformément à CLAUDE.md § UI. Les modules consommateurs
 * fournissent le `tone`/libellé propres à leur domaine (ex. statut d'import).
 */
export function StatusBadge({ tone, icon: Icon, children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5" /> : null}
      {children}
    </span>
  );
}
