// Accusé de réception d'un message (convention WhatsApp) : ✓ envoyé, ✓✓ reçu, ✓✓ lu.
// Toujours icône + texte (jamais la couleur seule).
import { Check, CheckCheck, Clock, FlaskConical, Hand, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DeliveryState } from "@atelieros/core/messaging/delivery";
import { t } from "@/i18n/t";

const STYLE: Record<DeliveryState, { icon: LucideIcon; className: string }> = {
  pending: { icon: Clock, className: "text-muted" },
  sent: { icon: Check, className: "text-muted" },
  delivered: { icon: CheckCheck, className: "text-foreground" },
  read: { icon: CheckCheck, className: "text-sky-600 dark:text-sky-400" },
  failed: { icon: X, className: "text-status-bad" },
  manual: { icon: Hand, className: "text-muted" },
  simulated: { icon: FlaskConical, className: "text-status-warn" },
};

export function DeliveryTicks({
  state,
  compact = false,
}: {
  state: DeliveryState | null | undefined;
  compact?: boolean;
}) {
  if (!state) return null;
  const { icon: Icon, className } = STYLE[state];
  const label = t(`delivery.${state}`);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${className}`}
      title={t(`delivery.hint.${state}`)}
    >
      <Icon size={14} aria-hidden />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}
