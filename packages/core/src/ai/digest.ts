// M17 RG-M17-21 — phrase « faits marquants » du résumé quotidien M12. Le modèle ne reçoit que
// des chiffres agrégés (aucun nom, téléphone ni libellé d'alerte : RG-M17-04) et ne fait que
// rédiger ; la phrase est rejetée si elle cite un chiffre absent des faits ou dépasse 200
// caractères. Le résumé n'est jamais bloqué : sans phrase valide, il part sans ligne 💡.
import type { DigestInput } from "../dashboard/digest";
import { unverifiedNumbers } from "./text";

export const DIGEST_HIGHLIGHT_MAX_LENGTH = 200;

/** Faits transmis au modèle : uniquement des nombres agrégés du résumé. */
export interface DigestHighlightFacts {
  mode: "FULL" | "REMINDERS_ONLY";
  yesterday: { revenueHt: number; collected: number; byMethod: Record<string, number> } | null;
  orders: { opened: number; delivered: number; inProgress: number } | null;
  today: { appointments: number; promised: number; blockedParts: number } | null;
  receivables: { total: number; over30: number } | null;
  promisesToday: { count: number; amount: number } | null;
  reminders: { toApprove: number; failed: number };
  recovered: { yesterday: number; last30Days: number };
  remindersOnly: { inspectionsDue30: number; servicesDueThisMonth: number } | null;
  alertsCount: number;
  /** Seuils cités par le résumé (« à +30 j », « pièces > 48 h ») : seuls nombres hors faits admis. */
  thresholds: { receivablesDays: 30; blockedPartsHours: 48; recoveredDays: 30 };
}

export function digestHighlightFacts(input: DigestInput): DigestHighlightFacts {
  return {
    mode: input.mode,
    yesterday: input.yesterday ?? null,
    orders: input.orders ?? null,
    today: input.today ?? null,
    receivables: input.receivables
      ? { total: input.receivables.total, over30: input.receivables.over30 }
      : null,
    promisesToday: input.promisesToday,
    reminders: input.reminders,
    recovered: input.recovered,
    remindersOnly: input.remindersOnly ?? null,
    alertsCount: input.alerts.length,
    thresholds: { receivablesDays: 30, blockedPartsHours: 48, recoveredDays: 30 },
  };
}

/** Rien à signaler : pas d'appel au modèle (économie de crédits). */
export function hasDigestHighlightMaterial(facts: DigestHighlightFacts): boolean {
  const y = facts.yesterday;
  return (
    !!(y && (y.revenueHt !== 0 || y.collected !== 0)) ||
    !!(
      facts.orders && facts.orders.opened + facts.orders.delivered + facts.orders.inProgress > 0
    ) ||
    !!(facts.receivables && facts.receivables.total > 0) ||
    facts.recovered.yesterday > 0 ||
    facts.alertsCount > 0
  );
}

/**
 * Phrase retenue, ou `null` : une ligne, ≤ 200 caractères, et chaque nombre cité figure dans les
 * faits (en FCFA arrondis au millier, l'écriture « 1,2 million » n'est pas acceptée).
 */
export function acceptDigestHighlight(
  sentence: string | null | undefined,
  facts: DigestHighlightFacts,
): string | null {
  const text = (sentence ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > DIGEST_HIGHLIGHT_MAX_LENGTH) return null;
  if (unverifiedNumbers(text, [facts]).length > 0) return null;
  return text;
}
