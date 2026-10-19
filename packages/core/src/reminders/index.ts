// M10 — Moteur de relances automatiques (packages/core, fonctions pures + types).
// Les jobs (`reminders.plan`/`reminders.dispatch`), l'accès DB et l'UI sont hors scope de cette
// tranche (voir docs/03-plan-construction.md, étape 2.2).

export type {
  ReminderType,
  ReminderChannel,
  ReminderStatus,
  StepAnchorMode,
  ReminderAttachment,
  ReminderStep,
  SendWindow,
  ReminderRuleDefinition,
} from "./types";
export {
  DEFAULT_MIN_GAP_DAYS,
  DEFAULT_CATCH_UP_DAYS,
  DEFAULT_MIN_RECEIVABLE_AMOUNT,
  DEFAULT_EXCLUDE_TAGS,
  TRANSACTIONAL_REMINDER_TYPES,
} from "./types";

export type { EasterBasedHolidays } from "./holidays";
export {
  computeEasterSunday,
  easterBasedHolidays,
  ivorianFixedHolidays,
  christianHolidaysOfYear,
} from "./holidays";

export type {
  MileageReading,
  EstimateAvgKmPerDayOptions,
  ComputeServiceDueInput,
  ServiceDueResult,
  ServiceDefaults,
  FuelServiceOverrides,
  EligibilityContext,
  EligibilityConditions,
} from "./anchors";
export {
  isWithinCandidateWindow,
  estimateAvgKmPerDay,
  computeServiceDue,
  resolveServiceInterval,
  isInspectionDateSuspect,
  estimateInspectionExpiry,
  isEligible,
  assertNoDuplicatePlate,
} from "./anchors";

export type { StepValidationIssue } from "./steps";
export { collectStepIssues, validateSteps, describeStepsChange } from "./steps";

export type {
  AnchorDates,
  StepHistoryEntry,
  PickStepConfig,
  PickStepResult,
  NextSendSlotInput,
} from "./schedule";
export {
  sequenceKey,
  dedupeKey,
  promiseBrokenDedupeKey,
  manualDedupeKey,
  targetDate,
  pickStep,
  nextSendSlot,
  approvalExpiry,
} from "./schedule";

export type { GroupableReminder, ReminderGroup, GroupTemplateKind } from "./grouping";
export { recipientKey, groupKey, groupReminders } from "./grouping";

export type {
  ReminderPriority,
  AntiSpamSentEntry,
  AntiSpamConfig,
  AntiSpamCapDecision,
  SatisfactionBlockingCaseStatus,
} from "./antispam";
export {
  priorityOf,
  isTransactionalPriority,
  leastPriorityReminder,
  DEFAULT_MAX_PER_DAY,
  DEFAULT_MAX_PER_WEEK,
  antiSpamAllows,
  applyAntiSpamCap,
  isSatisfactionBlocked,
} from "./antispam";

export type {
  RevalidateOutcome,
  RevalidateClientInput,
  RevalidateInspectionInput,
  RevalidateServiceInput,
  CollectionCaseStatus,
  RevalidateReceivableInput,
  AppointmentStatus,
  RevalidateAppointmentInput,
  QuoteStatus,
  RevalidateTypeInput,
} from "./revalidate";
export {
  revalidateClient,
  revalidateInspection,
  revalidateService,
  revalidateReceivable,
  revalidateAppointment,
  revalidateQuoteFollowup,
  revalidateVehicleReady,
  revalidateBeforeSend,
} from "./revalidate";

export type {
  ReminderStopEvent,
  ReminderSuppressionRecord,
  SuppressionTarget,
} from "./suppression";
export {
  REMINDER_STOP_EVENTS,
  isValidStopEvent,
  validateStopOn,
  isSuppressed,
  assertValidSuppressionScope,
  buildAppointmentSuppressions,
  buildAnchorChangedSuppression,
  buildOwnerChangedSuppression,
  buildStopSequenceSuppression,
  buildReplyPauseSuppression,
  liftSuppressionsForSequence,
} from "./suppression";

export type { TemplateVariables } from "./render";
export { renderTemplate, extractTemplateVariables } from "./render";

export type { IndividualRecipientInput, ResolvedRecipient, ResolveChannelsInput } from "./channel";
export { resolveIndividualRecipient, resolveReminderChannels } from "./channel";

export type { ApprovalMode, InitialStatusInput } from "./approval";
export {
  initialReminderStatus,
  isDispatchPaused,
  DEFAULT_APPROVAL_MODE,
  NO_CHANNEL,
} from "./approval";

export type { ReminderSettings } from "./settings";
export { DEFAULT_REMINDER_SETTINGS, parseReminderSettings } from "./settings";

export type {
  Civility,
  SalutationInput,
  ReceivableSummaryInput,
  VehicleDueLine,
} from "./variables";
export {
  customerSalutation,
  describeDueCountdown,
  lateDays,
  receivablesSummary,
  formatVehicleDueList,
} from "./variables";

export type { DefaultMessageTemplate, DefaultReminderRule } from "./defaults";
export {
  resolveTemplateCandidates,
  DEFAULT_REMINDER_RULES,
  DEFAULT_MESSAGE_TEMPLATES,
} from "./defaults";
