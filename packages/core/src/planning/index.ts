export type {
  AppointmentLike,
  AppointmentSource,
  AppointmentStatus,
  AppointmentType,
  BayLike,
  BayType,
  BlockLike,
  HalfDay,
  MechanicLike,
  OccupyingOrderLike,
  TimeRange,
} from "./types";
export { APPOINTMENT_TYPES } from "./types";

export type { AppointmentSettings, PlanningSettings } from "./settings";
export {
  DEFAULT_APPOINTMENT_SETTINGS,
  DEFAULT_DURATIONS,
  DEFAULT_PLANNING_SETTINGS,
  resolveAppointmentSettings,
  resolvePlanningSettings,
} from "./settings";

export type {
  OpeningHoursViolation,
  OpeningRangesOptions,
  WithinOpeningHoursInput,
} from "./opening-hours";
export {
  civilDay,
  instantAt,
  isWithinOpeningHours,
  nextCivilDay,
  openingRangesForDay,
  startOfCivilDay,
  subtractRange,
  weekdayKey,
} from "./opening-hours";

export type { Conflict, DetectConflictsInput } from "./conflicts";
export { BLOCKING_STATUSES, detectConflicts, isBayFree, overlaps } from "./conflicts";

export type { DefaultDurationInput } from "./durations";
export {
  defaultDuration,
  formatHoursMinutes,
  isBayCompatible,
  REQUIRED_BAY_TYPES,
  roundUpToQuarterHour,
} from "./durations";

export type {
  CapacityRefusal,
  CapacityResult,
  ComputeCapacityInput,
  HalfDayWindow,
} from "./capacity";
export {
  canAcceptAppointment,
  clippedMinutes,
  computeCapacity,
  halfDayOf,
  halfDayWindows,
  occupancyRate,
} from "./capacity";

export type { AvailableSlotsInput, HalfDaySlots, SlotCandidate } from "./available-slots";
export { availableSlots, findFreeBay, spreadEvenly } from "./available-slots";

export type { AttributeReminderInput, SentReminderLike } from "./attribution";
export { attributeReminder, REMINDER_ATTRIBUTION_WINDOW_DAYS } from "./attribution";

export type { NoShowEligibilityInput } from "./no-show";
export {
  canRevertNoShow,
  countNoShows12m,
  isLate,
  NO_SHOW_BADGE_THRESHOLD,
  NO_SHOW_REVERT_WINDOW_HOURS,
  noShowEligibility,
  requiresMandatoryConfirmation,
} from "./no-show";

export type { BatchPlacement, BatchPlacementInput, BatchPlacementResult } from "./batch";
export { batchPlacement } from "./batch";

export type { AppointmentAction } from "./state-machine";
export {
  canTransition,
  isTerminalStatus,
  nextStatus,
  TERMINAL_STATUSES,
  TRANSITIONS,
} from "./state-machine";

export type { AppointmentMessageContext, GroupConfirmationContext } from "./messages";
export {
  APPOINTMENT_TYPE_MESSAGE_LABELS,
  customerGreeting,
  formatAppointmentDateTime,
  formatAppointmentDay,
  formatAppointmentTime,
  renderAppointmentCancelled,
  renderAppointmentConfirmation,
  renderAppointmentMoved,
  renderAppointmentNoShow,
  renderAppointmentReminder,
  renderGroupConfirmation,
} from "./messages";

export {
  computeJ1ReminderTime,
  REMINDER_J1_EARLY_TIME,
  REMINDER_J1_TIME,
  REMINDER_MIN_LEAD_HOURS,
  TRANSACTIONAL_QUIET_FROM,
  TRANSACTIONAL_QUIET_TO,
  transactionalSendTime,
} from "./send-window";
