// M17 §7 — badge d'intention d'une conversation : couleur + icône + texte (jamais la couleur
// seule). Libellés dans `messages/fr.json` (`aiInbox.intents`).
import { Sparkles } from "lucide-react";
import { INTENT_TONE, type MessageIntent } from "@atelieros/core/ai";
import { StatusBadge } from "@atelieros/ui";
import { t } from "@/i18n/t";

export function IntentBadge({ intent }: { intent: string | null | undefined }) {
  if (!intent || !(intent in INTENT_TONE)) return null;
  const key = intent as MessageIntent;
  const label = t(`aiInbox.intents.${key}`);
  return (
    <span aria-label={t("aiInbox.intentAria", { label })} data-testid="intent-badge">
      <StatusBadge tone={INTENT_TONE[key]}>
        <Sparkles aria-hidden className="mr-1 inline h-3.5 w-3.5" />
        {label}
      </StatusBadge>
    </span>
  );
}
