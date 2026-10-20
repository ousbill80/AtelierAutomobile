// M17 RG-M17-01 — fournisseur Claude (API Anthropic). Clé lue dans `ANTHROPIC_API_KEY`
// (variable d'environnement serveur, jamais renvoyée au front ni journalisée), modèle dans
// `AI_MODEL` (défaut : dernier modèle Claude), modèle léger optionnel dans `AI_MODEL_FAST`.
// Le compte API doit être configuré sans conservation pour l'entraînement (RG-M17-04).
import Anthropic from "@anthropic-ai/sdk";
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiContentBlock,
  type AiMessage,
  type AiProvider,
} from "./types";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

export interface ClaudeProviderOptions {
  apiKey: string;
  model?: string;
  fastModel?: string;
  /** Client injectable (tests). */
  client?: Anthropic;
}

function toSdkContent(content: AiMessage["content"]): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  return content.map((block: AiContentBlock) => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text } as const;
      case "image":
        return {
          type: "image",
          source: { type: "base64", media_type: block.mediaType, data: block.data },
        } as const;
      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        } as const;
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content,
          is_error: block.isError ?? false,
        } as const;
    }
  });
}

export function createClaudeProvider(options: ClaudeProviderOptions): AiProvider {
  const model = options.model || DEFAULT_CLAUDE_MODEL;
  const fastModel = options.fastModel || model;
  // Les réessais SDK (429/5xx) restent courts : le timeout par fonction (RG-M17-08) prime.
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 1 });

  return {
    name: "claude",
    model,
    fastModel,
    async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
      const usedModel = request.model ?? model;
      try {
        const response = await client.messages.create(
          {
            model: usedModel,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: request.messages.map((m) => ({
              role: m.role,
              content: toSdkContent(m.content),
            })),
            ...(request.tools?.length
              ? {
                  tools: request.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
                  })),
                }
              : {}),
            output_config: { effort: request.effort ?? "medium" },
          },
          { timeout: request.timeoutMs },
        );
        let text = "";
        const toolCalls = [];
        for (const block of response.content) {
          if (block.type === "text") text += block.text;
          else if (block.type === "tool_use") {
            toolCalls.push({ id: block.id, name: block.name, input: block.input });
          }
        }
        const stop = response.stop_reason;
        return {
          text,
          toolCalls,
          stopReason:
            stop === "end_turn" ||
            stop === "tool_use" ||
            stop === "max_tokens" ||
            stop === "refusal"
              ? stop
              : "other",
          tokensIn: response.usage.input_tokens,
          tokensOut: response.usage.output_tokens,
          model: usedModel,
        };
      } catch (error) {
        if (error instanceof Anthropic.APIConnectionTimeoutError) {
          throw new AiProviderError("TIMEOUT", "Délai dépassé.");
        }
        if (error instanceof Anthropic.APIError) {
          // Message générique : jamais la clé ni le contenu du prompt dans les logs.
          throw new AiProviderError("ERROR", `Erreur API ${error.status ?? "réseau"}.`);
        }
        throw new AiProviderError("ERROR", "Erreur inattendue du fournisseur IA.");
      }
    },
  };
}
