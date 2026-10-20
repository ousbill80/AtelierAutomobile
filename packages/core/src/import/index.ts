export type { CsvDelimiter } from "./csv";
export { detectCsvDelimiter, detectHeaderRowIndex, filterDataRows, parseCsvLines } from "./csv";

export type { FileDedupeMerge, FileDedupeResult } from "./dedupe";
export type { CustomerMatchInput, CustomerMatchKey, CustomerMatchStrategy } from "./dedupe";
export type { VehicleMatchKey, VehicleMatchStrategy } from "./dedupe";
export type { InvoiceMatchKey, InvoiceMatchStrategy } from "./dedupe";
export type { PaymentMatchKey, PaymentMatchStrategy } from "./dedupe";
export {
  dedupeRowsInFile,
  resolveCustomerMatchKey,
  resolveInvoiceMatchKey,
  resolvePaymentMatchKey,
  resolveVehicleMatchKey,
} from "./dedupe";

export type { DetectedEncoding } from "./encoding";
export { decodeBytes, detectEncoding } from "./encoding";

export { canonicalize, computeRowHash } from "./hash";

export type { ColumnMatch, MappingSource, SplitVehicleName, SuggestedMapping } from "./mapping";
export {
  detectCompanyFromName,
  headerSignature,
  KNOWN_VEHICLE_MAKES,
  levenshteinDistance,
  matchColumn,
  normalizeHeader,
  splitVehicleName,
  suggestColumnMapping,
} from "./mapping";

export type {
  AmountNormalizationResult,
  DateNormalizationOptions,
  DateNormalizationResult,
  EmailNormalizationResult,
  ImportFuelType,
  ImportPaymentMethod,
  ImportPhoneResult,
} from "./normalize";
export {
  normalizeImportAmount,
  normalizeImportDate,
  normalizeImportEmail,
  normalizeImportFuelType,
  normalizeImportName,
  normalizeImportPaymentMethod,
  normalizeImportPhone,
  normalizeImportText,
} from "./normalize";

export type { BalanceChangeResult, ImportPolicy, MergeResult, RowOutcome } from "./policy";
export {
  computeBalanceChange,
  mergeFields,
  NEVER_OVERWRITTEN_FIELDS,
  outcomeForHash,
} from "./policy";

export type { SimulatedRowResult, SimulationCounts, SimulationSummary } from "./simulate";
export { summarizeSimulation } from "./simulate";

export type { TargetField } from "./synonyms";
export { SYNONYMS, TARGET_FIELDS_BY_ENTITY } from "./synonyms";

export type {
  CustomerRowInput,
  InvoiceRowInput,
  IssueSeverity,
  PaymentRowInput,
  ProductRowInput,
  RepairOrderRowInput,
  RowIssue,
  VehicleRowInput,
} from "./validate";
export {
  hasBlockingError,
  validateCustomerRow,
  validateInvoiceBalanceColumn,
  validateInvoiceRow,
  validatePaymentRow,
  validateProductRow,
  validateRepairOrderRow,
  validateVehicleRow,
} from "./validate";

export type { SqlDialect, SyncEntity } from "./sync";
export {
  assertReadOnlySelect,
  assertSyncSchedule,
  bindSince,
  DEFAULT_SYNC_SCHEDULE,
  isSyncDue,
  mapSyncColumns,
  shouldNotifySyncFailure,
  sinceFor,
  SYNC_ENTITY_ORDER,
  SYNC_QUERY_MAX_ROWS,
  SYNC_QUERY_TIMEOUT_MS,
} from "./sync";

export type { AgentStatus } from "./agent";
export {
  AGENT_CLOCK_SKEW_WARNING_MS,
  AGENT_HEARTBEAT_INTERVAL_MS,
  AGENT_OFFLINE_AFTER_MS,
  AGENT_QUEUE_RETENTION_MS,
  batchIdempotencyKey,
  chunkRows,
  effectiveAgentStatus,
  generateAgentToken,
  generatePairingCode,
  hashAgentToken,
  hashSourceRow,
  isClockSkewed,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
  pairingExpiresAt,
  AGENT_SYNC_BATCH_SIZE,
} from "./agent";

export type { WatchRule } from "./watch";
export {
  ERROR_FOLDER,
  isFileStable,
  matchesFilePattern,
  processedFolder,
  ruleForFile,
  WATCH_MAX_RULES,
  WATCH_STABLE_MS,
} from "./watch";
