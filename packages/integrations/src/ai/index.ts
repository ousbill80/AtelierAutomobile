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
