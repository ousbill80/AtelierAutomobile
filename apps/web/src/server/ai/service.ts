// M17 — instance du service IA pour apps/web. Fournisseur choisi par l'environnement
// (`AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_MODEL_FAST`) ; les tests injectent le
// fournisseur `console` (ou une panne simulée) via `setAiProviderForTests`.
import { createDbAiStore } from "@atelieros/db";
import {
  createAiService,
  createClaudeProvider,
  createConsoleAiProvider,
  resolveAiProviderFromEnv,
  type AiProvider,
  type AiService,
} from "@atelieros/integrations";

const globalForAi = globalThis as unknown as { atelierosAiService?: AiService };

function build(provider?: AiProvider): AiService {
  return createAiService({
    provider:
      provider ??
      resolveAiProviderFromEnv(process.env, {
        claude: createClaudeProvider,
        console: () => createConsoleAiProvider(),
      }),
    store: createDbAiStore(),
  });
}

export function getAiService(): AiService {
  globalForAi.atelierosAiService ??= build();
  return globalForAi.atelierosAiService;
}

/** Tests : remplace le fournisseur (et remet le disjoncteur à zéro). `undefined` = défaut. */
export function setAiProviderForTests(provider?: AiProvider): void {
  globalForAi.atelierosAiService = build(provider ?? createConsoleAiProvider());
}
