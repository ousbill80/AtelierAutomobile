// M17 RG-M17-01 — interface unique des fournisseurs de modèle de langage. Aucune autre partie
// du code n'appelle une API de modèle directement : tout passe par `AiProvider` (Claude en
// production, `console` déterministe en local et en test).

export type AiRole = "user" | "assistant";

export type AiContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface AiMessage {
  role: AiRole;
  content: string | AiContentBlock[];
}

export interface AiToolDef {
  name: string;
  description: string;
  /** JSON Schema de l'entrée. */
  inputSchema: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** Réponse déterministe du fournisseur `console` (fixture), calculée par la fonction appelante. */
export interface AiConsoleReply {
  text?: string;
  toolCalls?: AiToolCall[];
}

export interface AiCompletionRequest {
  feature: string;
  /** Modèle à utiliser ; à défaut, celui du fournisseur. */
  model?: string;
  system: string;
  messages: AiMessage[];
  tools?: AiToolDef[];
  maxTokens: number;
  timeoutMs: number;
  /** Profondeur de réflexion demandée au modèle (coût) : faible pour classer, moyenne sinon. */
  effort?: "low" | "medium" | "high";
  /**
   * Fixture du fournisseur `console` : reçoit la requête (dont l'historique, pour les boucles
   * d'outils) et renvoie une réponse déterministe. Ignorée par les fournisseurs réels.
   */
  consoleReply?: (request: AiCompletionRequest) => AiConsoleReply;
}

export interface AiCompletionResponse {
  text: string;
  toolCalls: AiToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  /** Modèle par défaut (`AI_MODEL`), journalisé dans `AiInteraction.model`. */
  readonly model: string;
  /** Modèle léger optionnel (`AI_MODEL_FAST`) pour classification/extraction courte. */
  readonly fastModel: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
}

/** Erreur fournisseur classée pour le journal (`AiInteraction.status`). */
export class AiProviderError extends Error {
  constructor(
    readonly kind: "TIMEOUT" | "ERROR",
    message: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
