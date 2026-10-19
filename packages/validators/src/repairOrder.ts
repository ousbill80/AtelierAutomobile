// M04 §8 — entrées des routeurs `repairOrder`, `repairOrderLine`, `inspection`,
// `inspectionTemplate` et du portail (suivi, signature à distance).
import { z } from "zod";

const id = z.string().min(1);
const fcfa = z
  .number()
  .int("Montant en FCFA entier.")
  .min(0, "Le montant ne peut pas être négatif.");
const reason = z.string().trim().min(3, "Indiquez un motif (3 caractères minimum).").max(500);

export const repairOrderStatusSchema = z.enum([
  "DRAFT",
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
  "READY",
  "DELIVERED",
  "INVOICED",
  "CANCELLED",
]);
export const prioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const lineTypeSchema = z.enum(["LABOR", "PART", "SUBCONTRACT", "FEE", "CONSUMABLE"]);
export const lineStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"]);
export const payerSchema = z.enum(["CUSTOMER", "INSURANCE", "WARRANTY", "INTERNAL"]);
export const inspectionResultSchema = z.enum(["OK", "WATCH", "URGENT", "NOT_CHECKED"]);

// ───────────── RG-M04-04 — CheckInSchema ─────────────

export const bodyTypeSchema = z.enum([
  "SEDAN",
  "SUV",
  "PICKUP",
  "HATCHBACK",
  "VAN",
  "MINIBUS",
  "TRUCK",
]);
export const damageViewSchema = z.enum(["TOP", "FRONT", "REAR", "LEFT", "RIGHT"]);
export const damageTypeSchema = z.enum([
  "SCRATCH",
  "DENT",
  "CRACK",
  "BROKEN",
  "RUST",
  "PAINT",
  "MISSING",
  "OTHER",
]);
export const damageSeveritySchema = z.enum(["LIGHT", "MEDIUM", "HEAVY"]);
export const checkInItemKeySchema = z.enum([
  "spare_wheel",
  "jack",
  "wheel_wrench",
  "triangle",
  "vest",
  "extinguisher",
  "radio_front",
  "mats",
  "hubcaps",
  "antenna",
  "registration_card",
  "insurance_certificate",
  "tax_sticker",
]);
export const warningLightSchema = z.enum([
  "engine",
  "abs",
  "airbag",
  "oil",
  "battery",
  "temp",
  "brake",
]);

export const damageSchema = z.object({
  n: z.number().int().min(1),
  view: damageViewSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  zone: z.string().trim().min(1).max(60),
  type: damageTypeSchema,
  severity: damageSeveritySchema,
  note: z.string().trim().max(300).optional(),
  attachmentIds: z.array(id).default([]),
});

export const checkOutSchema = z.object({
  mileage: z.number().int().min(0).nullable(),
  fuelLevel: z.number().int().min(0).max(8),
  itemsConfirmed: z.boolean(),
  oldPartsReturned: z.boolean(),
  collectedBy: z.object({
    name: z.string().trim().min(1, "Indiquez qui récupère le véhicule.").max(120),
    phone: z.string().trim().max(30).optional(),
  }),
  signatureUrl: z.string().optional(),
  at: z.string().optional(),
});

export const CheckInSchema = z
  .object({
    bodyType: bodyTypeSchema.default("SEDAN"),
    noDamage: z.boolean().default(false),
    damages: z.array(damageSchema).max(60).default([]),
    items: z.array(z.object({ key: checkInItemKeySchema, present: z.boolean() })).default([]),
    keysCount: z.number().int().min(0).max(20).default(1),
    belongings: z.string().trim().max(1000).default(""),
    warningLights: z.array(warningLightSchema).default([]),
    tyresNote: z.string().trim().max(500).optional(),
    odometerUnreadable: z.boolean().optional(),
    odometerReason: z.string().trim().max(300).optional(),
    authorizationCeiling: fcfa.default(0),
    returnOldParts: z.boolean().default(false),
    dropOff: z
      .object({
        by: z.enum(["OWNER", "DRIVER", "TOW", "OTHER"]),
        name: z.string().trim().max(120).optional(),
        phone: z.string().trim().max(30).optional(),
      })
      .default({ by: "OWNER" }),
    photoAttachmentIds: z.array(id).max(40).default([]),
    signatureRefused: z.boolean().optional(),
    signatureRefusedBy: z.string().optional(),
    signatureRefusedAt: z.string().optional(),
    remoteSignaturePending: z.boolean().optional(),
    signerName: z.string().trim().max(120).optional(),
    checkOut: checkOutSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.noDamage && value.damages.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["noDamage"],
        message: "« Aucun dommage constaté » est coché alors que des dommages sont marqués.",
      });
    }
  });
export type CheckInData = z.infer<typeof CheckInSchema>;
export type CheckInInput = z.input<typeof CheckInSchema>;

// ───────────── Lignes ─────────────

export const lineInputSchema = z.object({
  type: lineTypeSchema,
  productId: id.optional(),
  laborOperationId: id.optional(),
  description: z.string().trim().min(1, "Saisissez une désignation.").max(300),
  quantity: z.number().positive("La quantité doit être positive.").max(10_000),
  unitPrice: fcfa.optional(),
  discountRate: z.number().int().min(0).max(100).optional(),
  vatRate: z.number().int().min(0).max(100).optional(),
  assignedToId: id.optional(),
  payer: payerSchema.optional(),
  isCustomerSupplied: z.boolean().optional(),
  supplierId: id.optional(),
  supplierName: z.string().trim().max(120).optional(),
  costPrice: fcfa.optional(),
  warrantyMonths: z.number().int().min(0).max(120).optional(),
  warrantyKm: z.number().int().min(0).max(1_000_000).optional(),
});
export type LineInput = z.infer<typeof lineInputSchema>;

export const addLineInputSchema = lineInputSchema.extend({ repairOrderId: id });

export const updateLineInputSchema = z.object({
  id,
  /** Verrou optimiste (M04 §11) : `updatedAt` connu du client. */
  expectedUpdatedAt: z.coerce.date().optional(),
  patch: z.object({
    description: z.string().trim().min(1).max(300).optional(),
    quantity: z.number().positive().max(10_000).optional(),
    unitPrice: fcfa.optional(),
    discountRate: z.number().int().min(0).max(100).optional(),
    vatRate: z.number().int().min(0).max(100).optional(),
    payer: payerSchema.optional(),
    isCustomerSupplied: z.boolean().optional(),
    costPrice: fcfa.nullable().optional(),
    approval: z.enum(["APPROVED", "DECLINED"]).optional(),
    approvalSource: z.enum(["PHONE", "IN_PERSON"]).optional(),
  }),
  /** Motif obligatoire pour un prix sous le minimum (RG-M04-06). */
  reason: z.string().trim().max(500).optional(),
});

export const removeLineInputSchema = z.object({
  id,
  reason: z.string().trim().max(500).optional(),
});
export const setLineStatusInputSchema = z.object({ id, status: lineStatusSchema });
export const assignLineInputSchema = z.object({ id, membershipId: id.nullable() });
export const setSubcontractStatusInputSchema = z.object({
  id,
  status: z.enum(["TO_SEND", "SENT", "RETURNED"]),
  expectedAt: z.coerce.date().optional(),
});

// ───────────── OR ─────────────

export const listRepairOrdersInputSchema = z.object({
  siteId: id.optional(),
  statuses: z.array(repairOrderStatusSchema).optional(),
  advisorId: id.optional(),
  mechanicId: id.optional(),
  priority: prioritySchema.optional(),
  late: z.boolean().optional(),
  comeback: z.boolean().optional(),
  mine: z.boolean().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const boardInputSchema = z.object({
  siteId: id.optional(),
  mine: z.boolean().optional(),
  mechanicId: id.optional(),
  priority: prioritySchema.optional(),
  late: z.boolean().optional(),
});

export const repairOrderIdInputSchema = z.object({ id });

export const receptionLookupInputSchema = z.object({ q: z.string().trim().min(2).max(60) });

export const createDraftInputSchema = z.object({
  siteId: id.optional(),
  customerId: id,
  vehicleId: id,
  appointmentId: id.optional(),
  quoteId: id.optional(),
  complaint: z.string().trim().max(2000).optional(),
  forceSecondActive: z.boolean().optional(),
});

export const signatureInputSchema = z.union([
  z.object({
    dataUrl: z.string().regex(/^data:image\/(png|webp|jpeg);base64,/, "Signature invalide."),
    signerName: z.string().trim().min(1, "Indiquez le nom du signataire.").max(120),
  }),
  z.object({ remote: z.literal(true) }),
  z.object({ refused: z.literal(true) }),
]);

export const checkInInputSchema = z.object({
  id: id.optional(),
  siteId: id.optional(),
  customerId: id,
  vehicleId: id,
  appointmentId: id.optional(),
  mileageIn: z.number().int().min(0).max(5_000_000).nullable().optional(),
  fuelLevel: z.number().int().min(0).max(8),
  checkIn: CheckInSchema,
  complaint: z.string().trim().max(4000),
  promisedAt: z.coerce.date().optional(),
  priority: prioritySchema.optional(),
  advisorId: id.optional(),
  initialLines: z.array(lineInputSchema).max(50).optional(),
  signature: signatureInputSchema.optional(),
  /** Idempotence de la synchronisation hors-ligne (US-M04-01). */
  clientRequestId: z.string().min(8).max(100),
  /** Retour sur travaux (US-M04-14) : OR d'origine. */
  comebackOfId: id.optional(),
  /** RG-M02-09 : confirmer un kilométrage inhabituel. */
  confirmMileage: z.boolean().optional(),
  /** RG-M04-02 : 2e OR actif sur le véhicule (MANAGER). */
  forceSecondActive: z.boolean().optional(),
  /** RG-M09-10 : blocage crédit → OR « paiement comptant » ou dérogation. */
  cashOnly: z.boolean().optional(),
  creditOverrideReason: z.string().trim().max(500).optional(),
});
export type CheckInRequest = z.infer<typeof checkInInputSchema>;

export const attachmentKindSchema = z.enum([
  "photo_checkin",
  "photo_damage",
  "signature",
  "photo_checkout",
  "photo_work",
  "photo_inspection",
]);

export const uploadAttachmentInputSchema = z.object({
  repairOrderId: id.optional(),
  /** Réception en cours (OR pas encore créé) : clé du brouillon (`clientRequestId`). */
  draftKey: z.string().min(8).max(100).optional(),
  kind: attachmentKindSchema,
  mimeType: z.enum(["image/webp", "image/jpeg", "image/png"]),
  /** Contenu en base64 (sans préfixe data:), compressé côté client (≤ 1600 px). */
  dataBase64: z.string().min(4).max(7_000_000),
  caption: z.string().trim().max(120).optional(),
});

export const updateRepairOrderInputSchema = z.object({
  id,
  promisedAt: z.coerce.date().nullable().optional(),
  priority: prioritySchema.optional(),
  advisorId: id.nullable().optional(),
  complaint: z.string().trim().max(4000).optional(),
  diagnosis: z.string().trim().max(4000).optional(),
  internalNotes: z.string().trim().max(8000).optional(),
  bayId: id.nullable().optional(),
  notifyCustomer: z.boolean().optional(),
  delayReason: z.string().trim().max(200).optional(),
});

export const transitionNameSchema = z.enum([
  "start_diagnosis",
  "approve",
  "request_approval",
  "start_work",
  "wait_parts",
  "resume",
  "complete_work",
  "qc_pass",
  "qc_reject",
  "reopen",
  "cancel",
]);

export const transitionInputSchema = z.object({
  id,
  transition: transitionNameSchema,
  reason: z.string().trim().max(500).optional(),
  data: z.record(z.unknown()).optional(),
});

export const qcInputSchema = z.object({
  id,
  checklist: z.array(z.object({ key: z.string().min(1), result: z.enum(["OK", "NOK", "NA"]) })),
  roadTest: z
    .object({ kmStart: z.number().int().min(0), kmEnd: z.number().int().min(0) })
    .optional(),
  comment: z.string().trim().max(1000).optional(),
  reject: z.boolean().optional(),
  rejectLineIds: z.array(id).optional(),
});

export const deliverInputSchema = z.object({
  id,
  checkOut: checkOutSchema,
  signature: z
    .object({
      dataUrl: z.string().regex(/^data:image\/(png|webp|jpeg);base64,/, "Signature invalide."),
      signerName: z.string().trim().min(1).max(120),
    })
    .optional(),
  forceUnpaidReason: z.string().trim().max(500).optional(),
  /** RG-M04-14 : restitution depuis QUALITY_CHECK (MANAGER, motif). */
  skipQcReason: z.string().trim().max(500).optional(),
});

export const warrantyDecisionInputSchema = z.object({
  id,
  decision: z.enum(["COVERED", "NOT_COVERED", "PARTIAL"]),
  reason,
});

export const markComebackInputSchema = z.object({ id, originalRepairOrderId: id });

export const cancelInputSchema = z.object({ id, reason });

export const sendTrackingLinkInputSchema = z.object({
  id,
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]).optional(),
});

export const storageFeeInputSchema = z.object({ id });

// ───────────── Inspection ─────────────

export const startInspectionInputSchema = z.object({
  repairOrderId: id,
  templateId: id.optional(),
});

export const saveInspectionItemInputSchema = z.object({
  itemId: id,
  result: inspectionResultSchema,
  measurement: z.string().trim().max(60).nullable().optional(),
  comment: z.string().trim().max(1000).nullable().optional(),
  photoAttachmentIds: z.array(id).max(10).optional(),
  recommendedProductIds: z.array(id).max(20).optional(),
  recommendedLaborIds: z.array(id).max(20).optional(),
  shareWithCustomer: z.boolean().optional(),
});

export const bulkOkInputSchema = z.object({ inspectionId: id, category: z.string().min(1) });
export const completeInspectionInputSchema = z.object({ inspectionId: id });
export const inspectionIdInputSchema = z.object({ inspectionId: id });

export const inspectionTemplateItemSchema = z.object({
  category: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  measurementUnit: z.string().trim().max(20).optional(),
  recommendedLaborCode: z.string().trim().max(30).optional(),
  recommendedProductCategory: z.string().trim().max(60).optional(),
});

export const inspectionTemplateInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  items: z.array(inspectionTemplateItemSchema).min(1).max(150),
  isDefault: z.boolean().optional(),
});
export const updateInspectionTemplateInputSchema = inspectionTemplateInputSchema
  .partial()
  .extend({ id });

// ───────────── Paramètres (M04 §6) ─────────────

export const repairOrderSettingsInputSchema = z.object({
  minCheckInPhotos: z.number().int().min(0).max(20).optional(),
  qcRequired: z.boolean().optional(),
  qcChecklist: z
    .array(
      z.object({ key: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(120) }),
    )
    .min(1)
    .max(30)
    .optional(),
  autoDraftInvoiceOnReady: z.boolean().optional(),
  defaultAuthorizationCeiling: fcfa.optional(),
  storageFeeEnabled: z.boolean().optional(),
  storageFeeAfterDays: z.number().int().min(0).max(60).optional(),
  storageFeePerDay: fcfa.optional(),
  readyReminderAfterDays: z.number().int().min(1).max(30).optional(),
  consumablesRate: z.number().int().min(0).max(30).optional(),
  laborRates: z
    .object({
      STANDARD: fcfa,
      DIAGNOSTIC: fcfa,
      BODYWORK: fcfa,
      ELECTRICAL: fcfa,
    })
    .partial()
    .optional(),
  warranty: z
    .object({
      laborMonths: z.number().int().min(0).max(60),
      laborKm: z.number().int().min(0).max(200_000),
      partMonths: z.number().int().min(0).max(60),
      partKm: z.number().int().min(0).max(200_000),
      customerSuppliedLaborMonths: z.number().int().min(0).max(60),
    })
    .partial()
    .optional(),
});

// ───────────── Portail (public) ─────────────

export const portalTokenInputSchema = z.object({ token: z.string().min(16).max(200) });
export const portalSignReceptionInputSchema = z.object({
  token: z.string().min(16).max(200),
  signatureDataUrl: z.string().regex(/^data:image\/(png|webp|jpeg);base64,/, "Signature invalide."),
  signerName: z.string().trim().min(1, "Indiquez votre nom.").max(120),
});
