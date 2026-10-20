import { z } from "zod";

// M12 §8 — entrées du tableau de bord et des rapports.
// Doit rester aligné sur PERIOD_PRESETS (packages/core/src/dashboard/period.ts).
export const dashboardPeriodSchema = z.enum([
  "today",
  "7d",
  "month",
  "prev_month",
  "30d",
  "quarter",
  "year",
]);

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide : utilisez le format AAAA-MM-JJ.");

/** Période « Personnalisée » (US-M12-02) : du `from` au `to` inclus, 366 jours au plus. */
export const customPeriodSchema = z
  .object({ from: isoDay, to: isoDay })
  .refine((p) => p.from <= p.to, { message: "La date de début doit précéder la date de fin." })
  .refine(
    (p) =>
      new Date(`${p.to}T00:00:00Z`).getTime() - new Date(`${p.from}T00:00:00Z`).getTime() <=
      366 * 86_400_000,
    { message: "Choisissez une période d'un an au plus." },
  );

export const dashboardInputSchema = z.object({
  period: dashboardPeriodSchema.default("month"),
  /** Si présent, remplace `period` (période personnalisée). */
  custom: customPeriodSchema.optional(),
  siteId: z.string().min(1).optional(),
});
export type DashboardInput = z.infer<typeof dashboardInputSchema>;

/**
 * M12 §8 `dashboard.kpi` — un indicateur isolé (utilisé par l'assistant M17). Liste alignée
 * sur `KPI_CODES` de `@atelieros/core` (vérifiée par le test du routeur `dashboard.kpi`).
 */
export const kpiCodeSchema = z.enum([
  "revenue_ht",
  "revenue_ttc",
  "parts_margin",
  "labor_margin",
  "gross_margin",
  "avg_ticket",
  "collected",
  "receivables",
  "recovered_by_reminders",
  "quote_acceptance",
]);

export const dashboardKpiInputSchema = dashboardInputSchema.extend({
  metric: kpiCodeSchema,
  compare: z.boolean().default(false),
});
export type DashboardKpiInput = z.infer<typeof dashboardKpiInputSchema>;

export const alertsListInputSchema = z.object({
  unreadOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(5),
});

export const alertsMarkReadInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

// M12 §6 — `Organization.settings.digest` (US-M12-08, RG-M12-30). Destinataires vides = tous
// les OWNER actifs.
export const digestSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("07:30"),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]).default("WHATSAPP"),
  recipients: z.array(z.string().min(1)).default([]),
});
export type DigestSettings = z.infer<typeof digestSettingsSchema>;
export const DEFAULT_DIGEST_SETTINGS: DigestSettings = digestSettingsSchema.parse({});

export const digestUpdateSettingsInputSchema = digestSettingsSchema;

// M12 §8 — rapports exportables (`reports.preview`, `reports.compareSites`, export REST).
export const reportSlugSchema = z.enum([
  "ventes",
  "encaissements",
  "balance-agee",
  "rentabilite-or",
  "stock-valorise",
  "relances",
  "productivite",
  "clients",
  "top-pieces",
]);

export const reportFiltersSchema = z.object({
  from: isoDay.optional(),
  to: isoDay.optional(),
  /** Date de situation (balance âgée, stock valorisé) ; défaut : aujourd'hui. */
  asOf: isoDay.optional(),
  siteId: z.string().min(1).optional(),
  /** Rapport « Ventes » : regroupement (M12 §7). */
  groupBy: z.enum(["none", "day", "month", "customer"]).default("none"),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export const reportPreviewInputSchema = z.object({
  slug: reportSlugSchema,
  filters: reportFiltersSchema.default({}),
  cursor: z.number().int().min(0).default(0),
});

export const compareSitesInputSchema = z.object({
  period: dashboardPeriodSchema.default("month"),
  custom: customPeriodSchema.optional(),
});
