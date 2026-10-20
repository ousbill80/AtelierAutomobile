export type {
  AiCompletionRequest,
  AiCompletionResponse,
  AiConsoleReply,
  AiContentBlock,
  AiMessage,
  AiProvider,
  AiRole,
  AiToolCall,
  AiToolDef,
} from "./types";
export { AiProviderError } from "./types";
export { createClaudeProvider, DEFAULT_CLAUDE_MODEL } from "./claude";
export type { ClaudeProviderOptions } from "./claude";
export { createConsoleAiProvider } from "./console";
export type { ConsoleAiProviderOptions } from "./console";
export {
  AI_UNAVAILABLE_REASON,
  createAiService,
  extractJson,
  resolveAiProviderFromEnv,
} from "./service";
export type {
  AiCallContext,
  AiInteractionRecord,
  AiInteractionStatus,
  AiOrgContext,
  AiRunResult,
  AiService,
  AiServiceDeps,
  AiStore,
  AiStructuredRun,
  AiToolLoopResult,
  AiToolLoopRun,
} from "./service";

// Prompts versionnés (RG-M17-05) — boîte de réception.
export * from "./prompts/intent_classification/v1";
export * from "./prompts/reply_draft/v1";
