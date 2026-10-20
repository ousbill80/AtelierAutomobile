// M17 RG-M17-01 — fournisseur `console` : réponses déterministes calculées par la fixture de
// chaque fonction (`consoleReply`), sans réseau ni clé. Utilisé en local et dans tous les tests.
// Les jetons comptés sont une estimation stable (≈ 4 caractères par jeton).
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiMessage,
  type AiProvider,
} from "./types";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function messagesLength(messages: AiMessage[]): number {
  return messages.reduce(
    (sum, m) =>
      sum + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length),
    0,
  );
}

export interface ConsoleAiProviderOptions {
  /** Forcer une panne (tests du disjoncteur et des replis). */
  fail?: "TIMEOUT" | "ERROR";
}

export function createConsoleAiProvider(options: ConsoleAiProviderOptions = {}): AiProvider {
  return {
    name: "console",
    model: "console",
    fastModel: "console",
    async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
      if (options.fail) {
        throw new AiProviderError(options.fail, "Panne simulée (console).");
      }
      const reply = request.consoleReply?.(request) ?? { text: "" };
      const text = reply.text ?? "";
      const toolCalls = reply.toolCalls ?? [];
      return {
        text,
        toolCalls,
        stopReason: toolCalls.length ? "tool_use" : "end_turn",
        tokensIn: estimateTokens(request.system) + Math.ceil(messagesLength(request.messages) / 4),
        tokensOut: estimateTokens(text + JSON.stringify(toolCalls)),
        model: "console",
      };
    },
  };
}
