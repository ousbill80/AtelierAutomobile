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
