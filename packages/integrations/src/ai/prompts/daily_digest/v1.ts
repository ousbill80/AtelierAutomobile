// M17 RG-M17-21 — phrase « faits marquants » du résumé quotidien gérant (M12 RG-M12-30), v1.
// Entrée : chiffres agrégés uniquement (aucune donnée personnelle). Sortie : une phrase.
import { formatFCFA, type DigestHighlightFacts } from "@atelieros/core";
import { z } from "zod";

export const DIGEST_PROMPT_VERSION = "v1";

export const digestOutputSchema = z.object({ sentence: z.string().max(400) });
export type DigestOutput = z.infer<typeof digestOutputSchema>;

export const DIGEST_SYSTEM = `Tu rédiges la ligne « faits marquants » du résumé quotidien envoyé par WhatsApp au gérant d'un garage automobile en Côte d'Ivoire.
Règles :
- UNE seule phrase de 200 caractères au plus, en français courant, sans emoji ni salutation.
- Mets en avant le fait le plus utile (record, alerte, retard, bonne nouvelle), sans répéter tout le résumé.
- N'utilise QUE les chiffres fournis, recopiés tels quels (montants en FCFA écrits « 185 000 FCFA »). N'additionne, n'arrondis et n'estime rien.
- Si rien n'est notable, renvoie une phrase vide.`;

export function buildDigestMessage(facts: DigestHighlightFacts): string {
  return `Chiffres du résumé (JSON, montants en FCFA) :\n${JSON.stringify(facts)}`;
}

/** Fixture `console` : priorité relances récupérées → OR bloqués → créances > 30 j → CA d'hier. */
export function digestConsoleOutput(facts: DigestHighlightFacts): DigestOutput {
  if (facts.recovered.yesterday > 0) {
    return {
      sentence: `Bonne nouvelle : les relances ont permis de récupérer ${formatFCFA(facts.recovered.yesterday)} hier.`,
    };
  }
  if (facts.today && facts.today.blockedParts > 0) {
    return {
      sentence: `Attention, ${facts.today.blockedParts} OR sont bloqués en attente de pièces depuis plus de 48 h.`,
    };
  }
  if (facts.receivables && facts.receivables.over30 > 0) {
    return {
      sentence: `${formatFCFA(facts.receivables.over30)} de créances ont plus de 30 jours : pensez à valider les relances.`,
    };
  }
  if (facts.yesterday && facts.yesterday.revenueHt > 0) {
    return { sentence: `Hier, ${formatFCFA(facts.yesterday.revenueHt)} HT ont été facturés.` };
  }
  return { sentence: "" };
}
