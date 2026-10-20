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
  buildQuoteDraftMessages,
  QUOTE_DRAFT_PROMPT_VERSION,
  QUOTE_DRAFT_SYSTEM,
  quoteDraftConsoleOutput,
  quoteDraftOutputSchema,
} from "./prompts/quote_draft/v1";
export type { QuoteDraftOutput, QuoteDraftPromptInput } from "./prompts/quote_draft/v1";
export {
  buildQuoteExplanationMessages,
  QUOTE_EXPLANATION_PROMPT_VERSION,
  QUOTE_EXPLANATION_SYSTEM,
  quoteExplanationConsoleOutput,
  quoteExplanationOutputSchema,
} from "./prompts/quote_explanation/v1";
export type {
  QuoteExplanationGroup,
  QuoteExplanationOutput,
  QuoteExplanationPromptInput,
} from "./prompts/quote_explanation/v1";
