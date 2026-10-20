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
export {
  ASSISTANT_DENIED_TEXT,
  ASSISTANT_MAX_TOOL_CALLS,
  ASSISTANT_NOT_FOUND_CUSTOMER_TEXT,
  ASSISTANT_PROMPT_VERSION,
  ASSISTANT_TOOLS,
  assistantSystemPrompt,
} from "./prompts/assistant/v1";
