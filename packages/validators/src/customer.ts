import { z } from "zod";

export const customerTypeSchema = z.enum(["INDIVIDUAL", "COMPANY"]);
export const civilitySchema = z.enum(["M", "MME", "MLLE"]);
export const channelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL"]);

const individualBaseSchema = z.object({
  type: z.literal("INDIVIDUAL"),
  civility: civilitySchema.optional(),
  lastName: z.string().trim().min(1, "Le nom est obligatoire."),
  firstName: z.string().trim().min(1).optional(),
});

const companyBaseSchema = z.object({
  type: z.literal("COMPANY"),
  companyName: z.string().trim().min(1, "Le nom de l'entreprise est obligatoire."),
  ncc: z.string().trim().min(1).optional(),
  rccm: z.string().trim().min(1).optional(),
});

const sharedCustomerFieldsSchema = z.object({
  phone: z.string().trim().min(1).optional(),
  phone2: z.string().trim().min(1).optional(),
  whatsappPhone: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  address: z.string().trim().min(1).optional(),
  commune: z.string().trim().min(1).optional(),
  preferredChannel: channelSchema.optional(),
  paymentTermsDays: z.number().int().min(0).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  notes: z.string().trim().optional(),
  source: z.string().trim().min(1).optional(),
});

export const vehicleQuickCreateInputSchema = z.object({
  plate: z.string().trim().min(1),
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  vin: z.string().trim().min(1).optional(),
});
export type VehicleQuickCreateInput = z.infer<typeof vehicleQuickCreateInputSchema>;

export const createCustomerInputSchema = z
  .discriminatedUnion("type", [
    individualBaseSchema.merge(sharedCustomerFieldsSchema),
    companyBaseSchema.merge(sharedCustomerFieldsSchema),
  ])
  .and(
    z.object({
      vehicle: vehicleQuickCreateInputSchema.optional(),
      duplicateOverrideReason: z.string().trim().min(1).optional(),
    }),
  );
export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;

export const updateCustomerInputSchema = z.object({
  id: z.string().trim().min(1),
  patch: z
    .object({
      civility: civilitySchema.nullable(),
      lastName: z.string().trim().min(1),
      firstName: z.string().trim().min(1).nullable(),
      companyName: z.string().trim().min(1),
      phone: z.string().trim().min(1).nullable(),
      phone2: z.string().trim().min(1).nullable(),
      whatsappPhone: z.string().trim().min(1).nullable(),
      email: z.string().trim().email().nullable(),
      address: z.string().trim().min(1).nullable(),
      commune: z.string().trim().min(1).nullable(),
      ncc: z.string().trim().min(1).nullable(),
      rccm: z.string().trim().min(1).nullable(),
      preferredChannel: channelSchema.nullable(),
      tags: z.array(z.string().trim().min(1)),
      notes: z.string().trim().nullable(),
    })
    .partial(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerInputSchema>;

export const customerListInputSchema = z.object({
  q: z.string().trim().min(1).optional(),
  type: customerTypeSchema.optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  hasBalance: z.boolean().optional(),
  inspectionWithinDays: z.number().int().optional(),
  serviceDue: z.boolean().optional(),
  optedOut: z.boolean().optional(),
  segmentId: z.string().trim().min(1).optional(),
  commune: z.string().trim().min(1).optional(),
  cursor: z.string().trim().min(1).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type CustomerListInput = z.infer<typeof customerListInputSchema>;

export const customerGetInputSchema = z.object({ id: z.string().trim().min(1) });

export const checkDuplicatesInputSchema = z.object({
  phone: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  ncc: z.string().trim().min(1).optional(),
  excludeId: z.string().trim().min(1).optional(),
});
export type CheckDuplicatesInput = z.infer<typeof checkDuplicatesInputSchema>;

export const dismissDuplicateInputSchema = z.object({
  customerIdA: z.string().trim().min(1),
  customerIdB: z.string().trim().min(1),
});

export const mergePreviewInputSchema = z.object({
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
});

export const mergeCustomerInputSchema = z.object({
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  fieldChoices: z.record(z.string(), z.enum(["source", "target"])).default({}),
  confirmName: z.string().trim().min(1, "Saisissez le nom du client absorbé pour confirmer."),
});
export type MergeCustomerInput = z.infer<typeof mergeCustomerInputSchema>;

export const setConsentInputSchema = z.object({
  id: z.string().trim().min(1),
  remindersConsent: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
  doNotRemind: z.boolean().optional(),
  reason: z.string().trim().min(1).optional(),
  source: z.enum(["counter", "phone", "whatsapp_reply", "portal", "import", "staff"]),
});
export type SetConsentInput = z.infer<typeof setConsentInputSchema>;

export const reactivateRemindersInputSchema = z.object({
  id: z.string().trim().min(1),
  source: z.enum(["counter", "phone", "whatsapp_reply", "portal", "import", "staff"]),
  proof: z.string().trim().min(1).optional(),
});

export const setCreditInputSchema = z.object({
  id: z.string().trim().min(1),
  paymentTermsDays: z.number().int().min(0),
  creditLimit: z.number().int().min(0).nullable().optional(),
});

export const customerTimelineInputSchema = z.object({
  id: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const addCustomerNoteInputSchema = z.object({
  customerId: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1),
  pinned: z.boolean().optional(),
});

export const deleteCustomerInputSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

// RG-M02 (US « contacts d'une entreprise ») — interlocuteurs d'un client. `null` efface un champ
// facultatif à la modification ; un seul contact principal par client (`isPrimary`).
const contactFieldsSchema = z.object({
  name: z.string().trim().min(1, "Le nom du contact est obligatoire."),
  role: z.string().trim().min(1).nullable().optional(),
  phone: z.string().trim().min(1).nullable().optional(),
  phone2: z.string().trim().min(1).nullable().optional(),
  email: z.string().trim().email("Adresse email invalide.").nullable().optional(),
  isPrimary: z.boolean().optional(),
  receivesInvoices: z.boolean().optional(),
  receivesReminders: z.boolean().optional(),
});

export const createContactInputSchema = contactFieldsSchema.extend({
  customerId: z.string().trim().min(1),
});
export type CreateContactInput = z.infer<typeof createContactInputSchema>;

export const updateContactInputSchema = z.object({
  id: z.string().trim().min(1),
  patch: contactFieldsSchema.partial(),
});
export type UpdateContactInput = z.infer<typeof updateContactInputSchema>;

export const listContactsInputSchema = z.object({ customerId: z.string().trim().min(1) });

export const deleteContactInputSchema = z.object({ id: z.string().trim().min(1) });
