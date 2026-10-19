import type { ReactNode } from "react";

export type StatusTone = "ok" | "warn" | "bad" | "off";

const TONE_CLASSES: Record<StatusTone, string> = {
  ok: "bg-status-ok-bg text-status-ok",
  warn: "bg-status-warn-bg text-status-warn",
  bad: "bg-status-bad-bg text-status-bad",
  off: "bg-status-off-bg text-status-off",
};

const TONE_ICON: Record<StatusTone, string> = {
  ok: "●",
  warn: "▲",
  bad: "■",
  off: "○",
};

export interface StatusBadgeProps {
  tone: StatusTone;
  children: ReactNode;
}

/** Statut affiché avec couleur + icône + texte (CLAUDE.md « jamais la couleur seule »). */
export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden="true" className="text-[0.6rem]">
        {TONE_ICON[tone]}
      </span>
      {children}
    </span>
  );
}
