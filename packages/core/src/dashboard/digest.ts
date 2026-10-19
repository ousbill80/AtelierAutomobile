// RG-M12-30 — résumé quotidien gérant (`digest.owner`). Sections omises si vides ;
// WhatsApp ≤ 1 000 caractères. Partie 1 (étape 2.4) : lignes créances, promesses,
// relances, récupéré, alertes, et version REMINDERS_ONLY. Les lignes CA / OR / RDV
// (« HIER », « OR », « AUJOURD'HUI ») arrivent avec M04/M07 (étape 6.1).
import { fr } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { formatFCFA } from "../money";

export const DIGEST_MAX_LENGTH = 1000;

export interface DigestInput {
  garageName: string;
  now: Date;
  timeZone: string;
  mode: "FULL" | "REMINDERS_ONLY";
  receivables: { total: number; over30: number } | null;
  promisesToday: { count: number; amount: number } | null;
  reminders: { toApprove: number; failed: number };
  recovered: { yesterday: number; last30Days: number };
  remindersOnly?: { inspectionsDue30: number; servicesDueThisMonth: number };
  alerts: readonly string[];
  link: string;
}

function plain(amount: number): string {
  return formatFCFA(amount).replace(/ FCFA$/, "");
}

/** « samedi 18/10/2026 » dans le fuseau de l'organisation. */
export function digestDateLabel(now: Date, timeZone: string): string {
  return formatInTimeZone(now, timeZone, "EEEE dd/MM/yyyy", { locale: fr });
}

export function buildDigestText(input: DigestInput): string {
  const lines: string[] = [
    `☀️ ${input.garageName} — ${digestDateLabel(input.now, input.timeZone)}`,
  ];

  if (input.mode === "REMINDERS_ONLY" && input.remindersOnly) {
    lines.push(
      `VT sous 30 j : ${input.remindersOnly.inspectionsDue30} · Révisions dues ce mois : ${input.remindersOnly.servicesDueThisMonth}`,
    );
  }
  if (input.receivables && input.receivables.total > 0) {
    lines.push(
      `ARGENT DEHORS : ${formatFCFA(input.receivables.total)} dont ${plain(input.receivables.over30)} à +30 j`,
    );
  }
  if (input.promisesToday && input.promisesToday.count > 0) {
    lines.push(
      `Promesses attendues aujourd'hui : ${input.promisesToday.count} (${formatFCFA(input.promisesToday.amount)})`,
    );
  }
  if (input.reminders.toApprove > 0 || input.reminders.failed > 0) {
    lines.push(
      `RELANCES : ${input.reminders.toApprove} à valider · ${input.reminders.failed} échecs d'envoi`,
    );
  }
  if (input.recovered.yesterday > 0 || input.recovered.last30Days > 0) {
    lines.push(
      `Récupéré grâce aux relances : ${formatFCFA(input.recovered.yesterday)} hier · ${formatFCFA(input.recovered.last30Days)} sur 30 j`,
    );
  }
  for (const alert of input.alerts) lines.push(`⚠️ ${alert}`);

  const footer = `Détails : ${input.link}`;
  // Tronque les alertes (en dernier) si le message dépasse la limite WhatsApp.
  while (lines.length > 1 && [...lines, footer].join("\n").length > DIGEST_MAX_LENGTH) {
    lines.pop();
  }
  return [...lines, footer].join("\n");
}

/** Clé de dédoublonnage `digest:{membershipId}:{date}` (US-M12-08). */
export function digestDedupeKey(membershipId: string, day: string): string {
  return `digest:${membershipId}:${day}`;
}

/** Vrai si l'heure locale courante a atteint l'heure d'envoi `HH:mm` (défaut 07:30). */
export function isDigestDue(now: Date, timeZone: string, time = "07:30"): boolean {
  return formatInTimeZone(now, timeZone, "HH:mm") >= time;
}
