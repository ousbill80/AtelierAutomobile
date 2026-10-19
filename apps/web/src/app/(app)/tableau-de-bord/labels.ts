// Libellés du tableau de bord (M12), lus depuis messages/fr.json.
import fr from "../../../../messages/fr.json";

export const L = fr.dashboard;

/** Remplace les `{clé}` d'un libellé par les valeurs fournies. */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

export function formatAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
}

/** `yyyy-MM-dd` → `dd/MM/yyyy`. */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

export function reminderTypeLabel(type: string): string {
  return (L.reminders.types as Record<string, string>)[type] ?? type;
}
