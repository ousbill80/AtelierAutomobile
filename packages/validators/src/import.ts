import { z } from "zod";

/** RG-M13-16/17 — entités importables en étape 1.3 (fichier), plus `mixed`. */
export const importEntitySchema = z.enum([
  "customers",
  "vehicles",
  "invoices",
  "payments",
  "products",
  "repair_orders",
  "mixed",
]);
export type ImportEntity = z.infer<typeof importEntitySchema>;

/** Reflète `enum ImportPolicy` (schema.prisma) — RG-M13-19. */
export const importPolicySchema = z.enum(["CREATE_ONLY", "UPSERT", "UPSERT_OVERWRITE"]);
export type ImportPolicyInput = z.infer<typeof importPolicySchema>;

export const importMappingSourceSchema = z.enum(["synonym", "ai", "memory"]);

export const uploadInputSchema = z.object({
  fileName: z.string().trim().min(1),
  size: z.number().int().positive(),
  mimeType: z.string().trim().min(1),
});
export type UploadInput = z.infer<typeof uploadInputSchema>;

export const analyzeInputSchema = z.object({
  jobId: z.string().trim().min(1),
  encoding: z
    .enum(["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE", "WINDOWS-1252", "ISO-8859-1"])
    .optional(),
  delimiter: z.enum([";", ",", "\t", "|"]).optional(),
  sheet: z.string().trim().min(1).optional(),
  headerRow: z.number().int().min(0).optional(),
});
export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;

export const columnMappingOptionsSchema = z.object({
  policy: importPolicySchema.default("UPSERT"),
  dateFormat: z.string().trim().min(1).optional(),
  treatMissingAsPaid: z.boolean().default(false),
});
export type ColumnMappingOptions = z.infer<typeof columnMappingOptionsSchema>;

export const setMappingInputSchema = z.object({
  jobId: z.string().trim().min(1),
  entity: importEntitySchema,
  columns: z.record(z.string(), z.string().trim().min(1)),
  options: columnMappingOptionsSchema,
});
export type SetMappingInput = z.infer<typeof setMappingInputSchema>;

export const validateInputSchema = z.object({
  jobId: z.string().trim().min(1),
  cursor: z.number().int().min(0).optional(),
});
export type ValidateInput = z.infer<typeof validateInputSchema>;

export const patchRowInputSchema = z.object({
  jobId: z.string().trim().min(1),
  rowNumber: z.number().int().min(1),
  field: z.string().trim().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});
export type PatchRowInput = z.infer<typeof patchRowInputSchema>;

export const simulateInputSchema = z.object({
  jobId: z.string().trim().min(1),
});
export type SimulateInput = z.infer<typeof simulateInputSchema>;

export const runInputSchema = z.object({
  jobId: z.string().trim().min(1),
  skipErrors: z.boolean().default(false),
});
export type RunInput = z.infer<typeof runInputSchema>;

export const progressInputSchema = z.object({
  jobId: z.string().trim().min(1),
});
export type ProgressInput = z.infer<typeof progressInputSchema>;

export const errorReportInputSchema = z.object({
  jobId: z.string().trim().min(1),
});
export type ErrorReportInput = z.infer<typeof errorReportInputSchema>;

export const rollbackInputSchema = z.object({
  jobId: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});
export type RollbackInput = z.infer<typeof rollbackInputSchema>;

export const listImportsInputSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
});
export type ListImportsInput = z.infer<typeof listImportsInputSchema>;

export const templateInputSchema = z.object({
  entity: importEntitySchema,
});
export type TemplateInput = z.infer<typeof templateInputSchema>;
