// M17 RG-M17-21 — phrase « faits marquants » du résumé quotidien : le service IA rédige une
// phrase à partir des seuls chiffres du résumé ; elle est revérifiée par le code (chiffres
// cités présents dans les faits, ≤ 200 caractères). Fonction « de fond » : hors quota, IA
// désactivée ou en panne, le résumé part sans phrase (jamais bloqué).
import {
  acceptDigestHighlight,
  digestHighlightFacts,
  hasDigestHighlightMaterial,
  type DigestInput,
} from "@atelieros/core";
import {
  buildDigestMessage,
  DIGEST_PROMPT_VERSION,
  DIGEST_SYSTEM,
  digestConsoleOutput,
  digestOutputSchema,
} from "@atelieros/integrations";
import { getAiService } from "../ai";

export function digestHighlighter(organizationId: string, membershipId: string, day: string) {
  return async (input: DigestInput): Promise<string | null> => {
    const facts = digestHighlightFacts(input);
    if (!hasDigestHighlightMaterial(facts)) return null;
    const result = await getAiService().runStructured({
      feature: "daily_digest",
      promptVersion: DIGEST_PROMPT_VERSION,
      ctx: { organizationId, membershipId },
      inputRef: `digest:${membershipId}:${day}`,
      system: DIGEST_SYSTEM,
      messages: [{ role: "user", content: buildDigestMessage(facts) }],
      schema: digestOutputSchema,
      maxTokens: 300,
      effort: "low",
      consoleOutput: () => digestConsoleOutput(facts),
    });
    return result.ok ? acceptDigestHighlight(result.output.sentence, facts) : null;
  };
}
