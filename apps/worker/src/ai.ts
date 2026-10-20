// M17 — instance du service IA pour apps/worker (mêmes règles que apps/web : fournisseur
// choisi par l'environnement, `console` sans clé ; les tests injectent leur fournisseur).
import { createDbAiStore } from "@atelieros/db";
import {
  createAiService,
  createClaudeProvider,
  createConsoleAiProvider,
  resolveAiProviderFromEnv,
  type AiProvider,
  type AiService,
} from "@atelieros/integrations";

let service: AiService | undefined;

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
  service ??= build();
  return service;
}

export function setAiProviderForTests(provider?: AiProvider): void {
  service = build(provider ?? createConsoleAiProvider());
}
