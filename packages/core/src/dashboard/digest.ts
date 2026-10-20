// RG-M12-30 — résumé quotidien gérant (`digest.owner`). Sections omises si vides ;
// WhatsApp ≤ 1 000 caractères. Lignes créances, promesses, relances, récupéré, alertes
// (étape 2.4), lignes « HIER », « OR », « AUJOURD'HUI » du mode FULL (étape 6.1), et version
// REMINDERS_ONLY.
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
  /** Mode FULL : CA HT et encaissements de la veille (jour local précédent). */
  yesterday?: { revenueHt: number; collected: number; byMethod: Record<string, number> };
  orders?: { opened: number; delivered: number; inProgress: number };
  today?: { appointments: number; promised: number; blockedParts: number };
  alerts: readonly string[];
  link: string;
}

/** Libellés courts des modes de paiement dans le résumé (« Wave 520 000 · Espèces 310 000 »). */
const METHOD_SHORT: Record<string, string> = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "OM",
  MTN_MOMO: "MoMo",
  MOOV_MONEY: "Moov",
  CARD: "Carte",
  BANK_TRANSFER: "Virement",
  CHEQUE: "Chèque",
  INSURANCE: "Assurance",
  OTHER: "Autre",
};

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

  if (input.mode === "FULL" && input.yesterday) {
    const { revenueHt, collected, byMethod } = input.yesterday;
    if (revenueHt !== 0 || collected !== 0) {
      const methods = Object.entries(byMethod)
        .filter(([, amount]) => amount > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([method, amount]) => `${METHOD_SHORT[method] ?? method} ${plain(amount)}`);
      lines.push(
        `HIER : CA ${formatFCFA(revenueHt)} HT · encaissé ${formatFCFA(collected)}${methods.length ? ` (${methods.join(" · ")})` : ""}`,
      );
    }
  }
  if (input.mode === "FULL" && input.orders) {
    const o = input.orders;
    if (o.opened + o.delivered + o.inProgress > 0) {
      lines.push(`OR : ${o.opened} ouverts · ${o.delivered} livrés · ${o.inProgress} en cours`);
    }
  }
  if (input.mode === "FULL" && input.today) {
    const d = input.today;
    if (d.appointments + d.promised + d.blockedParts > 0) {
      lines.push(
        `AUJOURD'HUI : ${d.appointments} RDV · ${d.promised} véhicules promis · ${d.blockedParts} OR bloqués (pièces > 48 h)`,
      );
    }
  }
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
