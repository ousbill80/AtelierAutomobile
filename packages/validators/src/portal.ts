// M14 §8 — entrées des procédures du portail client (publiques) et des liens (back-office).
import { z } from "zod";

const token = z.string().min(16).max(200);

export const portalTokenOnlyInputSchema = z.object({ token });

/** Suivi d'OR : `refresh` = rafraîchissement (temps réel / polling), sans ouverture comptée. */
export const portalTrackingInputSchema = z.object({ token, refresh: z.boolean().optional() });

/** Devis ou facture de l'OR suivi (jeton enfant dérivé, aucun identifiant interne exposé). */
export const portalOpenDocumentInputSchema = z.object({
  token,
  kind: z.enum(["quote", "invoice"]),
  /** Rang du document dans la liste renvoyée par `tracking` (0 = le plus récent). */
  index: z.number().int().min(0).max(50).default(0),
});

export const portalFeedbackInputSchema = z.object({
  token,
  rating: z.number().int().min(1, "Choisissez une note.").max(5),
  comment: z.string().trim().max(1000, "1 000 caractères au plus.").optional(),
});

export const portalOtpRequestInputSchema = z.object({
  orgSlug: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8, "Saisissez votre numéro.").max(30),
});

export const portalOtpVerifyInputSchema = portalOtpRequestInputSchema.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Le code comporte 6 chiffres."),
});

export const portalAccountOpenInputSchema = z.object({
  kind: z.enum(["vehicle", "quote", "invoice", "repair_order", "appointment"]),
  /** Référence opaque renvoyée par `account.overview` (jamais un identifiant brut). */
  ref: z.string().min(16).max(200),
});

// ───────────── Back-office (portalLinks.*) ─────────────

export const portalLinkScopeSchema = z.enum([
  "QUOTE",
  "INVOICE",
  "REPAIR_ORDER",
  "APPOINTMENT",
  "VEHICLE",
  "SURVEY",
]);

export const portalLinksListInputSchema = z.object({
  scope: portalLinkScopeSchema,
  targetId: z.string().min(1),
});

export const portalLinksCreateInputSchema = portalLinksListInputSchema;

export const portalLinksRevokeInputSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(3, "Indiquez un motif (3 caractères minimum).").max(300),
});

export const feedbackListInputSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type PortalLinksCreateInput = z.infer<typeof portalLinksCreateInputSchema>;
