// Libellés de l'écran Messages (apps/web/messages/fr.json › messagesPage).
import { t } from "@/i18n/t";

export function tm(key: string, vars?: Record<string, string | number>): string {
  return t(`messagesPage.${key}`, vars);
}

/** « 14:32 » aujourd'hui, « Hier », « lun. 02/11 » cette semaine, sinon « 02/11/2026 ». */
export function shortWhen(value: Date | string, now: Date): string {
  const d = new Date(value);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor(
    (startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000,
  );
  if (diffDays <= 0) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return tm("yesterday");
  if (diffDays < 7)
    return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
  return d.toLocaleDateString("fr-FR");
}
