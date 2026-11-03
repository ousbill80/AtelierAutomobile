import { z } from "zod";

const auditFiltersSchema = z.object({
  userId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  entity: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  siteId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Jour civil (`yyyy-MM-dd`, fuseau de l'organisation) : début de période inclus. */
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date de début invalide (format attendu : AAAA-MM-JJ).")
    .optional(),
  /** Jour civil (`yyyy-MM-dd`, fuseau de l'organisation) : fin de période incluse (toute la journée). */
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date de fin invalide (format attendu : AAAA-MM-JJ).")
    .optional(),
});

export const auditListInputSchema = auditFiltersSchema.extend({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type AuditListInput = z.infer<typeof auditListInputSchema>;

export const auditExportInputSchema = auditFiltersSchema;
export type AuditExportInput = z.infer<typeof auditExportInputSchema>;
