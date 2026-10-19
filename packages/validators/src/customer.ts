import { z } from "zod";
import { messageChannelSchema } from "./auth";
import { vehicleInputSchema } from "./vehicle";

export const customerTypeSchema = z.enum(["INDIVIDUAL", "COMPANY"]);
export const civilitySchema = z.enum(["M", "MME", "MLLE"]);
export const consentSourceSchema = z.enum([
  "counter",
  "phone",
  "whatsapp_reply",
  "portal",
  "import",
  "staff",
]);

const baseCustomerFields = {
  civility: civilitySchema.nullable().optional(),
  phone: z.string().trim().min(1).nullable().optional(),
  phone2: z.string().trim().min(1).nullable().optional(),
  whatsappPhone: z.string().trim().min(1).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  address: z.string().trim().min(1).nullable().optional(),
  commune: z.string().trim().min(1).nullable().optional(),
  ncc: z.string().trim().min(1).nullable().optional(),
  rccm: z.string().trim().min(1).nullable().optional(),
  preferredChannel: messageChannelSchema.nullable().optional(),
  marketingConsent: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  notes: z.string().trim().min(1).nullable().optional(),
  source: z.string().trim().min(1).nullable().optional(),
};

/** RG-M02-01 — discriminé par `type` : Particulier exige `lastName`, Entreprise exige `companyName`. */
export const customerInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("INDIVIDUAL"),
    firstName: z.string().trim().min(1).nullable().optional(),
    lastName: z.string().trim().min(1),
    companyName: z.string().trim().min(1).nullable().optional(),
    ...baseCustomerFields,
  }),
  z.object({
    type: z.literal("COMPANY"),
    firstName: z.string().trim().min(1).nullable().optional(),
    lastName: z.string().trim().min(1).nullable().optional(),
    companyName: z.string().trim().min(1),
    ...baseCustomerFields,
  }),
]);
export type CustomerInput = z.infer<typeof customerInputSchema>;

export const customerListInputSchema = z.object({
  q: z.string().trim().min(1).optional(),
  type: customerTypeSchema.optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  hasBalance: z.boolean().optional(),
  inspectionWithinDays: z.number().int().min(0).optional(),
  serviceDue: z.boolean().optional(),
  optedOut: z.boolean().optional(),
  segmentId: z.string().trim().min(1).optional(),
  commune: z.string().trim().min(1).optional(),
  sort: z.enum(["name_asc", "name_desc", "newest", "oldest", "last_visit"]).default("name_asc"),
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type CustomerListInput = z.infer<typeof customerListInputSchema>;

export const customerGetInputSchema = z.object({ id: z.string().trim().min(1) });
export type CustomerGetInput = z.infer<typeof customerGetInputSchema>;

export const customerCreateInputSchema = z.object({
  customer: customerInputSchema,
  vehicle: vehicleInputSchema.optional(),
  duplicateOverrideReason: z.string().trim().min(1).optional(),
});
export type CustomerCreateInput = z.infer<typeof customerCreateInputSchema>;

export const customerUpdateInputSchema = z.object({
  id: z.string().trim().min(1),
  patch: z.object({
    type: customerTypeSchema.optional(),
    firstName: z.string().trim().min(1).nullable().optional(),
    lastName: z.string().trim().min(1).nullable().optional(),
    companyName: z.string().trim().min(1).nullable().optional(),
    ...baseCustomerFields,
  }),
});
export type CustomerUpdateInput = z.infer<typeof customerUpdateInputSchema>;

export const checkDuplicatesInputSchema = z.object({
  phone: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  ncc: z.string().trim().min(1).optional(),
  excludeId: z.string().trim().min(1).optional(),
});
export type CheckDuplicatesInput = z.infer<typeof checkDuplicatesInputSchema>;

export const duplicatesListInputSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type DuplicatesListInput = z.infer<typeof duplicatesListInputSchema>;

export const duplicatesDismissInputSchema = z.object({
  customerIdA: z.string().trim().min(1),
  customerIdB: z.string().trim().min(1),
});
export type DuplicatesDismissInput = z.infer<typeof duplicatesDismissInputSchema>;

export const mergePreviewInputSchema = z.object({
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
});
export type MergePreviewInput = z.infer<typeof mergePreviewInputSchema>;

export const mergeFieldChoiceSchema = z.enum(["source", "target"]);

export const customerMergeInputSchema = z.object({
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  fieldChoices: z.record(z.string(), mergeFieldChoiceSchema).default({}),
  confirmName: z.string().trim().min(1),
});
export type CustomerMergeInput = z.infer<typeof customerMergeInputSchema>;

export const setConsentInputSchema = z.object({
  id: z.string().trim().min(1),
  remindersConsent: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
  doNotRemind: z.boolean().optional(),
  reason: z.string().trim().min(1).nullable().optional(),
  source: consentSourceSchema,
});
export type SetConsentInput = z.infer<typeof setConsentInputSchema>;

export const reactivateRemindersInputSchema = z.object({
  id: z.string().trim().min(1),
  source: consentSourceSchema,
  proof: z.string().trim().min(1).nullable().optional(),
});
export type ReactivateRemindersInput = z.infer<typeof reactivateRemindersInputSchema>;

export const setCreditInputSchema = z.object({
  id: z.string().trim().min(1),
  paymentTermsDays: z.number().int().min(0),
  creditLimit: z.number().int().min(0).nullable().optional(),
});
export type SetCreditInput = z.infer<typeof setCreditInputSchema>;

export const timelineTypeSchema = z.enum([
  "note",
  "appointment",
  "repair_order",
  "quote",
  "invoice",
  "payment",
  "mileage_reading",
  "vehicle_event",
  "message",
]);

export const customerTimelineInputSchema = z.object({
  id: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1).optional(),
  types: z.array(timelineTypeSchema).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type CustomerTimelineInput = z.infer<typeof customerTimelineInputSchema>;

export const addNoteInputSchema = z.object({
  customerId: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1).nullable().optional(),
  body: z.string().trim().min(1),
  pinned: z.boolean().default(false),
});
export type AddNoteInput = z.infer<typeof addNoteInputSchema>;

export const customerDeleteInputSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});
export type CustomerDeleteInput = z.infer<typeof customerDeleteInputSchema>;

export const customerExportDataInputSchema = z.object({ id: z.string().trim().min(1) });
export type CustomerExportDataInput = z.infer<typeof customerExportDataInputSchema>;

export const customerAnonymizeInputSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  confirm: z.literal(true),
});
export type CustomerAnonymizeInput = z.infer<typeof customerAnonymizeInputSchema>;
