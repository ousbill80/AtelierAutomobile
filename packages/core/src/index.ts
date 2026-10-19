export type { Clock } from "./clock";
export { fixedClock, systemClock } from "./clock";

export { DomainError, isDomainError } from "./errors";

export type { BusinessDayOptions, HolidayLike, Weekday } from "./calendar";
export {
  addBusinessDays,
  DEFAULT_WEEKLY_CLOSURE,
  formatDate,
  isBusinessDay,
  isHoliday,
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

export type { NormalizedPhone, PhoneStatus, PhoneLineType } from "./phone";
export { convertLegacyNumber, isValidPhoneCI, normalizePhoneCI, classifyPhoneCI } from "./phone";

export type { NormalizedPlate, PlateType } from "./plate";
export { normalizePlate } from "./plate";

export type { DocumentSequenceKey, DocumentType, SequenceStore } from "./numbering";
export {
  formatDocumentNumber,
  isFiscalDocumentType,
  nextDocumentNumber,
  sequenceKey,
} from "./numbering";

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

// M10 — Moteur de relances automatiques (fonctions pures ; jobs/DB/UI hors scope de cette tranche).
export type {
  ReminderType,
  ReminderChannel,
  ReminderStatus,
  StepAnchorMode,
  ReminderAttachment,
  ReminderStep,
  SendWindow,
  ReminderRuleDefinition,
  EasterBasedHolidays,
  MileageReading,
  EstimateAvgKmPerDayOptions,
  ComputeServiceDueInput,
  ServiceDueResult,
  ServiceDefaults,
  FuelServiceOverrides,
  EligibilityContext,
  EligibilityConditions,
  StepValidationIssue,
  AnchorDates,
  StepHistoryEntry,
  PickStepConfig,
  PickStepResult,
  NextSendSlotInput,
  GroupableReminder,
  ReminderGroup,
  GroupTemplateKind,
  ReminderPriority,
  AntiSpamSentEntry,
  AntiSpamConfig,
  AntiSpamCapDecision,
  SatisfactionBlockingCaseStatus,
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
  ReminderStopEvent,
  ReminderSuppressionRecord,
  SuppressionTarget,
  TemplateVariables,
  IndividualRecipientInput,
  ResolvedRecipient,
  ResolveChannelsInput,
  ApprovalMode,
  InitialStatusInput,
  ReminderSettings,
  Civility,
  SalutationInput,
  ReceivableSummaryInput,
  VehicleDueLine,
} from "./reminders";
export {
  DEFAULT_MIN_GAP_DAYS as REMINDER_DEFAULT_MIN_GAP_DAYS,
  DEFAULT_CATCH_UP_DAYS as REMINDER_DEFAULT_CATCH_UP_DAYS,
  DEFAULT_MIN_RECEIVABLE_AMOUNT,
  DEFAULT_EXCLUDE_TAGS,
  TRANSACTIONAL_REMINDER_TYPES,
  computeEasterSunday,
  easterBasedHolidays,
  ivorianFixedHolidays,
  christianHolidaysOfYear,
  isWithinCandidateWindow,
  estimateAvgKmPerDay,
  computeServiceDue,
  resolveServiceInterval,
  isInspectionDateSuspect,
  estimateInspectionExpiry,
  isEligible,
  assertNoDuplicatePlate,
  collectStepIssues,
  validateSteps,
  describeStepsChange,
  sequenceKey as reminderSequenceKey,
  dedupeKey,
  promiseBrokenDedupeKey,
  manualDedupeKey,
  targetDate,
  pickStep,
  nextSendSlot,
  approvalExpiry,
  recipientKey,
  groupKey,
  groupReminders,
  priorityOf,
  isTransactionalPriority,
  leastPriorityReminder,
  DEFAULT_MAX_PER_DAY,
  DEFAULT_MAX_PER_WEEK,
  antiSpamAllows,
  applyAntiSpamCap,
  isSatisfactionBlocked,
  revalidateClient,
  revalidateInspection,
  revalidateService,
  revalidateReceivable,
  revalidateAppointment,
  revalidateQuoteFollowup,
  revalidateVehicleReady,
  revalidateBeforeSend,
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
  renderTemplate,
  extractTemplateVariables,
  resolveIndividualRecipient,
  resolveReminderChannels,
  initialReminderStatus,
  isDispatchPaused,
  DEFAULT_APPROVAL_MODE,
  NO_CHANNEL,
  DEFAULT_REMINDER_SETTINGS,
  parseReminderSettings,
  customerSalutation,
  describeDueCountdown,
  lateDays,
  receivablesSummary,
  formatVehicleDueList,
} from "./reminders";
