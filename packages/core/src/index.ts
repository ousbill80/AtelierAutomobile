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

export type { NormalizedPhone, PhoneStatus } from "./phone";
export { convertLegacyNumber, isValidPhoneCI, normalizePhoneCI } from "./phone";

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

export { isTrivialPin } from "./auth/pin";

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
