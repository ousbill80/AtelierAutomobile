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
// Prompts versionnés — extraction de documents et correspondance de colonnes (RG-M17-05).
export {
  documentExtractionConsoleOutput,
  documentExtractionMessages,
  documentExtractionOutputSchema,
  documentExtractionSystem,
  DOCUMENT_EXTRACTION_PROMPT_VERSION,
} from "./prompts/document_extraction/v1";
export type {
  DocumentExtractionOutput,
  ExtractionDocumentKind,
} from "./prompts/document_extraction/v1";
export {
  COLUMN_MAPPING_PROMPT_VERSION,
  COLUMN_MAPPING_SYSTEM,
  columnMappingConsoleOutput,
  columnMappingMessages,
  columnMappingOutputSchema,
} from "./prompts/column_mapping/v1";
export type { ColumnMappingInput, ColumnMappingOutput } from "./prompts/column_mapping/v1";
export {
  ASSISTANT_DENIED_TEXT,
  ASSISTANT_MAX_TOOL_CALLS,
  ASSISTANT_NOT_FOUND_CUSTOMER_TEXT,
  ASSISTANT_PROMPT_VERSION,
  ASSISTANT_TOOLS,
  assistantSystemPrompt,
} from "./prompts/assistant/v2";
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
