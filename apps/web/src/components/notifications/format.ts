// Libellés de date des notifications : « à l'instant », « il y a 5 min », puis la date.
const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

export function relativeTime(date: Date | string, now: number): string {
  const time = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), "day");
  return new Date(time).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
