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

export type { NormalizedPhone, PhoneOperator, PhoneStatus, PhoneType } from "./phone";
export { convertLegacyNumber, isValidPhoneCI, normalizePhoneCI } from "./phone";

export type { NormalizedPlate, PlateType } from "./plate";
export { normalizePlate } from "./plate";

export type {
  AvgKmPerDayResult,
  AvgKmPerDaySource,
  ComputeAvgKmPerDayInput,
  MileageReadingLike,
  VehicleUsage,
} from "./vehicles/mileage";
export {
  computeAvgKmPerDay,
  computeEstimatedMileage,
  DEFAULT_AVG_KM_PER_DAY,
} from "./vehicles/mileage";

export type { InspectionStatus, ServiceStatus } from "./vehicles/status";
export { computeInspectionStatus, computeServiceStatus } from "./vehicles/status";

export type {
  ComputeNextServiceDueInput,
  NextServiceDueResult,
  ServiceDueTrigger,
} from "./reminders/serviceDue";
export { computeNextServiceDue } from "./reminders/serviceDue";

export type { ComputeDisplayNameInput, CustomerType } from "./customers/display-name";
export { computeDisplayName } from "./customers/display-name";

export type {
  DuplicateLevel,
  DuplicateScoreResult,
  DuplicateSignals,
} from "./customers/duplicates";
export { computeDuplicateScore } from "./customers/duplicates";

export type {
  ConsentState,
  MergeFieldInput,
  MergePlanInput,
  MergePlanResult,
  MergeSide,
} from "./customers/merge";
export { mergePlan } from "./customers/merge";

export type { ComputeReachabilityInput, ReachabilityStatus } from "./customers/reachability";
export { computeReachability } from "./customers/reachability";

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
