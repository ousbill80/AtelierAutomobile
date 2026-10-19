// M07 §8 — entrées des routeurs stock / achats. Les quantités saisies sont en unités
// d'affichage (4,5 L) ; le serveur les convertit en unités de base (RG-M07-01).
import { z } from "zod";

const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const fcfa = z.number().int("Montant en FCFA entier.").min(0, "Le montant doit être positif.");
const displayQty = z.number().positive("La quantité doit être positive.").max(1_000_000);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const productUnitSchema = z.enum(["pièce", "litre", "kit", "jeu", "mètre", "kg"]);

export const compatibilityInputSchema = z.object({
  make: z.string().trim().min(1, "Marque obligatoire.").max(60),
  model: z.string().trim().max(60).optional().nullable(),
  yearFrom: z.number().int().min(1950).max(2100).optional().nullable(),
  yearTo: z.number().int().min(1950).max(2100).optional().nullable(),
});

export const productInputSchema = z.object({
  sku: z.string().trim().min(1, "Le SKU est obligatoire.").max(60),
  name: z.string().trim().min(2, "Le nom est obligatoire.").max(160),
  brand: optionalText(80),
  oemReference: optionalText(80),
  barcode: optionalText(40),
  category: optionalText(80),
  unit: productUnitSchema.default("pièce"),
  salePrice: fcfa.default(0),
  minSalePrice: fcfa.optional().nullable(),
  vatRate: z.number().int().min(0).max(100).default(18),
  minStock: z.number().int().min(0).default(0),
  reorderQty: z.number().int().min(0).optional().nullable(),
  packSize: z.number().int().min(1).default(1),
  isStocked: z.boolean().default(true),
  crossReferences: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  compatibleWith: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  defaultSupplierId: id.optional().nullable(),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const productSearchInputSchema = z.object({
  q: z.string().trim().max(100).optional(),
  barcode: z.string().trim().max(40).optional(),
  vehicleId: id.optional(),
  siteId: id.optional(),
  category: z.string().trim().max(80).optional(),
  filter: z.enum(["all", "belowMin", "negative", "inactive"]).default("all"),
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const productUpdateInputSchema = productInputSchema.partial().extend({ id });

export const checkPriceInputSchema = z.object({
  productId: id,
  unitPrice: fcfa,
  discountRate: z.number().min(0).max(100).default(0),
});

export const levelSettingsInputSchema = z.object({
  productId: id,
  siteId: id,
  minStock: z.number().min(0).optional().nullable(),
  maxStock: z.number().min(0).optional().nullable(),
  binLocation: optionalText(40),
});

export const reserveInputSchema = z.object({
  productId: id,
  siteId: id,
  quantity: displayQty,
  repairOrderId: id.optional().nullable(),
  repairOrderNumber: z.string().trim().max(40).optional().nullable(),
  repairOrderLineId: id.optional().nullable(),
  note: optionalText(200),
});

export const releaseInputSchema = z.object({
  reservationId: id,
  reason: z.string().trim().min(2, "Indiquez un motif.").max(300),
});

export const issueInputSchema = z.object({
  reservationId: id.optional().nullable(),
  repairOrderId: id.optional().nullable(),
  repairOrderLineId: id.optional().nullable(),
  productId: id,
  siteId: id,
  quantity: displayQty,
});

export const returnFromRoInputSchema = z.object({
  repairOrderId: id,
  repairOrderLineId: id.optional().nullable(),
  productId: id,
  siteId: id,
  quantity: displayQty,
  resellable: z.boolean(),
  reason: optionalText(300),
});

export const adjustReasonCodeSchema = z.enum([
  "casse",
  "perte",
  "vol",
  "peremption",
  "demonte",
  "erreur",
  "autre",
]);

export const adjustInputSchema = z.object({
  siteId: id,
  productId: id,
  quantity: z.number().refine((v) => v !== 0, "La quantité ne peut pas être nulle."),
  reasonCode: adjustReasonCodeSchema,
  reason: z.string().trim().min(3, "Précisez le motif.").max(300),
});

export const movementTypeSchema = z.enum([
  "PURCHASE_RECEIPT",
  "ISSUE_TO_RO",
  "RETURN_FROM_RO",
  "ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "COUNT_CORRECTION",
  "SUPPLIER_RETURN",
]);

export const movementsInputSchema = z.object({
  productId: id.optional(),
  siteId: id.optional(),
  type: movementTypeSchema.optional(),
  repairOrderId: id.optional(),
  createdById: id.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const valuationInputSchema = z.object({
  siteId: id.optional(),
  at: isoDate.optional(),
  groupBy: z.enum(["category", "site"]).default("category"),
});

export const dormantInputSchema = z.object({
  days: z.number().int().min(30).max(3650).optional(),
  siteId: id.optional(),
});

export const queueInputSchema = z.object({ siteId: id.optional() });

export const countScopeSchema = z.object({
  categories: z.array(z.string().trim().min(1)).max(50).optional(),
  bins: z.array(z.string().trim().min(1)).max(50).optional(),
});

export const countCreateInputSchema = z.object({ siteId: id, scope: countScopeSchema.default({}) });
export const countIdInputSchema = z.object({ id });
export const countSetLineInputSchema = z.object({
  countId: id,
  productId: id,
  countedQty: z.number().min(0).nullable(),
});
export const countListInputSchema = z.object({
  siteId: id.optional(),
  status: z.enum(["DRAFT", "IN_PROGRESS", "SUBMITTED", "VALIDATED", "CANCELLED"]).optional(),
});

export const transferCreateInputSchema = z.object({
  fromSiteId: id,
  toSiteId: id,
  lines: z
    .array(z.object({ productId: id, quantity: displayQty }))
    .min(1)
    .max(200),
  notes: optionalText(300),
});
export const transferReceiveInputSchema = z.object({
  id,
  lines: z.array(z.object({ lineId: id, receivedQty: z.number().min(0) })),
});
export const transferListInputSchema = z.object({
  status: z.enum(["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"]).optional(),
});

export const supplierInputSchema = z.object({
  name: z.string().trim().min(2, "Le nom est obligatoire.").max(120),
  phone: optionalText(30),
  whatsappPhone: optionalText(30),
  email: z
    .string()
    .trim()
    .email("Adresse email invalide.")
    .max(160)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  address: optionalText(300),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  notes: optionalText(1000),
});
export const supplierUpdateInputSchema = supplierInputSchema.partial().extend({
  id,
  isActive: z.boolean().optional(),
});

const purchaseLineInput = z.object({
  productId: id,
  quantity: displayQty,
  unitCost: fcfa,
});

export const purchaseOrderCreateInputSchema = z.object({
  supplierId: id,
  siteId: id,
  lines: z.array(purchaseLineInput).min(1, "Ajoutez au moins une ligne.").max(200),
  repairOrderId: id.optional().nullable(),
  expectedAt: isoDate.optional().nullable(),
  notes: optionalText(1000),
});

export const purchaseOrderUpdateInputSchema = z.object({
  id,
  expectedAt: isoDate.optional().nullable(),
  notes: optionalText(1000),
  /** Remplace les lignes en DRAFT ; en SENT, seules les nouvelles lignes sont ajoutées. */
  lines: z
    .array(purchaseLineInput.extend({ lineId: id.optional() }))
    .max(200)
    .optional(),
});

export const purchaseOrderSendInputSchema = z.object({
  id,
  channel: z.enum(["WHATSAPP", "EMAIL", "LINK", "MANUAL"]),
});

export const purchaseOrderReceiveInputSchema = z.object({
  id,
  lines: z.array(z.object({ lineId: id, quantity: z.number().min(0), unitCost: fcfa })),
  extraLines: z.array(purchaseLineInput).max(50).default([]),
  landedCosts: fcfa.optional(),
  confirmAberrantPrices: z.boolean().default(false),
});

export const purchaseOrderReasonInputSchema = z.object({
  id,
  reason: z.string().trim().min(3, "Indiquez un motif.").max(300),
});

export const purchaseOrderListInputSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]).optional(),
  supplierId: id.optional(),
  late: z.boolean().optional(),
});

export const suggestionsInputSchema = z.object({ siteId: id });

export const createFromSuggestionsInputSchema = z.object({
  siteId: id,
  orders: z
    .array(
      z.object({
        supplierId: id,
        lines: z.array(purchaseLineInput).min(1),
      }),
    )
    .min(1)
    .max(50),
});

export const supplierReturnInputSchema = z.object({
  purchaseOrderId: id,
  lineId: id,
  quantity: displayQty,
  reason: z.string().trim().min(3, "Indiquez un motif.").max(300),
});
