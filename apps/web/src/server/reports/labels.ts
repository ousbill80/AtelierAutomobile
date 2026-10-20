// Libellés des rapports (M12 §7), lus depuis messages/fr.json : l'écran, l'Excel, le PDF et le
// CSV affichent les mêmes textes.
import fr from "../../../messages/fr.json";

export const RL = fr.reports;
export const methodLabel = (m: string) => (fr.billing.method as Record<string, string>)[m] ?? m;
export const bucketLabel = (b: string) =>
  (fr.dashboard.finances.buckets as Record<string, string>)[b] ?? b;
export const reminderTypeLabel = (t: string) =>
  (fr.dashboard.reminders.types as Record<string, string>)[t] ?? t;
export const channelLabel = (c: string | null) =>
  c ? ((RL.channels as Record<string, string>)[c] ?? c) : "";
export const columnLabel = (key: string) => (RL.columns as Record<string, string>)[key] ?? key;
export const reportTitle = (slug: string) =>
  (RL.list as Record<string, { title: string }>)[slug]?.title ?? slug;
