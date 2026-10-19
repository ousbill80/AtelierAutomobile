export type { Clock } from "./clock";
export { fixedClock, systemClock } from "./clock";

export { DomainError, isDomainError } from "./errors";

export type { BusinessDayOptions, HolidayLike, Weekday } from "./calendar";
export {
  addBusinessDays,
  businessDate,
  DEFAULT_WEEKLY_CLOSURE,
  formatDate,
  isBusinessDay,
  isHoliday,
  subBusinessDays,
  today,
} from "./calendar";

export type { InvoiceLineInput, InvoiceLineTotals, InvoiceTotals } from "./money";
export {
  computeInvoiceTotals,
  computeLine,
  formatFCFA,
  parseFCFA,
  roundHalfUp,
  ttcToHt,
} from "./money";

export type { NormalizedPhone, PhoneLineType, PhoneStatus } from "./phone";
export { convertLegacyNumber, isValidPhoneCI, normalizePhoneCI, phoneLineType } from "./phone";

export type { NormalizedPlate, PlateType } from "./plate";
export { normalizePlate } from "./plate";

export type {
  DocumentSequenceKey,
  DocumentType,
  NumberingConfig,
  NumberingRenderContext,
  SequenceStore,
} from "./numbering";
export {
  assertStartValueIncrease,
  DEFAULT_NUMBERING_CONFIG,
  formatDocumentNumber,
  isFiscalDocumentType,
  nextDocumentNumber,
  renderNumberingPattern,
  sequenceKey,
  validateNumberingConfig,
} from "./numbering";

export type { CivilDate, GeneratedHoliday } from "./ci-holidays";
export {
  civilDateToUtcDate,
  computeEasterSunday,
  generateCiHolidays,
  getEstimatedIslamicHolidays,
  getFixedHolidays,
} from "./ci-holidays";

export type { OpeningHours, WeekdayKey } from "./organization/opening-hours";
export { validateOpeningHours, WEEKDAY_KEYS } from "./organization/opening-hours";

export type { OrganizationIdentityForInvoicing } from "./organization/identity";
export {
  assertCanIssueInvoice,
  getMissingInvoiceFields,
  isValidNccFormat,
  isValidRccmFormat,
  NCC_REGEX,
  RCCM_REGEX,
} from "./organization/identity";

export type {
  CanSwitchOperatingModeInput,
  ModuleKey,
  OperatingMode,
  OperatingModeSwitchResult,
} from "./organization/operating-mode";
export {
  assertModuleAllowed,
  canSwitchOperatingMode,
  isModuleVisible,
  MODULE_KEYS,
  REMINDERS_ONLY_VISIBLE_MODULES,
} from "./organization/operating-mode";

export type { Permission, ResolvePermissionsInput, Role } from "./auth/permissions";
export {
  canInviteRole,
  DEFAULT_ROLE_PERMISSIONS,
  isKnownPermission,
  PERMISSIONS,
  resolvePermissions,
  ROLES,
} from "./auth/permissions";

export { hashPassword, verifyPassword } from "./auth/password";

export type { PasswordPolicyContext, PasswordPolicyViolation } from "./auth/password-policy";
export { checkPasswordPolicy, isPasswordPolicyCompliant } from "./auth/password-policy";

export type { LockoutState } from "./auth/lockout";
export {
  INITIAL_LOCKOUT_STATE,
  isLocked,
  LOCKOUT_DURATION_MINUTES,
  LOCKOUT_FAILURE_THRESHOLD,
  RECIDIVE_LOCKOUT_DURATION_MINUTES,
  recordFailedLogin,
  recordSuccessfulLogin,
} from "./auth/lockout";

export type { CanSendOtpInput, OtpVerificationInput, OtpVerificationResult } from "./auth/otp";
export {
  canResendOtp,
  canSendOtp,
  checkOtpAttempt,
  computeOtpExpiry,
  countSendsInLastHour,
  OTP_CODE_LENGTH,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR_PER_IDENTIFIER,
  OTP_MAX_SENDS_PER_HOUR_PER_IP,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "./auth/otp";

export { isTrivialPin, PIN_ELIGIBLE_ROLES, PIN_MAX_FAILED_ATTEMPTS } from "./auth/pin";

export type { SecuritySettingsLike } from "./auth/new-device";
export {
  computeTrustedDeviceExpiry,
  DEFAULT_OTP_ON_NEW_DEVICE_ROLES,
  requiresNewDeviceOtp,
  TRUSTED_DEVICE_APPROVAL_DAYS,
} from "./auth/new-device";

export type { PickActiveSiteInput, SiteOption } from "./auth/site";
export { canUseAllSitesOption, pickActiveSite } from "./auth/site";

export type { PlanLimits, PlanTier } from "./auth/plan";
export { canAddMember, canAddSite, PLAN_LIMITS, PLAN_TIERS } from "./auth/plan";

export type { MembershipRoleState } from "./auth/ownership";
export { wouldRemoveLastOwner } from "./auth/ownership";

export type { SessionRecord } from "./auth/session";
export {
  computeSessionAbsoluteExpiry,
  isSessionExpired,
  PIN_SESSION_DURATION_HOURS,
  SESSION_ABSOLUTE_DAYS,
  SESSION_INACTIVITY_DAYS,
} from "./auth/session";

export type {
  OnboardingBaySeed,
  OnboardingBayType,
  OnboardingChannelConfigSeed,
  OnboardingInspectionItemSeed,
  OnboardingLaborOperationSeed,
  OnboardingMessageTemplateSeed,
  OnboardingReminderRuleSeed,
  OnboardingReminderStep,
} from "./onboarding/seed";
export {
  defaultChannelConfigs,
  defaultInspectionTemplate,
  defaultLaborOperations,
  defaultMessageTemplates,
  defaultReminderRules,
  defaultSiteBays,
  defaultSiteOpeningHours,
} from "./onboarding/seed";

export * from "./import";
export type { DisplayNameInput } from "./customers/display-name";
export { computeDisplayName, titleCaseName } from "./customers/display-name";

export type {
  DuplicateScoreResult,
  DuplicateSeverity,
  DuplicateSignals,
} from "./customers/duplicates";
export {
  DUPLICATE_BLOCK_THRESHOLD,
  DUPLICATE_SUGGEST_THRESHOLD,
  duplicateScore,
  duplicateSeverity,
} from "./customers/duplicates";

export type { ConsentState, DedupeKeyed, FieldChoice } from "./customers/merge";
export {
  defaultFieldChoice,
  mergeConsent,
  mergeTags,
  resolveDedupeKeyCollisions,
  resolveField,
} from "./customers/merge";

export type {
  AvgKmPerDayResult,
  AvgKmPerDaySource,
  MileageReadingLike,
  VehicleUsage,
} from "./vehicles/mileage";
export { computeAvgKmPerDay, DEFAULT_AVG_KM_PER_DAY, estimateMileage } from "./vehicles/mileage";

export type { InspectionStatus, ServiceDueStatus } from "./vehicles/status";
export { inspectionStatus, serviceStatus } from "./vehicles/status";

export type { ServiceDueInput, ServiceDueResult, ServiceDueTrigger } from "./reminders/serviceDue";
export { computeNextServiceDue } from "./reminders/serviceDue";

export { addDays, diffDays, isoDateOnly } from "./reminders/dates";

export type { GroupKeyInput, RecipientAddress, SequenceKeyInput } from "./reminders/keys";
export {
  buildDedupeKey,
  buildGroupKey,
  buildManualDedupeKey,
  buildPromiseBrokenDedupeKey,
  buildRecipientKey,
  buildSequenceKey,
} from "./reminders/keys";

export type {
  PickStepHistoryEntry,
  PickStepInput,
  PickStepResult,
  PickStepRuleStep,
} from "./reminders/pickStep";
export { pickStep, stepsToSupersede, targetDate } from "./reminders/pickStep";

export { approvalExpiry } from "./reminders/approvalExpiry";

export type { PriorityOfOptions, PriorityStep, ReminderTypeLike } from "./reminders/priority";
export { priorityOf } from "./reminders/priority";

export type { InitialReminderStatus, InitialStatusInput } from "./reminders/initialStatus";
export { initialStatus } from "./reminders/initialStatus";

export type { AntiSpamCountsInput } from "./reminders/antiSpam";
export { antiSpamAllows, deferOutcome } from "./reminders/antiSpam";

export type { GroupableReminder, GroupTemplateKeyInput } from "./reminders/grouping";
export {
  detectCombo,
  formatVehicleList,
  resolveGroupTemplateKey,
  templateKeyCandidates,
} from "./reminders/grouping";

export type { ReminderOutcomeLike } from "./reminders/outcome";
export { strongerOutcome } from "./reminders/outcome";

export type { NextSendSlotInput, SendWindowLike } from "./reminders/nextSendSlot";
export { nextSendSlot } from "./reminders/nextSendSlot";

export type {
  ClientNamespaceInput,
  GarageNamespaceInput,
  VehicleNamespaceInput,
} from "./reminders/context";
export { clientNamespace, garageNamespace, vehicleNamespace } from "./reminders/context";

export type { SmsSegmentsResult } from "./messaging/smsSegments";
export { isGsm7, nonGsmChars, smsSegments, transliterate } from "./messaging/smsSegments";

export { isStartKeyword, isStopKeyword } from "./messaging/keywords";

export type { OutboundMessageStatus } from "./messaging/status";
export { nextStatus } from "./messaging/status";

export type {
  Channel,
  ChannelCandidate,
  PickChannelInput,
  PickChannelResult,
} from "./messaging/channel";
export { pickChannel } from "./messaging/channel";

export type {
  FallbackDecisionInput,
  FallbackDecisionResult,
  FallbackSituation,
} from "./messaging/fallback";
export { fallbackDecision, whatsappFallbackDelayMinutes } from "./messaging/fallback";

export type { ToWhatsappParamsResult } from "./messaging/whatsapp";
export { toWhatsappParams, whatsappTemplateName } from "./messaging/whatsapp";

export type {
  RenderChannel,
  RenderTemplateInput,
  RenderTemplateResult,
} from "./messaging/template";
export { renderTemplate } from "./messaging/template";

export { buildWaLinkUrl } from "./messaging/waLink";

export {
  applyJitter,
  MAX_RETRY_ATTEMPTS,
  retryBackoffMs,
  TEMPORARY_ERROR_BACKOFF_MS,
} from "./messaging/retry";

export type { SendWindow } from "./messaging/sendWindow";
export { isWithinSendWindow, nextSendWindowStart } from "./messaging/sendWindow";

export * from "./receivables";
export * from "./dashboard";
export * from "./planning";
export * from "./repairOrders";
export * from "./quotes";

export type { SearchDocumentPrefix, SearchQueryAnalysis, SearchQueryKind } from "./search";
export { analyzeSearchQuery, loosenPlate, matchRank, SEARCH_DOCUMENT_PREFIXES } from "./search";
