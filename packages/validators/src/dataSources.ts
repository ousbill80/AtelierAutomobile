import { z } from "zod";

// M13 §8 — sources de synchronisation (partie 2, étape 6.4). Le mot de passe est en écriture
// seule : jamais renvoyé ; à la modification, l'omettre conserve celui enregistré.
export const syncDbTypeSchema = z.enum(["postgres", "mysql", "mssql"]);
export const syncEntitySchema = z.enum(["customers", "vehicles", "invoices", "payments"]);
export const syncPolicySchema = z.enum(["CREATE_ONLY", "UPSERT", "UPSERT_OVERWRITE"]);

const queriesSchema = z
  .object({
    customers: z.string().max(20_000).optional(),
    vehicles: z.string().max(20_000).optional(),
    invoices: z.string().max(20_000).optional(),
    payments: z.string().max(20_000).optional(),
  })
  .default({});

const connectionSchema = z.object({
  dbType: syncDbTypeSchema,
  host: z.string().trim().min(1, "Hôte obligatoire.").max(255),
  port: z.number().int().min(1).max(65_535).optional(),
  database: z.string().trim().min(1, "Nom de la base obligatoire.").max(255),
  user: z.string().trim().min(1, "Utilisateur obligatoire.").max(255),
  password: z.string().max(1024).optional(),
  ssl: z.boolean().default(false),
});

export const dataSourceCreateInputSchema = connectionSchema.extend({
  name: z.string().trim().min(1, "Nom obligatoire.").max(120),
  schedule: z.string().trim().min(1).max(120).default("0 2 * * *"),
  isActive: z.boolean().default(true),
  queries: queriesSchema,
  policy: syncPolicySchema.default("UPSERT"),
});
export type DataSourceCreateInput = z.infer<typeof dataSourceCreateInputSchema>;

export const dataSourceUpdateInputSchema = dataSourceCreateInputSchema.partial().extend({
  id: z.string().min(1),
});

export const dataSourceIdInputSchema = z.object({ id: z.string().min(1) });

export const dataSourceTestInputSchema = z.union([
  z.object({ id: z.string().min(1) }),
  connectionSchema.extend({ password: z.string().max(1024) }),
]);

export const dataSourcePreviewQueryInputSchema = z.object({
  id: z.string().min(1),
  entity: syncEntitySchema,
  sql: z.string().min(1).max(20_000),
});
