"use client";

// M17 §7 — bouton flottant « Assistant » (icône étincelle) : ouvre `/assistant`. Désactivé avec
// info-bulle quand l'assistant est indisponible (désactivé, hors quota, disjoncteur ouvert).
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/react";

export function AssistantFab() {
  const me = trpc.me.get.useQuery();
  const canUse = (me.data?.permissions ?? []).includes("ai:use");
  const status = trpc.ai.status.useQuery(undefined, { enabled: canUse, staleTime: 60_000 });
  if (!canUse) return null;
  const availability = status.data?.assistant;
  const reason = availability && !availability.available ? availability.reason : null;
  const className =
    "fixed bottom-4 right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold shadow-lg";
  if (reason) {
    return (
      <span
        role="button"
        aria-disabled="true"
        title={reason}
        className={`${className} cursor-not-allowed bg-surface-2 text-muted`}
      >
        <Sparkles aria-hidden className="h-5 w-5" />
        {t("assistant.fabUnavailable")}
      </span>
    );
  }
  return (
    <Link
      href="/assistant"
      className={`${className} bg-accent text-accent-foreground`}
      data-testid="assistant-fab"
    >
      <Sparkles aria-hidden className="h-5 w-5" />
      {t("assistant.fab")}
    </Link>
  );
}
