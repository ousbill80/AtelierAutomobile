import { AlertTriangle, Ban, CheckCircle2, Clock } from "lucide-react";
import type { StatusTone } from "@atelieros/ui/src/status-badge";
import { t } from "@/lib/i18n";

export const SCHEDULE_PRESETS = ["0 2 * * *", "0 * * * *", "*/15 * * * *"] as const;

/** Planning en langage simple (M13 §7 : « Tous les jours à 02:00 »). */
export function scheduleLabel(schedule: string | null): string {
  const value = schedule ?? "0 2 * * *";
  return (SCHEDULE_PRESETS as readonly string[]).includes(value)
    ? t(`import.sources.schedules.${value}`)
    : value;
}

export function sourceStatus(source: { isActive: boolean; lastStatus: string | null }): {
  key: "SUCCESS" | "FAILED" | "NONE" | "INACTIVE";
  tone: StatusTone;
  icon: typeof Clock;
} {
  if (!source.isActive) return { key: "INACTIVE", tone: "off", icon: Ban };
  if (source.lastStatus === "SUCCESS") return { key: "SUCCESS", tone: "ok", icon: CheckCircle2 };
  if (source.lastStatus === "FAILED") return { key: "FAILED", tone: "bad", icon: AlertTriangle };
  return { key: "NONE", tone: "off", icon: Clock };
}

export function formatDateTime(value: string | Date | null): string {
  if (!value) return t("import.sources.never");
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
