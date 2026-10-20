// M06 §8 — entrées des routeurs `workshop`, `tech` (tablette hors-ligne) et `partRequest`.
import { z } from "zod";
import { inspectionResultSchema, prioritySchema } from "./repairOrder";

const id = z.string().min(1);
const reason = z.string().trim().min(3, "Indiquez un motif (3 caractères minimum).").max(500);
/** RG-M06-13 : UUID v4 généré par la tablette pour chaque opération. */
const clientOpId = z.string().uuid("Identifiant d'opération invalide.");

export const workshopColumnKeySchema = z.enum([
  "to_diagnose",
  "awaiting_approval",
  "ready_to_start",
  "in_progress",
  "waiting_parts",
  "quality_check",
  "ready",
]);

export const workshopBoardInputSchema = z.object({
  siteId: id.optional(),
  advisorId: id.optional(),
  mechanicId: id.optional(),
  priority: prioritySchema.optional(),
  lateOnly: z.boolean().optional(),
});

export const workshopMoveInputSchema = z.object({
  repairOrderId: id,
  to: workshopColumnKeySchema,
  reason: z.string().trim().max(500).optional(),
});

export const workshopBaysInputSchema = z.object({ siteId: id.optional() });

export const assignBayInputSchema = z.object({
  repairOrderId: id,
  bayId: id.nullable(),
  /** Pont occupé : déplace l'OR présent vers le parking (US-M06-02). */
  force: z.boolean().optional(),
});

export const workshopMechanicsInputSchema = z.object({ siteId: id.optional() });

export const suggestAssigneesInputSchema = z.object({ repairOrderLineId: id });

export const workshopAssignLineInputSchema = z.object({
  repairOrderLineId: id,
  membershipId: id.nullable(),
});

export const timeEntriesInputSchema = z.object({
  siteId: id.optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  membershipId: id.optional(),
  repairOrderId: id.optional(),
  needsReview: z.boolean().optional(),
  cursor: id.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const editTimeEntryInputSchema = z
  .object({
    id,
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date().nullable(),
    pauseMinutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    reason,
  })
  .refine((v) => !v.endedAt || v.endedAt.getTime() > v.startedAt.getTime(), {
    message: "La fin doit être après le début.",
    path: ["endedAt"],
  });

export const reviewTimeEntryInputSchema = z.object({ id });

export const productivityInputSchema = z.object({
  siteId: id.optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const subcontractStatusSchema = z.enum(["TO_SEND", "SENT", "RETURNED", "CANCELLED"]);

export const subcontractListInputSchema = z.object({
  status: subcontractStatusSchema.optional(),
  siteId: id.optional(),
});

export const subcontractUpdateStatusInputSchema = z.object({
  lineId: id,
  status: subcontractStatusSchema,
  returnedAt: z.coerce.date().optional(),
});

// ───────────── Tablette (tech.*) ─────────────

export const pauseReasonSchema = z.enum(["parts", "lunch", "approval", "other"]);

const opBase = {
  clientOpId,
  /** Heure de l'appareil au moment de l'action (corrigée par serverOffset à la synchro). */
  at: z.coerce.date(),
  actorMembershipId: id,
  seq: z.number().int().min(0),
  /** Mise en file alors que la tablette était hors-ligne (source `offline-sync`). */
  offline: z.boolean().optional(),
};

export const techOpSchema = z.discriminatedUnion("type", [
  z.object({ ...opBase, type: z.literal("task.start"), lineId: id }),
  z.object({ ...opBase, type: z.literal("task.pause"), lineId: id, reason: pauseReasonSchema }),
  z.object({ ...opBase, type: z.literal("task.resume"), lineId: id }),
  z.object({
    ...opBase,
    type: z.literal("task.complete"),
    lineId: id,
    note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    ...opBase,
    type: z.literal("note.add"),
    lineId: id,
    body: z.string().trim().min(1).max(2000),
    visibleToCustomer: z.boolean().default(false),
  }),
  z.object({
    ...opBase,
    type: z.literal("photo.attach"),
    lineId: id,
    attachmentId: id,
  }),
  z.object({
    ...opBase,
    type: z.literal("inspection.setItem"),
    itemId: id,
    result: inspectionResultSchema,
    measurement: z.string().trim().max(60).nullable().optional(),
    comment: z.string().trim().max(1000).nullable().optional(),
    photoAttachmentIds: z.array(id).max(10).optional(),
  }),
  z.object({ ...opBase, type: z.literal("inspection.complete"), inspectionId: id }),
  z.object({ ...opBase, type: z.literal("attendance.in") }),
  z.object({ ...opBase, type: z.literal("attendance.out") }),
  z.object({
    ...opBase,
    type: z.literal("partRequest.create"),
    repairOrderId: id,
    lineId: id.optional(),
    productId: id.optional(),
    freeText: z.string().trim().max(200).optional(),
    quantity: z.number().positive().max(1000),
    urgency: prioritySchema.default("NORMAL"),
  }),
]);
export type TechOp = z.infer<typeof techOpSchema>;

export const techSyncInputSchema = z.object({
  deviceId: z.string().trim().min(4).max(100),
  deviceNow: z.coerce.date(),
  /** Décalage connu avant cette synchro (null au premier contact) — §11 horloge. */
  previousOffsetMs: z.number().int().nullable().optional(),
  lastSyncAt: z.coerce.date().nullable().optional(),
  ops: z.array(techOpSchema).max(200),
});

export const techBootstrapInputSchema = z.object({ siteId: id.optional() });

export const techUploadPhotoInputSchema = z.object({
  clientOpId,
  lineId: id,
  mimeType: z.enum(["image/webp", "image/jpeg", "image/png"]),
  dataBase64: z.string().min(4).max(7_000_000),
  caption: z.string().trim().max(120).optional(),
});

export const attendanceClockInputSchema = z.object({
  clientOpId,
  at: z.coerce.date().optional(),
});

// ───────────── Demandes de pièces ─────────────

export const partRequestCreateInputSchema = z
  .object({
    repairOrderId: id,
    repairOrderLineId: id.optional(),
    productId: id.optional(),
    freeText: z.string().trim().max(200).optional(),
    quantity: z.number().positive().max(1000),
    urgency: prioritySchema.default("NORMAL"),
    clientOpId: clientOpId.optional(),
  })
  .refine((v) => !!v.productId || !!v.freeText, {
    message: "Choisissez une pièce ou décrivez-la.",
    path: ["freeText"],
  });

export const partRequestStatusSchema = z.enum([
  "REQUESTED",
  "PREPARING",
  "ORDERED",
  "DELIVERED",
  "REJECTED",
  "CANCELLED",
]);

export const partRequestListInputSchema = z.object({
  siteId: id.optional(),
  status: partRequestStatusSchema.optional(),
  repairOrderId: id.optional(),
});

export const partRequestUpdateStatusInputSchema = z.object({
  id,
  status: partRequestStatusSchema,
  reason: z.string().trim().max(500).optional(),
  purchaseOrderId: id.optional(),
});

export const techProductSearchInputSchema = z.object({
  repairOrderId: id,
  query: z.string().trim().max(80).default(""),
});

export const workshopSettingsInputSchema = z.object({
  sharedTablets: z.boolean().optional(),
  keepBayUntilDelivery: z.boolean().optional(),
  photoRequiredOnUrgent: z.boolean().optional(),
});
