import { z } from "zod";

export const createContactInputSchema = z.object({
  customerId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).nullable().optional(),
  phone: z.string().trim().min(1).nullable().optional(),
  phone2: z.string().trim().min(1).nullable().optional(),
  isPrimary: z.boolean().default(false),
  email: z.string().trim().email().nullable().optional(),
  receivesInvoices: z.boolean().default(false),
  receivesReminders: z.boolean().default(false),
});
export type CreateContactInput = z.infer<typeof createContactInputSchema>;

export const updateContactInputSchema = z.object({
  id: z.string().trim().min(1),
  patch: z.object({
    name: z.string().trim().min(1).optional(),
    role: z.string().trim().min(1).nullable().optional(),
    phone: z.string().trim().min(1).nullable().optional(),
    phone2: z.string().trim().min(1).nullable().optional(),
    isPrimary: z.boolean().optional(),
    email: z.string().trim().email().nullable().optional(),
    receivesInvoices: z.boolean().optional(),
    receivesReminders: z.boolean().optional(),
  }),
});
export type UpdateContactInput = z.infer<typeof updateContactInputSchema>;

export const deleteContactInputSchema = z.object({ id: z.string().trim().min(1) });
export type DeleteContactInput = z.infer<typeof deleteContactInputSchema>;
